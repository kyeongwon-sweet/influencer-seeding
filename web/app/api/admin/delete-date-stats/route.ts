import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { auth } from "@clerk/nextjs/server";

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { date } = await req.json();
  if (!date) return NextResponse.json({ error: "Date required" }, { status: 400 });

  const supabase = getServerSupabase();

  // 삭제 건수는 delete 자체의 count로 집계 — data.length는 1000행 캡에 잘려 과소 보고됨
  const { error, count } = await supabase
    .from("post_daily_stats")
    .delete({ count: "exact" })
    .eq("measured_at", date);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  console.log(`[DELETE] ${date}: ${count ?? 0}건 삭제`);
  return NextResponse.json({ deleted: count ?? 0, date });
}
