import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchAllPages } from "@/lib/fetch-all-pages";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  // PostgREST 1,000행 상한에 잘리지 않게 끝까지 넘긴다(유일 정렬 키 필수) — lib/fetch-all-pages.ts
  const { data, error } = await fetchAllPages((from, to) => supabase
    .from("brand_daily_metrics")
    .select("measured_at, yt_views, yt_unique_viewers, yt_search_views, ig_profile_views")
    .order("measured_at", { ascending: true })
    .range(from, to));

  if (error) return NextResponse.json({ error }, { status: 500 });
  // 공유 데이터(일 1회 갱신) → CDN 캐시로 함수 호출·전송량 절감 (인증은 미들웨어가 선검사)
  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } });
}
