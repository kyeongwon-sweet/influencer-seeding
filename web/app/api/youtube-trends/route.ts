import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("youtube_search_trends")
    .select("measured_at, keyword, value")
    .order("measured_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // 공유 데이터(일 1회 갱신) → CDN 캐시로 함수 호출·전송량 절감 (인증은 미들웨어가 선검사)
  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } });
}
