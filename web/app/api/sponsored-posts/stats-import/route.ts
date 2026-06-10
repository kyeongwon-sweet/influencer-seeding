import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, ALLOWED_POST_URL_RE } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 구글 시트 Apps Script → 일자별 조회수(post_daily_stats) 백필 (인증 불필요)
 *
 * 입력: {
 *   posts?: [{ url, posted_at?, account_name?, content_summary?, channel_type?, project_name?, product_name?, cost? }],
 *   stats:  [{ url, measured_at: "YYYY-MM-DD", play_count: number }]
 * }   (구버전 호환: stats 배열만 단독으로 보내도 됨)
 *
 * 처리:
 *  1) posts 중 사이트에 "없는 URL만" 신규 생성 (insert-only).
 *     → 이미 있는 광고 정보는 절대 덮어쓰지 않음 (ignoreDuplicates).
 *  2) url → post_id 매칭 후 post_daily_stats upsert (onConflict post_id,measured_at).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const statsIn = Array.isArray(body)
    ? body
    : Array.isArray(body?.stats) ? body.stats
    : Array.isArray(body?.rows) ? body.rows
    : null;
  if (!statsIn) {
    return NextResponse.json({ error: "stats 배열이 필요합니다" }, { status: 400 });
  }
  const postsIn: Array<Record<string, unknown>> = Array.isArray(body?.posts) ? body.posts : [];

  // 조회수: 정규화 + (url, measured_at) 중복 제거 (마지막 값 우선)
  const byKey = new Map<string, { url: string; measured_at: string; play_count: number }>();
  for (const r of statsIn as Array<Record<string, unknown>>) {
    if (!r || !r.url || !r.measured_at) continue;
    const url = normalizeUrl(String(r.url)) || String(r.url);
    if (r.play_count === null || r.play_count === undefined || r.play_count === "") continue;
    const play_count = Number(r.play_count);
    if (!Number.isFinite(play_count)) continue;
    byKey.set(`${url}|${String(r.measured_at)}`, { url, measured_at: String(r.measured_at), play_count });
  }
  const items = [...byKey.values()];

  // 광고 메타: 정규화 + url 중복 제거 (첫 값 우선)
  const POST_FIELDS = ["posted_at", "account_name", "content_summary", "channel_type", "project_name", "product_name", "cost"];
  const postByUrl = new Map<string, Record<string, unknown>>();
  for (const p of postsIn) {
    if (!p || !p.url) continue;
    const url = normalizeUrl(String(p.url)) || String(p.url);
    if (!ALLOWED_POST_URL_RE.test(url)) continue; // 허용 플랫폼만 신규 생성
    if (postByUrl.has(url)) continue;
    const clean: Record<string, unknown> = { url };
    for (const f of POST_FIELDS) if (p[f] !== undefined && p[f] !== "") clean[f] = p[f]; // ""→ 제외(date/numeric 캐스트 오류 방지)
    postByUrl.set(url, clean);
  }

  const supabase = getServerSupabase();

  const allUrls = [...new Set([...items.map(i => i.url), ...postByUrl.keys()])];
  if (allUrls.length === 0) return NextResponse.json({ ok: true, inserted: 0, created_posts: 0, matched_urls: 0, missing_urls: 0 });

  // 1) 기존 URL → id + 현재 메타 조회 (한 번만) — '빈 값만 채우기' 비교용으로 메타도 함께 조회
  const { data: existing, error: ee } = await supabase
    .from("sponsored_posts")
    .select(`id, url, ${POST_FIELDS.join(", ")}`)
    .in("url", allUrls);
  if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });
  const idByUrl = new Map<string, string>((existing ?? []).map((e: { id: string; url: string }) => [e.url, e.id]));
  const existingByUrl = new Map<string, Record<string, unknown>>(
    (existing ?? []).map((e: Record<string, unknown>) => [String(e.url), e])
  );

  // 2) 없는 광고만 신규 생성 (기존은 절대 건드리지 않음). 새로 만든 id를 매핑에 합침 → 재조회 불필요.
  let created = 0;
  const toCreate = [...postByUrl.values()].filter(p => !idByUrl.has(String(p.url)));
  if (toCreate.length > 0) {
    const { data: ins, error: ie } = await supabase
      .from("sponsored_posts")
      .upsert(toCreate, { onConflict: "url", ignoreDuplicates: true })
      .select("id, url");
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 });
    for (const row of (ins ?? []) as Array<{ id: string; url: string }>) idByUrl.set(row.url, row.id);
    created = (ins ?? []).length;
  }

  // 2-b) '빈 값만 채우기': 기존 게시물 중 사이트 값이 비어있는(null/"") 필드만 시트 값으로 채움.
  //      이미 값이 있는 필드는 절대 안 건드림 → 사이트에서 직접 수정한 값 보존.
  let metaFilled = 0;
  for (const [url, meta] of postByUrl) {
    const ex = existingByUrl.get(url);
    if (!ex) continue; // 신규 생성분은 이미 전체 메타로 만들어짐
    const upd: Record<string, unknown> = {};
    for (const f of POST_FIELDS) {
      const cur = ex[f];
      const curEmpty = cur === null || cur === undefined || cur === "";
      // meta[f]는 시트의 비어있지 않은 값만 들어있음(위 clean 생성 기준)
      if (curEmpty && meta[f] !== undefined) upd[f] = meta[f];
    }
    if (Object.keys(upd).length > 0) {
      const { error: ue } = await supabase
        .from("sponsored_posts").update(upd).eq("id", String(ex.id));
      if (!ue) metaFilled++;
    }
  }

  // 3) 게시물 매칭 (미등록 URL은 건너뜀)
  const missing = new Set<string>();
  const incomingByPost = new Map<string, Array<{ measured_at: string; play_count: number }>>();
  for (const it of items) {
    const pid = idByUrl.get(it.url);
    if (!pid) { missing.add(it.url); continue; }
    const arr = incomingByPost.get(pid) ?? [];
    arr.push({ measured_at: it.measured_at, play_count: it.play_count });
    incomingByPost.set(pid, arr);
  }
  const postIds = [...incomingByPost.keys()];

  // 4) 기존 post_daily_stats 조회 (누적 감소 판정 기준) — 페이지네이션으로 전량
  const existingByPost = new Map<string, Array<{ measured_at: string; play_count: number }>>();
  if (postIds.length > 0) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: pe2 } = await supabase
        .from("post_daily_stats")
        .select("post_id, measured_at, play_count")
        .in("post_id", postIds)
        .range(from, from + PAGE - 1);
      if (pe2) return NextResponse.json({ error: pe2.message }, { status: 500 });
      for (const s of (page ?? []) as Array<{ post_id: string; measured_at: string; play_count: number | null }>) {
        const arr = existingByPost.get(s.post_id) ?? [];
        arr.push({ measured_at: s.measured_at, play_count: Number(s.play_count ?? 0) });
        existingByPost.set(s.post_id, arr);
      }
      if (!page || page.length < PAGE) break;
    }
  }

  // 5) 누적 감소 가드: 기존+신규를 날짜순 병합해, "그보다 이른 날짜들의 최대"보다 낮은
  //    신규 값은 dip(수집/입력 오류)으로 보고 저장하지 않음. (과거의 정상적인 낮은 값은 보존)
  const statsRows: Array<{ post_id: string; measured_at: string; play_count: number }> = [];
  let droppedDecrease = 0;
  for (const pid of postIds) {
    const incomingArr = incomingByPost.get(pid) ?? [];
    const incomingDates = new Set(incomingArr.map(x => x.measured_at));
    const timeline = [
      ...(existingByPost.get(pid) ?? []).filter(e => !incomingDates.has(e.measured_at)).map(e => ({ ...e, incoming: false })),
      ...incomingArr.map(e => ({ ...e, incoming: true })),
    ].sort((a, b) => (a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : 0));

    let maxSoFar = 0;
    for (const e of timeline) {
      if (e.incoming) {
        if (e.play_count >= maxSoFar) {
          statsRows.push({ post_id: pid, measured_at: e.measured_at, play_count: e.play_count });
          maxSoFar = e.play_count;
        } else {
          droppedDecrease++; // 이른 날짜 최대보다 낮음 = 누적 감소 → 저장 안 함
        }
      } else if (e.play_count > maxSoFar) {
        maxSoFar = e.play_count;
      }
    }
  }

  let inserted = 0;
  if (statsRows.length > 0) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .upsert(statsRows, { onConflict: "post_id,measured_at" })
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted = (data ?? []).length;
  }

  return NextResponse.json({
    ok: true,
    inserted,
    created_posts: created,
    meta_filled: metaFilled,
    dropped_decrease: droppedDecrease,
    matched_urls: [...new Set(items.map(i => i.url))].length - missing.size,
    missing_urls: missing.size,
    missing_sample: [...missing].slice(0, 5),
  });
}
