import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("sponsored_posts")
    .select("*, influencers(id, name, platform, post_type, category, screening_metrics(*)), post_daily_stats(*)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (data ?? []).map((post) => {
    const stats = (post.post_daily_stats ?? []).sort(
      (a: { measured_at: string }, b: { measured_at: string }) =>
        new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime()
    );
    const screeningList = (post.influencers?.screening_metrics ?? []).sort(
      (a: { run_at: string }, b: { run_at: string }) =>
        new Date(b.run_at).getTime() - new Date(a.run_at).getTime()
    );
    return {
      ...post,
      post_daily_stats: undefined,
      latest_stats: stats[0] ?? null,
      prev_stats: stats[1] ?? null,
      all_stats: [...stats].reverse(),
      influencers: post.influencers ? { ...post.influencers, screening_metrics: undefined } : null,
      latest_metrics: screeningList[0] ?? null,
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const supabase = getServerSupabase();

  if (Array.isArray(body)) {
    const { data, error } = await supabase.from("sponsored_posts").insert(body).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  const { data, error } = await supabase
    .from("sponsored_posts")
    .insert(body)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
