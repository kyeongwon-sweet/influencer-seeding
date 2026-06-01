import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

/**
 * Google Sheets Apps Script에서 호출하는 협찬 게시물 동기화 엔드포인트
 * Authorization: Bearer <CRON_SECRET>
 *
 * 요청 body: { rows: Array<{
 *   url: string,              // 게시물 URL (필수, 중복 방지 키)
 *   project_name?: string,   // 프로젝트명
 *   product_name?: string,   // 상품명
 *   channel_type?: string,   // 채널분류
 *   account_name?: string,   // 인플루언서명
 *   posted_at?: string,      // 게시일 (YYYY-MM-DD)
 *   cost?: number,           // 비용 (원)
 *   reach_count?: number,    // 도달수
 *   content_summary?: string // 캡션
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

  // URL 정규화 (trailing slash 통일)
  const cleaned = rows.map((r: Record<string, unknown>) => ({
    ...r,
    url: String(r.url).replace(/\/$/, "") + "/",
    cost: r.cost != null ? Number(r.cost) : null,
    reach_count: r.reach_count != null ? Number(r.reach_count) : null,
  }));

  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("sponsored_posts")
    .upsert(cleaned, { onConflict: "url", ignoreDuplicates: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, upserted: cleaned.length });
}
