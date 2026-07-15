import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";
import { normalizeChannelType } from "@/app/monitoring/lib";

/**
 * 마케팅 대시보드 → 협찬 모니터링 동기화 엔드포인트
 * Authorization: Bearer <VERCEL_CRON_SECRET>
 *
 * 요청 body: {
 *   data: Array<{
 *     posted_at?: string,        // ISO 8601 또는 YYYY-MM-DD
 *     url: string,               // Instagram/YouTube URL (필수)
 *     channel?: string,          // 채널분류 (instagram, youtube, 등)
 *     project_name?: string,     // 프로젝트명
 *     product_name?: string,     // 상품명
 *     cost?: number,             // 비용
 *     caption?: string,          // 게시물 캡션 (현재 저장되지 않음)
 *     performance?: any          // 성과 (현재 저장되지 않음)
 *   }>,
 *   sync_timestamp?: string,
 *   record_count?: number
 * }
 */
export async function POST(req: NextRequest) {

  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.data || !Array.isArray(body.data)) {
    return NextResponse.json({ error: "data 배열이 없습니다" }, { status: 400 });
  }

  // URL 검증: Instagram 또는 YouTube만 허용
  const ALLOWED_URL_RE = /^https:\/\/(www\.)?(instagram\.com|youtube\.com)\//;
  const records = body.data.filter((r: Record<string, unknown>) =>
    r.url && ALLOWED_URL_RE.test(String(r.url))
  );

  if (records.length === 0) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      message: "유효한 URL이 없습니다"
    });
  }

  // 데이터 정규화: 마케팅 시트 형식 → sponsored_posts 테이블 형식
  const cleaned = records.map((r: Record<string, unknown>) => {
    // posted_at 처리: string이면 Date로 변환
    let posted_at: string | null = null;
    if (r.posted_at) {
      const date = new Date(String(r.posted_at));
      if (!isNaN(date.getTime())) {
        posted_at = date.toISOString().split('T')[0]; // YYYY-MM-DD 형식
      }
    }

    // channel 을 channel_type으로 매핑 (표준 표기로 정규화 — 괄호 앞 공백 보장)
    const channel_type = normalizeChannelType(r.channel ? String(r.channel) : null);

    return {
      url: normalizeUrl(String(r.url)) || (String(r.url).replace(/\/$/, "") + "/"),  // 정규화(쿼리 제거 + 끝 /) — bulk/sync와 통일
      posted_at,
      channel_type,
      project_name: r.project_name ? String(r.project_name).trim() : null,
      product_name: r.product_name ? String(r.product_name).trim() : null,
      cost: r.cost != null ? Number(r.cost) : null,
      // 주의: caption과 performance는 현재 저장되지 않음
      // sponsored_posts 테이블에 해당 컬럼이 없으므로
    };
  });

  try {
    const supabase = getServerSupabase();

    // upsert: URL이 이미 있으면 업데이트, 없으면 삽입
    const { error } = await supabase
      .from("sponsored_posts")
      .upsert(cleaned, { onConflict: "url", ignoreDuplicates: false })
      .select();

    if (error) {
      console.error("[marketing/sync] Supabase upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      upserted: cleaned.length,
      sync_timestamp: new Date().toISOString(),
      message: `${cleaned.length}개 레코드 동기화 완료`
    });

  } catch (error) {
    console.error("[marketing/sync] Error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 없으면 null로 처리됨)
export const GET = POST;
