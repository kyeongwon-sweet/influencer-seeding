import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// PATCH /api/sponsored-posts/[id]/stats
// 가장 최근 post_daily_stats 행의 play_count를 수동 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { play_count } = await req.json() as { play_count: number | null };
  const supabase = getServerSupabase();

  // 가장 최근 measured_at 찾기
  const { data: latest } = await supabase
    .from("post_daily_stats")
    .select("measured_at")
    .eq("post_id", id)
    .order("measured_at", { ascending: false })
    .limit(1)
    .single();

  if (!latest) {
    // 오늘 날짜로 새 행 insert
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("post_daily_stats")
      .upsert({ post_id: id, measured_at: today, play_count }, { onConflict: "post_id,measured_at" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, measured_at: today });
  }

  const { error } = await supabase
    .from("post_daily_stats")
    .update({ play_count })
    .eq("post_id", id)
    .eq("measured_at", latest.measured_at);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, measured_at: latest.measured_at });
}
