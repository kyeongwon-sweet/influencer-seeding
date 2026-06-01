import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const supabase = getServerSupabase();

  // avg_views_per_follower / followers는 screening_metrics에 저장 (influencers 테이블 컬럼 아님)
  const METRICS_FIELDS = ["avg_views_per_follower", "followers"] as const;
  const hasMetricsField = METRICS_FIELDS.some(f => f in body);
  if (hasMetricsField) {
    const { avg_views_per_follower, followers, ...rest } = body;
    const metricsUpdate: Record<string, number | null> = {};
    if ("avg_views_per_follower" in body) metricsUpdate.avg_views_per_follower = avg_views_per_follower;
    if ("followers" in body) metricsUpdate.followers = followers;
    // screening_metrics는 복합 PK(influencer_id + run_at)이므로 upsert 대신
    // 가장 최근 행 UPDATE → 없으면 INSERT
    const { data: existing } = await supabase
      .from("screening_metrics")
      .select("influencer_id, run_at")
      .eq("influencer_id", id)
      .order("run_at", { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      await supabase.from("screening_metrics")
        .update(metricsUpdate)
        .eq("influencer_id", id)
        .eq("run_at", existing[0].run_at);
    } else {
      const { error } = await supabase.from("screening_metrics")
        .insert({ influencer_id: id, ...metricsUpdate });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (Object.keys(rest).length === 0) return NextResponse.json({ ok: true });
    const { data, error: err2 } = await supabase.from("influencers").update(rest).eq("id", id).select().single();
    if (err2) return NextResponse.json({ error: err2.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("influencers")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("influencers")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
