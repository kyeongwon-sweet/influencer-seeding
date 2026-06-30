import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";
import { normalizeUrl, ALLOWED_POST_URL_RE } from "@/lib/url-utils";
import { normalizeChannelType } from "@/app/monitoring/lib";

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
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.rows || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "rows 배열이 없습니다" }, { status: 400 });
  }

  // 허용 플랫폼 URL만 (instagram / youtube / tiktok, 서브도메인 포함). 공유 상수 사용.
  const rows = body.rows.filter((r: Record<string, unknown>) => r.url && ALLOWED_POST_URL_RE.test(String(r.url)));
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, upserted: 0 });
  }

  // URL 정규화 (bulk·stats-import와 동일한 normalizeUrl 사용 → 일관성) + 시트 입력 필드 포함
  const cleaned = rows.map((r: Record<string, unknown>) => ({
    url:             normalizeUrl(String(r.url)) || String(r.url),
    posted_at:       r.posted_at || null,
    account_name:    r.account_name || null,
    content_summary: r.content_summary || null,
    channel_type:    normalizeChannelType(r.channel_type ? String(r.channel_type) : null),
    project_name:    r.project_name || null,
    product_name:    r.product_name || null,
    cost:            r.cost != null ? Number(r.cost) : null,
    reach_count:     r.reach_count != null ? Number(r.reach_count) : null,
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
      .map((r: { url: string }) => r.url)
      .filter((u: string) => u.includes("instagram.com"));

    if (igUrls.length > 0) {
      // job 생성 후 Apify 실행
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({ type: "monitoring", status: "pending", payload: {} })
        .select().single();

      if (jobError || !job) {
        // job 생성 실패해도 sync 자체는 성공으로 반환
      } else {
        const runError = await startActorRun(
          "apify/instagram-scraper",
          { directUrls: [...new Set(igUrls)], resultsType: "posts", resultsLimit: igUrls.length, addParentData: true },
          `${appUrl}/api/apify-webhook?token=${encodeURIComponent(webhookSecret)}&jobId=${job.id}&jobType=monitoring`
        ).then(() => null).catch((e: unknown) => e);
        if (runError) {
          await supabase.from("jobs").update({ status: "failed", error: String(runError) }).eq("id", job.id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, upserted: cleaned.length, message: "저장 완료. 게시물 상세 정보를 자동 수집합니다." });
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 없으면 null로 처리됨)
export const GET = POST;
