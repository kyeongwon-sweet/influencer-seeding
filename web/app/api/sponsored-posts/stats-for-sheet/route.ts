import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

// 시트 Apps Script가 '자동수집 조회수 → 시트 I열~ 역채움'을 위해 호출하는 라우트.
// URL별 (날짜, 조회수) 목록을 반환. 인증: Authorization: Bearer <CRON_SECRET> (list-for-sheet 등과 동일).
// 반환: { posts: [ { url, stats: [ [measured_at, play_count], ... ] } ] }  (play_count 있는 것만)
export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  const PAGE = 1000;

  // 1) post_id → url
  const urlById = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, url")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) if (p.url) urlById.set(p.id as string, p.url as string);
    if (!data || data.length < PAGE) break;
  }

  // 2) 일자별 조회수(play_count 있는 행만) → url별 그룹
  const byUrl = new Map<string, [string, number][]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .select("post_id, measured_at, play_count")
      .not("play_count", "is", null)
      .order("post_id", { ascending: true })
      .order("measured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const s of data ?? []) {
      const url = urlById.get(s.post_id as string);
      if (!url) continue;
      const arr = byUrl.get(url) ?? [];
      arr.push([s.measured_at as string, s.play_count as number]);
      byUrl.set(url, arr);
    }
    if (!data || data.length < PAGE) break;
  }

  const posts = [...byUrl.entries()].map(([url, stats]) => ({ url, stats }));
  return NextResponse.json({ posts }, { headers: { "Cache-Control": "no-store" } });
}
