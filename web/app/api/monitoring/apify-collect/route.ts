import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";
import { notifyJob } from "@/lib/slack";

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
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
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
    // 인스타 게시물만, 종료(ended) 제외 — 비용↓·노이즈↓
    const urls = [...new Set(
      ((posts ?? []) as { url: string; ended_at: string | null }[])
        .filter((p) => (p.url || "").includes("instagram.com") && !p.ended_at)
        .map((p) => p.url)
    )];

    if (urls.length === 0) {
      await supabase.from("jobs").update({ status: "done", payload: { saved: 0 } }).eq("id", jobId);
      return NextResponse.json({ ok: true, started: false, reason: "no instagram posts" });
    }

    await supabase.from("jobs").update({ status: "running" }).eq("id", jobId);
    const webhook = `${getAppUrl()}/api/apify-webhook?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}&jobId=${jobId}&jobType=monitoring`;
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
