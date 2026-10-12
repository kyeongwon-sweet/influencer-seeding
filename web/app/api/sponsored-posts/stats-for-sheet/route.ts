import { NextRequest, NextResponse } from "next/server";
import { isBannerChannel } from "@/app/monitoring/lib";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { postIdentityKey } from "@/lib/url-utils";

// 시트 Apps Script가 '자동수집 조회수 → 시트 I열~ 역채움'을 위해 호출하는 라우트.
// URL별 (날짜, 조회수) 목록을 반환. 인증: Authorization: Bearer <CRON_SECRET> (list-for-sheet 등과 동일).
// 반환: { posts: [ { url, key, ended_at, stats: [ [measured_at, metric, manual, zero_confirmed], ... ] } ] }
// 배너 metric = reach_count, 그 외 metric = play_count.
// manual=false인 자동 수집값만 Apps Script가 기존 날짜 셀을 DB 정본으로 갱신한다.
// manual=true인 사람 입력값은 빈칸 보강에만 쓰고, 이미 있는 시트 수기값은 보존한다.
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
  const youtubeById = new Map<string, boolean>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, url, posted_at, channel_type, ended_at")
      .order("id", { ascending: true })
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
      bannerById.set(p.id as string, isBannerChannel(p.channel_type, p.posted_at));
      youtubeById.set(p.id as string, /(?:youtube\.com|youtu\.be)/i.test(String(p.url ?? "")));
    }
    if (!data || data.length < PAGE) break;
  }

  // 2) 일자별 지표 → canonical key별 그룹
  const byKey = new Map<string, Map<string, { value: number; manual: boolean; zeroConfirmed: boolean }>>();
  let prePostedDropped = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .select("id, post_id, measured_at, play_count, reach_count, manual, created_at")
      .order("post_id", { ascending: true })
      .order("measured_at", { ascending: true })
      .order("id", { ascending: true })
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
      // 배너는 모두 도달수가 정본이다. 출처(manual)를 함께 내려 보내므로, 사람이 넣은 reach는
      // 기존 시트 셀을 덮지 않고 빈칸만 보강할 수 있다. 반대로 자동 수집값은 기존 오염 셀도 교정한다.
      const metric = bannerById.get(s.post_id as string) ? s.reach_count : s.play_count;
      if (metric == null || !Number.isFinite(Number(metric)) || Number(metric) < 0) continue;
      // 0은 일반적으로 액터 결측의 대리값일 수 있어 계속 차단한다. 다만 YouTube는 공식 Data API
      // 검증 경로가 배포된 시점 이후 자동 0과 사람이 직접 확인한 manual 0만 실측으로 인정한다.
      // 이 마커 없이는 Apps Script가 0을 공란으로 버려 DB와 연동시트가 영구 불일치했다.
      const zeroConfirmed = Number(metric) === 0
        && youtubeById.get(s.post_id as string) === true
        && (Boolean(s.manual) || String(s.created_at ?? "") >= "2026-10-12T00:55:00");
      if (Number(metric) === 0 && !zeroConfirmed) continue;
      const byDate = byKey.get(key) ?? new Map<string, { value: number; manual: boolean; zeroConfirmed: boolean }>();
      const prev = byDate.get(measuredAt);
      const candidate = { value: Number(metric), manual: Boolean(s.manual), zeroConfirmed };
      if (prev == null || candidate.value > prev.value) {
        // 같은 canonical key/date에 중복 게시물 행이 있으면 어느 쪽이 정본인지 불명확하다.
        // 하나라도 수기면 보수적으로 manual=true로 내려 기존 시트값을 덮지 않는다.
        byDate.set(measuredAt, {
          ...candidate,
          manual: candidate.manual || Boolean(prev?.manual),
          zeroConfirmed: candidate.zeroConfirmed || Boolean(prev?.zeroConfirmed),
        });
      } else if ((candidate.manual && !prev.manual) || (candidate.zeroConfirmed && !prev.zeroConfirmed)) {
        byDate.set(measuredAt, {
          ...prev,
          manual: prev.manual || candidate.manual,
          zeroConfirmed: prev.zeroConfirmed || candidate.zeroConfirmed,
        });
      }
      byKey.set(key, byDate);
    }
    if (!data || data.length < PAGE) break;
  }

  const posts = [...byKey.entries()].map(([key, byDate]) => ({
    url: urlByKey.get(key) ?? key,
    key,
    ended_at: activeKey.has(key) ? null : endedByKey.get(key) ?? null,
    stats: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stat]) => [date, stat.value, stat.manual, stat.zeroConfirmed] as const),
  }));
  let endedWithoutStats = 0;
  for (const [key, endedAt] of endedByKey.entries()) {
    if (activeKey.has(key) || byKey.has(key)) continue;
    endedWithoutStats++;
    posts.push({
      url: urlByKey.get(key) ?? key,
      key,
      ended_at: endedAt,
      stats: [],
    });
  }
  return NextResponse.json(
    { posts, pre_posted_dropped: prePostedDropped, ended_without_stats: endedWithoutStats },
    { headers: { "Cache-Control": "no-store" } }
  );
}
