import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 협찬 모니터링 데이터의 '진짜' 마지막 적재 시각 + 출처(수동 사용자 / 자동 실행)
// - 자동(GitHub Actions/cron): jobs에 기록 없이 post_daily_stats에 직접 적재
// - 수동('지금 수집'): jobs(type=monitoring, status=done)에 user_email과 함께 기록
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();

  const { data: latest, error } = await supabase
    .from("post_daily_stats")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const at = (latest?.[0] as { created_at?: string } | undefined)?.created_at ?? null;
  if (!at) return NextResponse.json({ at: null, byEmail: null });

  // 마지막 적재 시각 ±20분 내에 완료된 수동 작업이 있으면 그 사용자, 없으면 자동 실행
  const atMs = new Date(at).getTime();
  const fromIso = new Date(atMs - 20 * 60 * 1000).toISOString();
  const toIso = new Date(atMs + 20 * 60 * 1000).toISOString();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("user_email, updated_at")
    .eq("type", "monitoring")
    .eq("status", "done")
    .gte("updated_at", fromIso)
    .lte("updated_at", toIso)
    .order("updated_at", { ascending: false })
    .limit(1);

  const byEmail = (jobs?.[0] as { user_email?: string } | undefined)?.user_email ?? null;
  return NextResponse.json({ at, byEmail }, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } });
}
