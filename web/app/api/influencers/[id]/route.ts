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

  // avg_views_per_follower는 screening_metrics에 upsert (influencers 테이블 컬럼 아님)
  if ("avg_views_per_follower" in body) {
    const { avg_views_per_follower, ...rest } = body;
    const { error } = await supabase
      .from("screening_metrics")
      .upsert({ influencer_id: id, avg_views_per_follower }, { onConflict: "influencer_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (Object.keys(rest).length === 0) return NextResponse.json({ ok: true });
    // 나머지 필드가 있으면 influencers도 업데이트
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
