import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, ALLOWED_POST_URL_RE } from "@/lib/url-utils";
import { filterMonotonicStats, type GuardInput } from "@/lib/stats-guard";
import { normalizeChannelType, isFreeChannel } from "@/app/monitoring/lib";
import { resolveTikTokShortUrl } from "@/lib/sponsored-write";
import { todayKST } from "@/lib/dateRule";
import { isBannerChannelType } from "@/lib/banner-metric";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 구글 시트 Apps Script → 일자별 조회수(post_daily_stats) 백필
 *
 * 인증: Authorization: Bearer <CRON_SECRET>. 미설정 시 무조건 차단(fail-closed).
 *   조회수는 누계라 한 번 외부에서 오염되면 그래프가 영구히 깨지므로 반드시 보호.
 *
 * 입력: {
 *   posts?: [{ url, posted_at?, account_name?, company_name?, content_summary?, channel_type?, project_name?, product_name?, cost? }],
 *   stats:  [{ url, measured_at: "YYYY-MM-DD", play_count: number }]
 * }   (구버전 호환: stats 배열만 단독으로 보내도 됨)
 *
 * 처리:
 *  1) posts 중 사이트에 "없는 URL만" 신규 생성 (insert-only).
 *     → 이미 있는 광고 정보는 절대 덮어쓰지 않음 (ignoreDuplicates).
 *  2) url → post_id 매칭 후 post_daily_stats upsert (onConflict post_id,measured_at).
 */
