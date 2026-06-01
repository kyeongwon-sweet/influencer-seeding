import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";

/**
 * Google Sheets → 협찬 모니터링 동기화 엔드포인트
 * Authorization: Bearer <CRON_SECRET>
 *
 * 최소 입력: url, project_name, channel_type, cost
 * 자동 수집: account_name, posted_at, content_summary (Apify), play_count (모니터링 잡)
 *
 * 요청 body: { rows: Array<{
 *   url: string,              // 게시물 URL (필수)
 *   project_name?: string,
 *   channel_type?: string,
 *   cost?: number,
 *   product_name?: string,   // 선택
 *   reach_count?: number,    // 선택
 * }> }
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.rows || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "rows 배열이 없습니다" }, { status: 400 });
  }

  // URL이 없는 행 제거
  const rows = body.rows.filter((r: Record<string, unknown>) => r.url && String(r.url).startsWith("http"));
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, upserted: 0 });
  }

  // URL 정규화
  const cleaned = rows.map((r: Record<string, unknown>) => ({
    url:           String(r.url).replace(/\/$/, "") + "/",
    project_name:  r.project_name || null,
    channel_type:  r.channel_type || null,
    cost:          r.cost != null ? Number(r.cost) : null,
    product_name:  r.product_name || null,
    reach_count:   r.reach_count != null ? Number(r.reach_count) : null,
  }));

  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("sponsored_posts")
    .upsert(cleaned, { onConflict: "url", ignoreDuplicates: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 저장 후 Apify로 게시물 상세 정보 자동 수집 (account_name, posted_at, caption, 조회수)
  const appUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : `https://${process.env.VERCEL_URL}`;
  const webhookSecret = process.env.WEBHOOK_SECRET ?? "";

  if (process.env.APIFY_API_TOKEN) {
    // Instagram URL만 Apify 스크래핑
    const igUrls = cleaned
      .map(r => r.url)
      .filter(u => u.includes("instagram.com"));

    if (igUrls.length > 0) {
      // job 생성 후 Apify 실행
      const { data: job } = await supabase
        .from("jobs")
        .insert({ type: "monitoring", status: "pending", payload: {} })
        .select().single();

      if (job) {
        await startActorRun(
          "apify/instagram-scraper",
          { directUrls: [...new Set(igUrls)], resultsType: "posts", resultsLimit: igUrls.length, addParentData: true },
          `${appUrl}/api/apify-webhook?token=${encodeURIComponent(webhookSecret)}&jobId=${job.id}&jobType=monitoring`
        ).catch(() => { /* 실패해도 sync 자체는 성공 */ });
      }
    }
  }

  return NextResponse.json({ ok: true, upserted: cleaned.length, message: "저장 완료. 게시물 상세 정보를 자동 수집합니다." });
}
