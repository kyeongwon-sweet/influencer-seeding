import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { postIdentityKey } from "@/lib/url-utils";

// 시트 Apps Script가 '자동수집 조회수 → 시트 I열~ 역채움'을 위해 호출하는 라우트.
// URL별 (날짜, 조회수) 목록을 반환. 인증: Authorization: Bearer <CRON_SECRET> (list-for-sheet 등과 동일).
// 반환: { posts: [ { url, key, ended_at, stats: [ [measured_at, metric], ... ] } ] }
// 배너 metric = reach_count ?? play_count, 그 외 metric = play_count.
export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  const PAGE = 1000;

  // 1) post_id → canonical key
  //    IG는 /p/·/reel/·/tv/가 같은 shortcode라 normalizeUrl 기준으로 묶는다.
  const keyById = new Map<string, string>();
  const urlByKey = new Map<string, string>();
  const postedAtById = new Map<string, string>();
  const endedByKey = new Map<string, string>();
  const activeKey = new Set<string>();
  const bannerById = new Map<string, boolean>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, url, posted_at, channel_type, ended_at")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) {
      if (p.url) {
        const rawUrl = String(p.url);
        const key = postIdentityKey(rawUrl) ?? rawUrl.trim();
        keyById.set(p.id as string, key);
        if (!urlByKey.has(key)) urlByKey.set(key, rawUrl);
        if (p.ended_at) {
          const endedAt = String(p.ended_at).slice(0, 10);
          const prev = endedByKey.get(key);
          if (!prev || endedAt > prev) endedByKey.set(key, endedAt);
        } else {
          activeKey.add(key);
        }
      }
      if (p.posted_at) postedAtById.set(p.id as string, String(p.posted_at).slice(0, 10));
      bannerById.set(p.id as string, String(p.channel_type ?? "").includes("배너"));
    }
    if (!data || data.length < PAGE) break;
  }

  // 2) 일자별 지표 → canonical key별 그룹
  const byKey = new Map<string, Map<string, number>>();
  let prePostedDropped = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .select("post_id, measured_at, play_count, reach_count")
      .order("post_id", { ascending: true })
      .order("measured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const s of data ?? []) {
      const key = keyById.get(s.post_id as string);
      if (!key) continue;
      const measuredAt = String(s.measured_at).slice(0, 10);
      const postedAt = postedAtById.get(s.post_id as string);
      if (postedAt && measuredAt < postedAt) {
        prePostedDropped++;
        continue;
      }
      const metric = bannerById.get(s.post_id as string)
        ? (s.reach_count ?? s.play_count)
        : s.play_count;
      if (metric == null || Number(metric) <= 0) continue;
      const byDate = byKey.get(key) ?? new Map<string, number>();
      const prev = byDate.get(measuredAt);
      if (prev == null || Number(metric) > prev) byDate.set(measuredAt, Number(metric));
      byKey.set(key, byDate);
    }
    if (!data || data.length < PAGE) break;
  }

  const posts = [...byKey.entries()].map(([key, byDate]) => ({
    url: urlByKey.get(key) ?? key,
    key,
    ended_at: activeKey.has(key) ? null : endedByKey.get(key) ?? null,
    stats: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)),
  }));
  return NextResponse.json(
    { posts, pre_posted_dropped: prePostedDropped },
    { headers: { "Cache-Control": "no-store" } }
  );
}
