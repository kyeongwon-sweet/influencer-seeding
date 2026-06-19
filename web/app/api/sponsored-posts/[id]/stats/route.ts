import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// PATCH /api/sponsored-posts/[id]/stats
// post_daily_stats 수동 수정: play_count / likes_count / comments_count.
// measured_at 지정 시 그 측정일 행, 미지정/불일치 시 가장 최근 행으로 폴백(없으면 오늘 행 생성).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const toNum = (v: unknown) => v === "" || v == null ? null : Math.round(Number(v));
  const updates: Record<string, number | null> = {};
  for (const key of ["play_count", "likes_count", "comments_count"]) {
    if (key in body) updates[key] = toNum(body[key]);
  }
  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "수정할 필드가 없습니다" }, { status: 400 });

  const supabase = getServerSupabase();
  let targetDate: string | null = body.measured_at ?? null;

  // 지정된 measured_at이 실제 행과 일치하는지 확인 (포맷/타임존 불일치 → 최신으로 폴백)
  if (targetDate) {
    const { data: rows } = await supabase
      .from("post_daily_stats")
      .select("measured_at")
      .eq("post_id", id)
      .eq("measured_at", targetDate)
      .limit(1);
    if (!rows || rows.length === 0) targetDate = null;
  }

  if (!targetDate) {
    const { data: latest } = await supabase
      .from("post_daily_stats")
      .select("measured_at")
      .eq("post_id", id)
      .order("measured_at", { ascending: false })
      .limit(1)
      .single();
    if (!latest) {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from("post_daily_stats")
        .upsert({ post_id: id, measured_at: today, ...updates }, { onConflict: "post_id,measured_at" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, measured_at: today });
    }
    targetDate = latest.measured_at as string;
  }

  // 실제 갱신 + 갱신된 행 확인
  const { data: updated, error } = await supabase
    .from("post_daily_stats")
    .update(updates)
    .eq("post_id", id)
    .eq("measured_at", targetDate)
    .select("measured_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0)
    return NextResponse.json({ error: "수정할 측정 데이터가 없습니다" }, { status: 404 });
  return NextResponse.json({ ok: true, measured_at: targetDate });
}