export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // 틱톡 단축링크(vt.tiktok)를 실제 영상 URL로 선해석 — 안 하면 단축형 그대로 저장·매칭돼
  // 수집 실패·정식링크 재등록 시 중복·조회수 미매칭이 생김(2026-07-07 시으니네(TT) 사례).
  // 고유 vt 링크당 네트워크 1회(드묾), 해석 실패 시 원본 유지.
  const shortSet = new Set<string>();
  for (const r of [...(statsIn as Array<Record<string, unknown>>), ...postsIn]) {
    const u = r?.url ? String(r.url) : "";
    if (/^https?:\/\/vt\.tiktok\.com\//i.test(u)) shortSet.add(u);
  }
  const shortMap = new Map<string, string>();
  for (const u of shortSet) shortMap.set(u, await resolveTikTokShortUrl(u));
  const resolveU = (u: string) => shortMap.get(u) ?? u;

  // 조회수: 정규화 + (url, measured_at) 중복 제거 (마지막 값 우선)
  const byKey = new Map<string, { url: string; measured_at: string; play_count: number }>();
  for (const r of statsIn as Array<Record<string, unknown>>) {
    if (!r || !r.url || !r.measured_at) continue;
    const url = normalizeUrl(resolveU(String(r.url))) || String(r.url);
    if (r.play_count === null || r.play_count === undefined || r.play_count === "") continue;
    const play_count = Number(r.play_count);
    if (!Number.isFinite(play_count)) continue;
    // 시트 셀 0 = 대개 '아직 데이터 없음(미입력 placeholder)'이지 '조회수 0회'가 아님.
    // 0을 적재하면 0-오염 → 리포트 뻥튀기·정리 시 행없음 공백 유발(2026-07-03/04 233건 사고).
    // 수집기(틱톡 clamp·IG NULL)와 동일하게 '수집 실패 ≠ 0' 원칙으로 0은 미적재.
    if (play_count === 0) continue;
    byKey.set(`${url}|${String(r.measured_at)}`, { url, measured_at: String(r.measured_at), play_count });
  }
  const items = [...byKey.values()];

  // 광고 메타: 정규화 + url 중복 제거 (첫 값 우선)
  const POST_FIELDS = ["posted_at", "account_name", "company_name", "content_summary", "channel_type", "project_name", "product_name", "cost"];
  const postByUrl = new Map<string, Record<string, unknown>>();
  for (const p of postsIn) {
    if (!p || !p.url) continue;
    const url = normalizeUrl(resolveU(String(p.url))) || String(p.url);
    if (!ALLOWED_POST_URL_RE.test(url)) continue; // 허용 플랫폼만 신규 생성
    if (postByUrl.has(url)) continue;
    const clean: Record<string, unknown> = { url };
    // != null 로 null·undefined 모두 제외 — 시트(importStats)가 빈 캡션 셀을 content_summary:null로 보내는데,
    // 예전 가드(!== undefined && !== "")는 null을 통과시켜 '캡션은 시트값 우선' 정책과 결합, 스크랩해둔 캡션을
    // null로 반복 삭제했음(2026-07-06 실사고: 채움→importStats→삭제 2회 반복).
    for (const f of POST_FIELDS) if (p[f] != null && p[f] !== "") clean[f] = f === "channel_type" ? normalizeChannelType(String(p[f])) : p[f];
    // 무상채널(위성/온드)은 업체명·광고비가 없어야 함 → 신규 생성 시 강제(owned-satellite-no-cost-rule)
    if (isFreeChannel(clean.channel_type)) { clean.company_name = null; clean.cost = 0; }
    postByUrl.set(url, clean);
  }

  const supabase = getServerSupabase();

  const allUrls = [...new Set([...items.map(i => i.url), ...postByUrl.keys()])];
  if (allUrls.length === 0) return NextResponse.json({ ok: true, inserted: 0, created_posts: 0, matched_urls: 0, missing_urls: 0 });

  // 1) 기존 URL → id + 현재 메타 조회 (한 번만) — '빈 값만 채우기' 비교용으로 메타도 함께 조회
  // ⚠️ URL이 많으면 .in() 쿼리 URL 길이 한도 초과로 400(Bad Request) → 80개씩 청크로 조회.
  const idByUrl = new Map<string, string>();
  const existingByUrl = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < allUrls.length; i += 80) {
    const { data: existing, error: ee } = await supabase
      .from("sponsored_posts")
      .select(`id, url, ${POST_FIELDS.join(", ")}`)
      .in("url", allUrls.slice(i, i + 80));
    if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });
    for (const e of (existing ?? []) as unknown as Array<Record<string, unknown>>) {
      idByUrl.set(String(e.url), String(e.id));
      existingByUrl.set(String(e.url), e);
    }
  }

  // 🛡️ 비용(cost)이 조회수로 잘못 들어온 행 차단용: url → cost (기존 메타 우선, 없으면 시트 메타).
  //    시트 날짜칸에 비용이 적힌 오염 데이터가 play_count로 적재돼 누적 그래프가 영구히 깨지는 것을 막는다.
  const costByUrl = new Map<string, number>();
  for (const [u, ex] of existingByUrl) { const c = Number(ex.cost); if (Number.isFinite(c) && c > 0) costByUrl.set(u, c); }
  for (const [u, m] of postByUrl) { const c = Number(m.cost); if (Number.isFinite(c) && c > 0 && !costByUrl.has(u)) costByUrl.set(u, c); }

  // 🛡️ 게시일(posted_at)보다 이른 날짜의 조회수는 저장하지 않는다(업로드 전 조회수 = 불가능 = 시트 날짜칸 백필 오류).
  //    url → posted_at(YYYY-MM-DD). 기존 메타 우선, 없으면 시트 메타. (2026-07 게시일-이전 이력 재발 방지)
  const postedByUrl = new Map<string, string>();
  for (const [u, ex] of existingByUrl) { const pa = ex.posted_at ? String(ex.posted_at).slice(0, 10) : ""; if (pa) postedByUrl.set(u, pa); }
  for (const [u, m] of postByUrl) { const pa = m.posted_at ? String(m.posted_at).slice(0, 10) : ""; if (pa && !postedByUrl.has(u)) postedByUrl.set(u, pa); }

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
  // 필드별 스킵 규칙(빈값만 채우기·캡션 정본)은 그대로 계산한 뒤,
  // 순차 await UPDATE만 청크 병렬로 실행(로직·결과 동일, 왕복 시간만 단축).
  const metaUpdates: { id: string; upd: Record<string, unknown> }[] = [];
  for (const [url, meta] of postByUrl) {
    const ex = existingByUrl.get(url);
    if (!ex) continue; // 신규 생성분은 이미 전체 메타로 만들어짐
    const upd: Record<string, unknown> = {};
    for (const f of POST_FIELDS) {
      const cur = ex[f];
      const curEmpty = cur === null || cur === undefined || cur === "";
      // meta[f]는 시트의 비어있지 않은 값만 들어있음(위 clean 생성 기준)
      // 캡션은 시트값 우선(정본) → 비어있지 않아도 시트 값으로 덮음. 그 외는 '빈 값만 채우기'.
      if (meta[f] !== undefined && (curEmpty || f === "content_summary")) upd[f] = meta[f];
    }
    // 무상채널 자가치유: 위성/온드에 기존 업체명·광고비가 남아있으면 강제 제거(owned-satellite-no-cost-rule)
    if (isFreeChannel(ex.channel_type)) {
      if (ex.company_name != null) upd.company_name = null;
      if (ex.cost != null && Number(ex.cost) !== 0) upd.cost = 0;
    }
    if (Object.keys(upd).length > 0) metaUpdates.push({ id: String(ex.id), upd });
  }
  const UPD_CHUNK = 25;
  for (let i = 0; i < metaUpdates.length; i += UPD_CHUNK) {
    const res = await Promise.all(
      metaUpdates.slice(i, i + UPD_CHUNK).map(({ id, upd }) =>
        supabase.from("sponsored_posts").update(upd).eq("id", id).then(({ error }) => !error))
    );
    metaFilled += res.filter(Boolean).length;
  }

  // 2-c) 캡션에 '삭제' 또는 '보관'이 포함된 글 → '종료'(ended_at) 처리. 이미 종료된 건은 날짜 유지.
  const today = todayKST();
  const endedUrls = [...postByUrl.entries()]
    .filter(([, m]) => /삭제|보관/.test(String(m.content_summary ?? "")))
    .map(([u]) => u);
  let endedMarked = 0;
  if (endedUrls.length > 0) {
    const { data: upd } = await supabase
      .from("sponsored_posts")
      .update({ ended_at: today })
      .in("url", endedUrls)
      .is("ended_at", null)
      .select("id");
    endedMarked = (upd ?? []).length;
  }

  // 3) 게시물 매칭 (미등록 URL은 건너뜀)
  const missing = new Set<string>();
  const costAsViews: Array<{ url: string; date: string; value: number }> = [];
  const prePosted: Array<{ url: string; date: string }> = [];
  const incoming: GuardInput[] = [];
  const postIdSet = new Set<string>();
  const bannerPlaySkipped: Array<{ url: string; date: string }> = [];
  for (const it of items) {
    const pid = idByUrl.get(it.url);
    if (!pid) { missing.add(it.url); continue; }
    const channelType = existingByUrl.get(it.url)?.channel_type ?? postByUrl.get(it.url)?.channel_type;
    if (isBannerChannelType(channelType)) {
      bannerPlaySkipped.push({ url: it.url, date: it.measured_at });
      continue;
    }
    // 🛡️ 조회수 == 그 게시물의 비용 → 비용이 조회수 칸에 잘못 들어온 오염으로 보고 제외
    if (costByUrl.get(it.url) === it.play_count) { costAsViews.push({ url: it.url, date: it.measured_at, value: it.play_count }); continue; }
    // 🛡️ 게시일 이전 날짜 = 업로드 전 조회수(불가능) → 시트 날짜칸 백필 오류로 보고 저장 안 함
    const pa = postedByUrl.get(it.url);
    if (pa && String(it.measured_at).slice(0, 10) < pa) { prePosted.push({ url: it.url, date: it.measured_at }); continue; }
    incoming.push({ post_id: pid, measured_at: it.measured_at, play_count: it.play_count });
    postIdSet.add(pid);
  }
  const postIds = [...postIdSet];

  // 4) 기존 post_daily_stats 조회 (누적 감소 판정 기준) — 페이지네이션으로 전량
  const existingStats: GuardInput[] = [];
  const manualSet = new Set<string>(); // 대시보드에서 수동수정된 (post_id|measured_at) → 동기화가 덮지 않고 보존
  // ⚠️ .in("post_id", postIds)를 통째로 쓰면 시트가 대량 배치를 보낼 때 id 목록이 쿼리 URL 한도를 넘어
  //    0행/에러가 됨(sponsored-posts 500 버그와 동일 계열) → id를 청크로 나눠 조회.
  //    (mono가드 정합성 때문에 조회 에러 시엔 500으로 실패시켜 부분 쓰기 방지 — degrade 안 함)
  {
    const ID_CHUNK = 150;
    for (let c = 0; c < postIds.length; c += ID_CHUNK) {
      const batch = postIds.slice(c, c + ID_CHUNK);
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pe2 } = await supabase
          .from("post_daily_stats")
          .select("post_id, measured_at, play_count, manual")
          .in("post_id", batch)
          .range(from, from + PAGE - 1);
        if (pe2) return NextResponse.json({ error: pe2.message }, { status: 500 });
        for (const s of (page ?? []) as Array<{ post_id: string; measured_at: string; play_count: number | null; manual: boolean | null }>) {
          existingStats.push({ post_id: s.post_id, measured_at: s.measured_at, play_count: Number(s.play_count ?? 0) });
          if (s.manual) manualSet.add(`${s.post_id}|${s.measured_at}`);
        }
        if (!page || page.length < PAGE) break;
      }
    }
  }

  // 4-b) 조회수 입력 우선순위 = "가장 최근에 사람이 손댄 값이 이긴다".
  //   시트 조회수 입력(importStats)은 사람이 메뉴를 눌러 '지금 이 값을 넣겠다'는 의도적 행위이며
  //   자동(밤 수집)이 절대 부르지 않는 경로다. 따라서 대시보드에서 먼저 수정한 값(manual)이라도
  //   시트에서 새로 입력하면 덮어쓴다(예전엔 manual이면 무조건 보존 → 시트 정정이 반영 안 되던 반대 문제).
  //   ⚠️ importStats는 '시트에 현재 적힌 값'을 밀어넣으므로, 최신 상태로 두고 입력할 것(안내 문구로 고지).
  //   manualSet은 진단 표시에만 사용(어떤 칸이 대시보드값을 덮었는지).
  const overwroteManual = incoming.filter(i => manualSet.has(`${i.post_id}|${i.measured_at}`)).length;

  // 5) 누적 감소 가드 (lib/stats-guard.ts — 테스트로 검증되는 순수 함수)
  const { kept: keptRows, dropped } = filterMonotonicStats(incoming, existingStats);
  // 시트 입력분도 '사람이 손댄 값'으로 표시 → 밤 자동수집이 덮지 않음(표시 우선 규칙과 일관).
  const statsRows = keptRows.map(r => ({ ...r, manual: true }));
  const droppedDecrease = dropped.length;
  // 진단용: 제외된 건 샘플(어떤 글의 어느 날짜 값이, 어느 날짜의 어떤 값에 막혔는지)
  const urlByPid = new Map<string, string>([...idByUrl.entries()].map(([u, id]) => [id, u]));
  const droppedSample = dropped.slice(0, 20).map(d => ({
    url: urlByPid.get(d.post_id) ?? d.post_id,
    date: d.measured_at,
    value: d.play_count,
    blocked_by: d.blocked_by,
    blocked_date: d.blocked_date,
  }));

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
    ended_marked: endedMarked,
    overwrote_manual: overwroteManual,
    dropped_decrease: droppedDecrease,
    dropped_sample: droppedSample,
    cost_as_views: costAsViews.length,
    cost_as_views_sample: costAsViews.slice(0, 10),
    pre_posted_skipped: prePosted.length,
    pre_posted_sample: prePosted.slice(0, 10),
    banner_play_skipped: bannerPlaySkipped.length,
    banner_play_skipped_sample: bannerPlaySkipped.slice(0, 10),
    matched_urls: [...new Set(items.map(i => i.url))].length - missing.size,
    missing_urls: missing.size,
    missing_sample: [...missing].slice(0, 5),
  });
}
