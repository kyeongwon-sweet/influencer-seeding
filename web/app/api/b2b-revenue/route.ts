import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchAllPages } from "@/lib/fetch-all-pages";

// 저장된 B2B 일자별 현황을 반환한다. (대시보드용)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = getServerSupabase();
  // PostgREST 1,000행 상한에 잘리지 않게 끝까지 넘긴다(유일 정렬 키 필수) — lib/fetch-all-pages.ts
  const { data, error } = await fetchAllPages((pageFrom, pageTo) => {
    let q = supabase.from("b2b_daily_metrics").select("*");
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);
    return q.order("date", { ascending: true }).range(pageFrom, pageTo);
  });
  if (error) return NextResponse.json({ error }, { status: 500 });
  // 공유 데이터(일 1회 갱신) → CDN 캐시로 함수 호출·전송량 절감 (인증은 미들웨어가 선검사)
  return NextResponse.json({ rows: data ?? [] }, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } });
}
