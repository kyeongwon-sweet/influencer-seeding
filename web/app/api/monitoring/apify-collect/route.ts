import { NextRequest, NextResponse } from "next/server";
import { instagramRequestUrl } from "@/lib/url-utils";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";
import { notifyJob } from "@/lib/slack";
import { activeIgPostUrls } from "@/lib/ig-post-urls";
import { resolveMonitoringMeasuredAt } from "@/lib/dateRule";

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
 * 예약/폴백 비동기 경로다. 사람이 당일값을 즉시 수집할 때는 `/api/monitoring/collect-now`를 쓴다.
 */
export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.APIFY_API_TOKEN) {
    await notifyJob("협찬 모니터링", "fail", "APIFY_API_TOKEN 미설정");
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  // 유효하지 않은 날짜면 job을 만들기 전에 차단해 running 상태 고아 job을 남기지 않는다.
  let measuredAt: string;
  try {
    measuredAt = resolveMonitoringMeasuredAt(req.nextUrl.searchParams.get("date"), "scheduled");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
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
    // 날짜는 kickoff 시점에 확정해 webhook까지 전달한다. webhook 도착 시각으로 재추정하면
    // 자정 전후 콜백이 다른 날짜에 적재돼 누적 조회수가 역행할 수 있다.
    const webhook = `${getAppUrl()}/api/apify-webhook?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}&jobId=${jobId}&jobType=monitoring&measuredAt=${encodeURIComponent(measuredAt)}`;
    await startActorRun(
      "apify/instagram-scraper",
      {
        // 요청 URL만 `/reel/`로 통일(2026-08-19 실측: `/p/` 요청엔 videoPlayCount 미반환).
        directUrls: urls.map(instagramRequestUrl),
        resultsType: "posts",
        resultsLimit: urls.length,
        addParentData: true,
        maxRequestRetries: 3,
        proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      },
      webhook
    );
    return NextResponse.json({ ok: true, started: true, jobId, urlCount: urls.length, measuredAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyJob("협찬 모니터링", "fail", `수집 시작 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel 크론은 GET으로 호출 → GET=POST 별칭으로 정시 실행 보장.
export const GET = POST;
