import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("sponsored_posts")
    .select("*, influencers(id, name, platform, post_type, screening_metrics(*)), post_daily_stats(*)")
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

// UTM 등 트래킹 파라미터 제거 → 정규화된 URL 반환
function cleanPostUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // path만 유지 (쿼리 스트링 전체 제거)
    const path = u.pathname.endsWith("/") ? u.pathname : u.pathname + "/";
    return `${u.origin}${path}`;
  } catch { return raw; }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const supabase = getServerSupabase();

  if (Array.isArray(body)) {
    // URL 정규화 + 빈 URL 제거
    const rows = body
      .map(r => ({ ...r, url: r.url ? cleanPostUrl(r.url) : r.url }))
      .filter(r => r.url);
    // upsert: URL이 이미 있으면 새 컬럼값으로 업데이트, 없으면 삽입
    const { data, error } = await supabase
      .from("sponsored_posts")
      .upsert(rows, { onConflict: "url" })
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  const cleaned = { ...body, url: body.url ? cleanPostUrl(body.url) : body.url };
  const { data, error } = await supabase
    .from("sponsored_posts")
    .insert(cleaned)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
