import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();

  // 모든 협찬 게시물의 일일 통계 조회
  const { data: dailyStats, error } = await supabase
    .from("post_daily_stats")
    .select("measured_at, play_count, likes_count, comments_count")
    .order("measured_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!dailyStats || dailyStats.length === 0) {
    return NextResponse.json([]);
  }

  // 날짜별로 그룹화 및 합계 계산
  const summary = new Map<
    string,
    { date: string; play_count: number; likes_count: number; comments_count: number }
  >();

  for (const stat of dailyStats) {
    const date = stat.measured_at;
    if (!summary.has(date)) {
      summary.set(date, {
        date,
        play_count: 0,
        likes_count: 0,
        comments_count: 0,
      });
    }

    const current = summary.get(date)!;
    current.play_count += stat.play_count ?? 0;
    current.likes_count += stat.likes_count ?? 0;
    current.comments_count += stat.comments_count ?? 0;
  }

  // 날짜순 정렬
  const result = Array.from(summary.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return NextResponse.json(result);
}
