import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { auth } from "@clerk/nextjs/server";

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { date } = await req.json();
  if (!date) return NextResponse.json({ error: "Date required" }, { status: 400 });

  const supabase = getServerSupabase();

  // 먼저 삭제될 데이터 개수 확인
  const { data: toDelete } = await supabase
    .from("post_daily_stats")
    .select("id", { count: "exact" })
    .eq("measured_at", date);

  const count = toDelete?.length ?? 0;
  console.log(`[DELETE] ${date}: ${count}건 삭제 예정`);

  const { error } = await supabase
    .from("post_daily_stats")
    .delete()
    .eq("measured_at", date);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: count, date });
}
