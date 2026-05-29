import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export type KpiMetric = {
  label: string;
  target: number | null;
  current: number | null;
  achievement: number | null;
};

export type KpiSnapshot = {
  id: string;
  fetched_at: string;
  month_label: string | null;
  metrics: KpiMetric[];
};

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("kpi_snapshots")
    .select("*")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ __error: error.message, __code: error.code });
  return NextResponse.json(data);
}
