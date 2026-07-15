import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";
import { notifyJob } from "@/lib/slack";
import { activeIgPostUrls } from "@/lib/ig-post-urls";
import { todayKST } from "@/lib/dateRule";

export const runtime = "nodejs";
export const maxDuration = 60;

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * 협찬 게시물 조회수 수집 — 비동기 kickoff (타임아웃 방지).
 * Apify run만 시작하고 즉시 반환 → 완료 시 /api/apify-webhook(handleMonitoring)이 적재.
 * 적재 단계의 단조보정·종료감지 안전장치는 handleMonitoring 에 있음.
 * Vercel 크론(GET) + 수동(POST) 모두 동일 처리.
 */
export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.APIFY_API_TOKEN) {
    await notifyJob("협찬 모니터링", "fail", "APIFY_API_TOKEN 미설정");
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const supabase = getServerSupabase();
  try {
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({ type: "monitoring", status: "pending", user_email: null })
      .select()
      .single();
    if (jobErr || !job) throw new Error(`job 생성 실패: ${jobErr?.message ?? "unknown"}`);
    const jobId = (job as { id: string }).id;

    const { data: posts } = await supabase
      .from("sponsored_posts")
      .select("url, ended_at");
    // 인스타 게시물만, 종료(ended) 제외, shortcode 있는 URL만(프로필형 과수집 방지).
    // 공유 헬퍼 사용 — /api/jobs monitoring 과 동일 로직(경로별 드리프트 방지).
    const urls = activeIgPostUrls((posts ?? []) as { url: string | null; ended_at: string | null }[]);

    if (urls.length === 0) {
      await supabase.from("jobs").update({ status: "done", payload: { saved: 0 } }).eq("id", jobId);
      return NextResponse.json({ ok: true, started: false, reason: "no instagram posts" });
    }

    await supabase.from("jobs").update({ status: "running" }).eq("id", jobId);
    const measuredAt = todayKST();
    const webhook = `${getAppUrl()}/api/apify-webhook?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}&jobId=${jobId}&jobType=monitoring&measuredAt=${encodeURIComponent(measuredAt)}`;
    await startActorRun(
      "apify/instagram-scraper",
      {
        directUrls: urls,
        resultsType: "posts",
        resultsLimit: urls.length,
        addParentData: true,
        maxRequestRetries: 3,
        proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      },
      webhook
    );
    return NextResponse.json({ ok: true, started: true, jobId, urlCount: urls.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyJob("협찬 모니터링", "fail", `수집 시작 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel 크론은 GET으로 호출 → GET=POST 별칭으로 정시 실행 보장.
export const GET = POST;
