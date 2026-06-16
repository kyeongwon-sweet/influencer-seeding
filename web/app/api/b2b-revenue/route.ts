import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 저장된 B2B 일자별 현황을 반환한다. (대시보드용)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = getServerSupabase();
  let q = supabase.from("b2b_daily_metrics").select("*").order("date", { ascending: true });
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
