import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey, ALLOWED_POST_URL_RE, isInvalidTikTokPostUrl } from "@/lib/url-utils";
import { filterMonotonicStats, type GuardInput } from "@/lib/stats-guard";
import { normalizeChannelType, isFreeChannel, canonicalText } from "@/app/monitoring/lib";
import { resolveTikTokShortUrl, tagCreatedBy } from "@/lib/sponsored-write";
import { maxDateKST, todayKST } from "@/lib/dateRule";
import { notifyBot } from "@/lib/slack";
import { buildRejectedInvalidUrlAlert, rejectedUrlIdentifiers } from "@/lib/stats-import-alerts";
import { stripAssetFileListing } from "@/lib/asset-name-policy";
import {
  buildAutomaticPlayHistory,
  previousAutomaticPlay,
  type AutomaticPlayMeasurement,
} from "@/lib/stats-import-spike";

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

  // 🛡️ 라이브 Apps Script 배포 드리프트 감시 — 라이브 .gs는 git 밖(수동 붙여넣기 배포)이라
  // stale 베이스 붙여넣기로 패치가 조용히 되돌아가도 흔적이 없다(2026-07-27 배너 스킵 잔존 사고).
  // importStats가 보고하는 client_version이 기대값과 다르면(구버전 잔존/사본 프로젝트 오저장/배포 누락)
  // 임포트 때마다 Slack 경고를 울려 드리프트를 그날 안에 드러낸다. 처리 자체는 막지 않는다(경고만).
  const EXPECTED_IMPORTSTATS_CLIENT = "2026-08-03-import-source-v2";
  const clientVersion = typeof body?.client_version === "string" ? body.client_version : null;
  const importSource = body?.source === "daily_auto" ? "daily_auto" : "manual_sheet";
  const isManualImport = importSource === "manual_sheet";
  if (clientVersion !== EXPECTED_IMPORTSTATS_CLIENT) {
    await notifyBot(
      `⚠️ [시트 조회수 입력] 라이브 Apps Script 버전 불일치 — 보고 ${clientVersion ?? "(미보고=구버전)"} ≠ 기대 ${EXPECTED_IMPORTSTATS_CLIENT}. ` +
      `라이브 importStats가 최신 main과 다릅니다(배포 드리프트/사본 오저장 의심). 최신 main 기준으로 라이브 재반영 필요.`
    ).catch(() => {});
  }

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
  const byKey = new Map<string, { url: string; key: string; measured_at: string; play_count: number }>();
  let rejectedInvalidUrl = 0;
  const rejectedUrls: string[] = [];
  const rejectInvalidUrl = (url: string) => {
    rejectedInvalidUrl += 1;
    rejectedUrls.push(url);
  };
  for (const r of statsIn as Array<Record<string, unknown>>) {
    if (!r || !r.url || !r.measured_at) continue;
    const url = normalizeUrl(resolveU(String(r.url))) || String(r.url);
    if (isInvalidTikTokPostUrl(url)) { rejectInvalidUrl(url); continue; }
    if (r.play_count === null || r.play_count === undefined || r.play_count === "") continue;
    const play_count = Number(r.play_count);
    if (!Number.isFinite(play_count)) continue;
    // 시트 셀 0 = 대개 '아직 데이터 없음(미입력 placeholder)'이지 '조회수 0회'가 아님.
    // 0을 적재하면 0-오염 → 리포트 뻥튀기·정리 시 행없음 공백 유발(2026-07-03/04 233건 사고).
    // 수집기(틱톡 clamp·IG NULL)와 동일하게 '수집 실패 ≠ 0' 원칙으로 0은 미적재.
    if (play_count === 0) continue;
    const key = postIdentityKey(url) ?? url;
    byKey.set(`${key}|${String(r.measured_at)}`, { url, key, measured_at: String(r.measured_at), play_count });
  }
  const items = [...byKey.values()];

  // 광고 메타: 정규화 + url 중복 제거 (첫 값 우선)
  const POST_FIELDS = ["posted_at", "account_name", "company_name", "content_summary", "asset_name", "channel_type", "project_name", "product_name", "cost"];
  // 공백·별칭 표준화 대상(텍스트 이름류) — channel_type은 전용 정규화, posted_at/cost/캡션은 제외.
  const TEXT_CANON = new Set(["account_name", "company_name", "asset_name", "project_name", "product_name"]);
  // 소재명·캡션·비용은 시트 정본이다. 시트 빈칸은 clean 생성 단계에서 제외되므로
  // DB의 기존 값을 지우지 않으며, 비어 있지 않은 시트값만 manual_fields보다 우선한다.
  const SHEET_WINS = new Set(["asset_name", "content_summary", "cost"]);
  const postByUrl = new Map<string, Record<string, unknown>>();
  for (const p of postsIn) {
    if (!p || !p.url) continue;
    const url = normalizeUrl(resolveU(String(p.url))) || String(p.url);
    if (!ALLOWED_POST_URL_RE.test(url) || isInvalidTikTokPostUrl(url)) { rejectInvalidUrl(url); continue; } // 허용 플랫폼·유효 게시물만 신규 생성
    const postKey = postIdentityKey(url) ?? url;
    if (postByUrl.has(postKey)) continue;
    const clean: Record<string, unknown> = { url, normalized_key: postKey };
    // != null 로 null·undefined 모두 제외 — 시트(importStats)가 빈 캡션 셀을 content_summary:null로 보내는데,
    // 예전 가드(!== undefined && !== "")는 null을 통과시켜 '캡션은 시트값 우선' 정책과 결합, 스크랩해둔 캡션을
    // null로 반복 삭제했음(2026-07-06 실사고: 채움→importStats→삭제 2회 반복).
    for (const f of POST_FIELDS) {
      if (p[f] == null || p[f] === "") continue;
      clean[f] = f === "channel_type"
        ? normalizeChannelType(String(p[f]))
        : f === "asset_name"
          ? canonicalText(stripAssetFileListing(String(p[f])), f)
          : TEXT_CANON.has(f)
            ? canonicalText(String(p[f]), f)
            : p[f];
    }
    // 무상채널(위성/온드)은 업체명·광고비가 없어야 함 → 신규 생성 시 강제(owned-satellite-no-cost-rule)
    if (isFreeChannel(clean.channel_type)) { clean.company_name = null; clean.cost = 0; }
    postByUrl.set(postKey, clean);
  }

  const supabase = getServerSupabase();

  // 이미 종료된 게시물의 오래된 잘못된 URL은 계속 차단하되 운영 알림에서는 제외한다.
  // 거부 URL은 아래 기존 게시물 조회 대상(allUrls)에서 빠지므로 URL/legacy normalized_key로 별도 조회한다.
  const endedRejectedIdentifiers = new Set<string>();
  const rejectedLookupIdentifiers = [...new Set(rejectedUrls.flatMap(rejectedUrlIdentifiers))];
  const rejectedLookupUrls = rejectedLookupIdentifiers.filter(value => /^https?:\/\//i.test(value));
  const rejectedLookupKeys = rejectedLookupIdentifiers.filter(value => !/^https?:\/\//i.test(value));
  const collectEndedRejected = (rows: Array<Record<string, unknown>> | null) => {
    for (const row of rows ?? []) {
      if (!row.ended_at) continue;
      if (row.url) {
        const normalized = normalizeUrl(String(row.url)) || String(row.url);
        for (const identifier of rejectedUrlIdentifiers(normalized)) endedRejectedIdentifiers.add(identifier);
      }
      if (row.normalized_key) endedRejectedIdentifiers.add(String(row.normalized_key));
    }
  };
  for (let i = 0; i < rejectedLookupUrls.length; i += 80) {
    const { data } = await supabase
      .from("sponsored_posts")
      .select("url, normalized_key, ended_at")
      .in("url", rejectedLookupUrls.slice(i, i + 80));
    collectEndedRejected(data as Array<Record<string, unknown>> | null);
  }
  for (let i = 0; i < rejectedLookupKeys.length; i += 80) {
    const { data } = await supabase
      .from("sponsored_posts")
      .select("url, normalized_key, ended_at")
      .in("normalized_key", rejectedLookupKeys.slice(i, i + 80));
    collectEndedRejected(data as Array<Record<string, unknown>> | null);
  }
  const rejectedInvalidUrlAlert = buildRejectedInvalidUrlAlert(rejectedUrls, endedRejectedIdentifiers);

  const allUrls = [...new Set([...items.map(i => i.url), ...[...postByUrl.values()].map(p => String(p.url))])];
  if (allUrls.length === 0) {
    if (rejectedInvalidUrlAlert) await notifyBot(rejectedInvalidUrlAlert).catch(() => {});
    return NextResponse.json({ ok: true, inserted: 0, created_posts: 0, matched_urls: 0, missing_urls: 0, rejected_invalid_url: rejectedInvalidUrl });
  }

  // 1) 기존 URL → id + 현재 메타 조회 (한 번만) — '빈 값만 채우기' 비교용으로 메타도 함께 조회
  // ⚠️ URL이 많으면 .in() 쿼리 URL 길이 한도 초과로 400(Bad Request) → 80개씩 청크로 조회.
  const idByUrl = new Map<string, string>();
  const idByKey = new Map<string, string>();
  const existingByUrl = new Map<string, Record<string, unknown>>();
  const existingByKey = new Map<string, Record<string, unknown>>();
  const allKeys = [...new Set([...items.map(i => i.key), ...postByUrl.keys()])].filter(Boolean);
  let supportsNormalizedKey = allKeys.length > 0;
  if (supportsNormalizedKey) {
    for (let i = 0; i < allKeys.length; i += 80) {
      const { data: existing, error: ee } = await supabase
        .from("sponsored_posts")
        .select(`id, url, normalized_key, ended_at, manual_fields, ${POST_FIELDS.join(", ")}`)
        .in("normalized_key", allKeys.slice(i, i + 80));
      if (ee) {
        supportsNormalizedKey = false;
        idByKey.clear();
        existingByUrl.clear();
        break;
      }
      for (const e of (existing ?? []) as unknown as Array<Record<string, unknown>>) {
        idByUrl.set(String(e.url), String(e.id));
        const key = String(e.normalized_key ?? postIdentityKey(String(e.url)) ?? e.url);
        idByKey.set(key, String(e.id));
        existingByUrl.set(String(e.url), e);
        existingByKey.set(key, e);
      }
    }
  }
  for (let i = 0; i < allUrls.length; i += 80) {
    const { data: existing, error: ee } = await supabase
      .from("sponsored_posts")
          .select(`id, url, ended_at, manual_fields, ${POST_FIELDS.join(", ")}`)
      .in("url", allUrls.slice(i, i + 80));
    if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });
    for (const e of (existing ?? []) as unknown as Array<Record<string, unknown>>) {
      idByUrl.set(String(e.url), String(e.id));
      const key = postIdentityKey(String(e.url)) ?? String(e.url);
      idByKey.set(key, String(e.id));
      existingByUrl.set(String(e.url), e);
      existingByKey.set(key, e);
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
  const endedByUrl = new Map<string, string>();
  const endedByKey = new Map<string, string>();
  for (const [u, ex] of existingByUrl) { const pa = ex.posted_at ? String(ex.posted_at).slice(0, 10) : ""; if (pa) postedByUrl.set(u, pa); }
  for (const [u, ex] of existingByUrl) { const ea = ex.ended_at ? String(ex.ended_at).slice(0, 10) : ""; if (ea) endedByUrl.set(u, ea); }
  for (const [u, ex] of existingByUrl) { const ea = ex.ended_at ? String(ex.ended_at).slice(0, 10) : ""; const k = postIdentityKey(u) ?? u; if (ea) endedByKey.set(k, ea); }
  for (const [u, m] of postByUrl) { const pa = m.posted_at ? String(m.posted_at).slice(0, 10) : ""; if (pa && !postedByUrl.has(u)) postedByUrl.set(u, pa); }

  // 2) 없는 광고만 신규 생성 (기존은 절대 건드리지 않음). 새로 만든 id를 매핑에 합침 → 재조회 불필요.
  let created = 0;
  const toCreate = [...postByUrl.entries()].filter(([key, p]) => !idByKey.has(key) && !idByUrl.has(String(p.url))).map(([, p]) => p);
  if (toCreate.length > 0) {
    const createRows = supportsNormalizedKey ? toCreate : toCreate.map((p) => {
      const row = { ...p };
      delete row.normalized_key;
      return row;
    });
    const writeQuery = supportsNormalizedKey
      ? supabase.from("sponsored_posts").insert(createRows)
      : supabase.from("sponsored_posts").upsert(createRows, { onConflict: "url", ignoreDuplicates: true });
    const { data: ins, error: ie } = await writeQuery.select("id, url");
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 });
    // 출처 라벨 — 시트 조회수 임포트 중 DB에 없던 URL이라 여기서 생성된 행.
    await tagCreatedBy(supabase, ((ins ?? []) as Array<{ id: string }>).map((r) => r.id), "sheet-stats-import");
    for (const row of (ins ?? []) as Array<{ id: string; url: string }>) {
      idByUrl.set(row.url, row.id);
      idByKey.set(postIdentityKey(row.url) ?? row.url, row.id);
    }
    created = (ins ?? []).length;
  }

  // 2-b) '빈 값만 채우기': 기존 게시물 중 사이트 값이 비어있는(null/"") 필드만 시트 값으로 채움.
  //      이미 값이 있는 필드는 절대 안 건드림 → 사이트에서 직접 수정한 값 보존.
  let metaFilled = 0;
  // 필드별 스킵 규칙(빈값만 채우기·캡션 정본)은 그대로 계산한 뒤,
  // 순차 await UPDATE만 청크 병렬로 실행(로직·결과 동일, 왕복 시간만 단축).
  const metaUpdates: { id: string; upd: Record<string, unknown> }[] = [];
  for (const [url, meta] of postByUrl) {
    const ex = existingByKey.get(url) ?? existingByUrl.get(String(meta.url));
    if (!ex) continue; // 신규 생성분은 이미 전체 메타로 만들어짐
    const manual = Array.isArray(ex.manual_fields) ? (ex.manual_fields as string[]) : [];
    const upd: Record<string, unknown> = {};
    for (const f of POST_FIELDS) {
      if (!SHEET_WINS.has(f) && manual.includes(f)) continue; // 시트 정본 필드 외 대시보드 수동 편집 보존
      const cur = ex[f];
      const curEmpty = cur === null || cur === undefined || cur === "";
      // meta[f]는 시트의 비어있지 않은 값만 들어있음(위 clean 생성 기준)
      // 시트 정본 필드는 비어 있지 않은 시트값 우선. 그 외 필드는 기존 빈칸만 채운다.
      if (meta[f] !== undefined && (curEmpty || f === "content_summary" || SHEET_WINS.has(f))) upd[f] = meta[f];
    }
    const assertedSheetWins = new Set(POST_FIELDS.filter(f => SHEET_WINS.has(f) && meta[f] !== undefined));
    const manualWithoutSheetWins = manual.filter(f => !assertedSheetWins.has(f));
    if (manualWithoutSheetWins.length !== manual.length) upd.manual_fields = manualWithoutSheetWins;
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
  // 단, 시트/대시보드에서 수동으로 트래킹 재개한 행(manual_fields includes ended_at)은
  // 캡션에 예전 "삭제/보관" 문구가 남아 있어도 재종료하지 않는다.
  const today = todayKST();
  const endedUrls = [...postByUrl.entries()]
    .filter(([u, m]) => {
      if (!/삭제|보관/.test(String(m.content_summary ?? ""))) return false;
      const ex = existingByKey.get(u) ?? existingByUrl.get(String(m.url));
      const manual = Array.isArray(ex?.manual_fields) ? (ex.manual_fields as string[]) : [];
      return !manual.includes("ended_at");
    })
    .map(([u, m]) => String((existingByKey.get(u) ?? existingByUrl.get(String(m.url)))?.url ?? m.url));
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

  // 🎯 배너 판정: 배너는 조회수(play_count)가 없고 '도달수(reach_count)'로 표시·합산한다(합의된 설계).
  //    시트 '일자별 조회수 입력'은 값을 play_count로 보내지만, 배너면 reach_count로 저장해야
  //    도달수 열에 입력값 그대로(×0.8 추정 없이) 뜨고 조회수 합산도 정확해진다. (기존/시트 메타 채널분류로 판정)
  const isBannerByKey = new Map<string, boolean>();
  for (const [url, ex] of existingByUrl) {
    isBannerByKey.set(postIdentityKey(url) ?? url, String(ex.channel_type ?? "").includes("배너"));
  }
  for (const [key, meta] of postByUrl) {
    if (!isBannerByKey.has(key)) isBannerByKey.set(key, String(meta.channel_type ?? "").includes("배너"));
  }

  // 3) 게시물 매칭 (미등록 URL은 건너뜀)
  const missing = new Set<string>();
  const costAsViews: Array<{ url: string; date: string; value: number }> = [];
  const prePosted: Array<{ url: string; date: string }> = [];
  const postEnded: Array<{ url: string; date: string; ended_at: string }> = [];
  const futureDated: Array<{ url: string; date: string; max_date: string }> = [];
  // 수동 메뉴와 dailyAuto가 함께 쓰는 시트 import 경로다. 출처와 무관하게 KST 당일값까지 허용한다.
  // 자정 자동수집·리포트의 T-1 정책은 별도 경로에서 유지하며, 미래 날짜만 차단한다.
  const maxStatsDate = maxDateKST();
  let incoming: GuardInput[] = [];
  const bannerRows: Array<{ post_id: string; measured_at: string; reach_count: number; manual: boolean }> = [];
  const postIdSet = new Set<string>();
  for (const it of items) {
    const pid = idByKey.get(it.key) ?? idByUrl.get(it.url);
    if (!pid) { missing.add(it.url); continue; }
    const measuredDate = String(it.measured_at).slice(0, 10);
    // 시트 입력은 당일값까지 저장하고, 실제 미래 날짜만 차단한다.
    if (measuredDate > maxStatsDate) {
      futureDated.push({ url: it.url, date: measuredDate, max_date: maxStatsDate });
      continue;
    }
    // 🛡️ 조회수 == 그 게시물의 비용 → 비용이 조회수 칸에 잘못 들어온 오염으로 보고 제외
    if (costByUrl.get(it.url) === it.play_count) { costAsViews.push({ url: it.url, date: it.measured_at, value: it.play_count }); continue; }
    // 🛡️ 게시일 이전 날짜 = 업로드 전 조회수(불가능) → 시트 날짜칸 백필 오류로 보고 저장 안 함
    const pa = postedByUrl.get(it.url);
    if (pa && measuredDate < pa) { prePosted.push({ url: it.url, date: it.measured_at }); continue; }
    const endedAt = endedByKey.get(it.key) ?? endedByUrl.get(it.url);
    if (endedAt && measuredDate > endedAt) { postEnded.push({ url: it.url, date: it.measured_at, ended_at: endedAt }); continue; }
    // 배너: reach_count로 저장(입력값=도달수). 비배너: 기존대로 play_count(누적 mono가드 대상).
    if (isBannerByKey.get(it.key)) {
      bannerRows.push({ post_id: pid, measured_at: it.measured_at, reach_count: it.play_count, manual: isManualImport });
    } else {
      incoming.push({ post_id: pid, measured_at: it.measured_at, play_count: it.play_count });
    }
    postIdSet.add(pid);
  }
  const postIds = [...postIdSet];

  // 3-b) 🛡️ 복사 유입 방지 — 시트 입력값이 '다른 게시물의 같은 날짜 값'과 여러 날 일치하면(=시리즈 복사)
  //   그 행을 저장하지 않는다(남의 값이 DB로 유입돼 대시보드까지 오염되는 것을 원천 차단).
  //   단일 우연 일치는 통과(다른 게시물이 같은 라운드 숫자일 수 있음) — '같은 타 게시물과 2일 이상 일치'만 차단.
  //   (2026-07 라밍 카카오 행에 몽글 값이 수동 오입력된 사례 재발 방지. 의심분은 Slack 알림.)
  const urlByPidForImport = new Map<string, string>([...idByUrl.entries()].map(([u, id]) => [id, u]));
  const labelByPid = new Map<string, string>();
  for (const ex of existingByUrl.values()) {
    if (ex.id && ex.account_name) labelByPid.set(String(ex.id), String(ex.account_name));
  }
  for (const [, meta] of postByUrl) {
    const postKey = postIdentityKey(String(meta.url)) ?? String(meta.url);
    const id = idByKey.get(postKey) ?? idByUrl.get(String(meta.url));
    if (id && meta.account_name && !labelByPid.has(id)) labelByPid.set(id, String(meta.account_name));
  }
  const describePost = (pid: string) => labelByPid.get(pid) ?? urlByPidForImport.get(pid) ?? pid;

  type CopyCandidate = {
    post_id: string;
    measured_at: string;
    value: number;
    metric: "play_count" | "reach_count";
  };
  const copyCandidates: CopyCandidate[] = [
    ...incoming.map(r => ({ post_id: r.post_id, measured_at: r.measured_at, value: r.play_count as number, metric: "play_count" as const })),
    ...bannerRows.map(r => ({ post_id: r.post_id, measured_at: r.measured_at, value: r.reach_count, metric: "reach_count" as const })),
  ];
  const copySuspected: Array<{
    target: string;
    url: string;
    date: string;
    value: number;
    source: string;
    metric: "play_count" | "reach_count";
  }> = [];
  const copyKeys = new Set<string>(); // `${metric}|${pid}|${date}` — DB 저장 제외
  if (copyCandidates.length > 0) {
    const dvOwners = new Map<string, Set<string>>();
    const VCHUNK = 100;
    for (const metric of ["play_count", "reach_count"] as const) {
      const metricCandidates = copyCandidates.filter(r => r.metric === metric);
      const dates = [...new Set(metricCandidates.map(r => r.measured_at))];
      const vals = [...new Set(metricCandidates.map(r => r.value).filter(v => Number.isFinite(v) && v > 0))];
      for (let i = 0; i < vals.length && dates.length > 0; i += VCHUNK) {
        const { data: rows, error } = await supabase
          .from("post_daily_stats")
          .select(`post_id, measured_at, ${metric}`)
          .in("measured_at", dates)
          .in(metric, vals.slice(i, i + VCHUNK));
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        for (const row of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
          const value = Number(row[metric]);
          if (!Number.isFinite(value) || value <= 0) continue;
          // 조회(play) 값을 배너 도달(reach)에 복사한 사고도 잡아야 하므로 소스 metric은 합쳐서 비교한다.
          const key = `${String(row.measured_at).slice(0, 10)}|${value}`;
          let owners = dvOwners.get(key);
          if (!owners) { owners = new Set(); dvOwners.set(key, owners); }
          owners.add(String(row.post_id));
        }
      }
    }

    // 같은 타 게시물과 같은 비-라운드 값이 2일 이상 겹칠 때만 복사로 판정한다.
    // 미러 채널도 URL별 독립 측정이므로 예외를 두지 않고, 배너 reach에도 동일 기준을 적용한다.
    //
    // ⚠️ 2026-08-13 실측: 이 판정이 **493행**을 경고해 알림이 사실상 무의미해졌다.
    //    내용이 `썰박스(틱톡) 06-15=1`, `06-28=14`, `06-30=15`, `06-24=18` 처럼 한 자리·두 자리였다.
    //    조회수가 그 수준인 게시물끼리 같은 숫자를 갖는 건 우연이 아니라 당연하다.
    //    기존 필터는 `% 1000`(반올림)만 있고 **최소값 기준이 없었다.**
    //    scripts/manual_entry_guards.py 에서 같은 문제를 실측 튜닝한 기준(112→10건)을 여기에도 맞춘다.
    const COPY_MIN_VALUE = 1000;      // 이하는 서로 다른 게시물이 같은 값을 지나가는 게 정상
    const COPY_ROUNDING_EXCLUDE = 100; // 89,000·267,000 같은 반올림 수기값끼리의 우연 일치 배제
    const matchDates = new Map<string, Set<string>>(); // `${metric}|${pid}|${other}` → set(date)
    for (const r of copyCandidates) {
      const date = r.measured_at.slice(0, 10);
      if (r.value < COPY_MIN_VALUE) continue;
      if (r.value % COPY_ROUNDING_EXCLUDE === 0) continue;
      const owners = dvOwners.get(`${date}|${r.value}`);
      if (!owners) continue;
      for (const other of owners) {
        if (other === r.post_id) continue;
        const matchKey = `${r.metric}|${r.post_id}|${other}`;
        let dates = matchDates.get(matchKey);
        if (!dates) { dates = new Set(); matchDates.set(matchKey, dates); }
        dates.add(date);
      }
    }

    const copySource = new Map<string, string>(); // `${metric}|${pid}` → source post_id
    for (const [matchKey, dates] of matchDates) {
      if (dates.size < 2) continue;
      const [metric, pid, other] = matchKey.split("|") as ["play_count" | "reach_count", string, string];
      for (const date of dates) copyKeys.add(`${metric}|${pid}|${date}`);
      if (!copySource.has(`${metric}|${pid}`)) copySource.set(`${metric}|${pid}`, other);
    }
    if (copyKeys.size > 0) {
      const urlByPid = new Map<string, string>();
      for (const [u, id] of idByUrl) urlByPid.set(id, u);
      for (const r of copyCandidates) {
        if (!copyKeys.has(`${r.metric}|${r.post_id}|${r.measured_at.slice(0, 10)}`)) continue;
        copySuspected.push({
          target: describePost(r.post_id),
          url: urlByPid.get(r.post_id) ?? r.post_id,
          date: r.measured_at,
          value: r.value,
          source: describePost(copySource.get(`${r.metric}|${r.post_id}`) ?? ""),
          metric: r.metric,
        });
      }
    }
  }

  // 3-c) 🛡️ 중복 날짜열 감지 — 시트에 같은 날짜 열이 중복되면 한 (게시물,날짜)에 서로 다른 값이 2개 들어온다.
  //   어느 게 진짜인지 알 수 없으므로 그 (게시물,날짜)는 저장하지 않고 건너뛰고 알림(추측 금지).
  const urlById = urlByPidForImport;
  const dupConflict: Array<{ url: string; date: string; values: number[] }> = [];
  {
    const byKey = new Map<string, number[]>();
    for (const r of incoming) {
      const k = `${r.post_id}|${r.measured_at.slice(0, 10)}`;
      const arr = byKey.get(k) ?? []; arr.push(r.play_count as number); byKey.set(k, arr);
    }
    const badKeys = new Set<string>();
    for (const [k, vals] of byKey) {
      if (new Set(vals).size >= 2) {            // 같은 날짜에 서로 다른 값 = 중복 열 오염
        badKeys.add(k);
        const [pid, d] = k.split("|");
        dupConflict.push({ url: urlById.get(pid) ?? pid, date: d, values: [...new Set(vals)] });
      }
    }
    if (badKeys.size > 0) incoming = incoming.filter(r => !badKeys.has(`${r.post_id}|${r.measured_at.slice(0, 10)}`));
  }

  // 4) 기존 post_daily_stats 조회 (누적 감소 판정 기준) — 페이지네이션으로 전량
  const existingStats: GuardInput[] = [];
  const manualSet = new Set<string>(); // 대시보드에서 수동수정된 (post_id|measured_at) → 동기화가 덮지 않고 보존
  const automaticPlayRows: AutomaticPlayMeasurement[] = [];
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
          .order("post_id", { ascending: true })
          .order("measured_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (pe2) return NextResponse.json({ error: pe2.message }, { status: 500 });
        for (const s of (page ?? []) as Array<{ post_id: string; measured_at: string; play_count: number | null; manual: boolean | null }>) {
          existingStats.push({ post_id: s.post_id, measured_at: s.measured_at, play_count: Number(s.play_count ?? 0) });
          if (s.manual) manualSet.add(`${s.post_id}|${s.measured_at}`);
          if (!s.manual) automaticPlayRows.push(s);
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
  // Sheet display may forward-fill cumulative cells. If that repeated value comes back through
  // stats-import, do not store it as a new real measurement.
  const existingByPost = new Map<string, GuardInput[]>();
  for (const row of existingStats) {
    const arr = existingByPost.get(row.post_id) ?? [];
    arr.push(row);
    existingByPost.set(row.post_id, arr);
  }
  for (const arr of existingByPost.values()) arr.sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const incomingByPost = new Map<string, GuardInput[]>();
  for (const row of incoming) {
    const arr = incomingByPost.get(row.post_id) ?? [];
    arr.push(row);
    incomingByPost.set(row.post_id, arr);
  }
  const repeatedCarry: GuardInput[] = [];
  const incomingForGuard: GuardInput[] = [];
  for (const [pid, rows] of incomingByPost) {
    const existingRows = existingByPost.get(pid) ?? [];
    const sortedRows = [...rows].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
    let existingIdx = 0;
    let previous: GuardInput | null = null;
    for (const row of sortedRows) {
      const sameDate = existingRows.find((e) => e.measured_at === row.measured_at);
      if (sameDate && sameDate.play_count === row.play_count) {
        repeatedCarry.push(row);
        continue;
      }
      while (existingIdx < existingRows.length && existingRows[existingIdx].measured_at < row.measured_at) {
        previous = existingRows[existingIdx];
        existingIdx++;
      }
      if (previous && previous.play_count === row.play_count) {
        repeatedCarry.push(row);
        continue;
      }
      incomingForGuard.push(row);
      previous = row;
    }
  }

  // 4-c) 🛡️ 급변 감지 — 해당 날짜보다 앞선 '가장 가까운 자동 조회수 실측'의 3배 이상이면 확인 요청.
  //   과거 오독 한 번이 영구 최댓값이 되어 이후 감지를 무력화하지 않으며, 배너 reach는 애초에 incoming에 없다.
  const automaticPlayHistory = buildAutomaticPlayHistory(automaticPlayRows);
  const spikeSuspected: Array<{
    target: string;
    url: string;
    date: string;
    value: number;
    previous_auto: number;
    previous_date: string;
  }> = [];
  {
    for (const r of incomingForGuard) {
      const previous = previousAutomaticPlay(automaticPlayHistory, r.post_id, r.measured_at);
      if (previous && (r.play_count as number) >= previous.play_count * 3) {
        spikeSuspected.push({
          target: describePost(r.post_id),
          url: urlById.get(r.post_id) ?? r.post_id,
          date: r.measured_at,
          value: r.play_count as number,
          previous_auto: previous.play_count,
          previous_date: previous.measured_at,
        });
      }
    }
  }

  // dailyAuto는 시트 값을 동기화하되 사람이 확정한 같은 날짜의 수기값은 절대 덮지 않는다.
  // 메뉴에서 직접 실행한 manual_sheet만 기존 수기값을 새 시트값으로 갱신할 수 있다.
  const preservedManual: GuardInput[] = [];
  const incomingWritable = incomingForGuard.filter((i) => {
    if (isManualImport || !manualSet.has(`${i.post_id}|${i.measured_at}`)) return true;
    preservedManual.push(i);
    return false;
  });
  const bannerRowsWritable = bannerRows.filter((r) => {
    if (isManualImport || !manualSet.has(`${r.post_id}|${r.measured_at}`)) return true;
    preservedManual.push({ post_id: r.post_id, measured_at: r.measured_at, play_count: r.reach_count });
    return false;
  });
  const overwroteManual = isManualImport
    ? incomingForGuard.filter(i => manualSet.has(`${i.post_id}|${i.measured_at}`)).length
    : 0;

  // 5) 누적 감소 가드 (lib/stats-guard.ts — 테스트로 검증되는 순수 함수)
  const { kept: keptRows, dropped } = filterMonotonicStats(incomingWritable, existingStats);
  // 메뉴 직접 실행만 사람 수기값이다. dailyAuto 값은 자동 실측이 이후 교정할 수 있게 manual=false.
  const statsRows = keptRows.map(r => ({ ...r, manual: isManualImport }));
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

  // 배너 도달수 입력분 upsert (reach_count). play_count는 안 건드림(배너는 조회수 없음).
  let bannerInserted = 0;
  if (bannerRowsWritable.length > 0) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .upsert(bannerRowsWritable, { onConflict: "post_id,measured_at" })
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    bannerInserted = (data ?? []).length;
  }

  // 복사 의심분 → 여믄봇 Slack 경고. 출처에 따라 수기/자동 플래그를 분리한다.
  if (copySuspected.length > 0) {
    const s = copySuspected.slice(0, 6)
      .map(c => `${c.target} ${c.date.slice(5, 10)} ${Number(c.value).toLocaleString()}←${c.source}(${c.metric === "reach_count" ? "도달" : "조회"})`).join(", ");
    await notifyBot(`⚠️ [시트 조회수 입력/${importSource}] 복사 의심 ${copySuspected.length}행 경고 — DB에는 manual=${isManualImport}로 반영했습니다. 오입력이면 각 URL 실측값으로 시트를 정정 후 다시 반영하세요: ${s}`);
  }

  // 중복 날짜열 감지분 → 알림(같은 날짜에 값 2개 = 시트 중복 열 오염, 어느 게 진짜인지 몰라 스킵).
  if (dupConflict.length > 0) {
    const s = dupConflict.slice(0, 6).map(c => `${c.date.slice(5, 10)} [${c.values.map(v => v.toLocaleString()).join("/")}]`).join(", ");
    await notifyBot(`🚨 [시트 조회수 입력] 중복 날짜열 의심 ${dupConflict.length}건 스킵 — 한 게시물·날짜에 값이 2개(중복 열). 시트 날짜 열 정규화 필요: ${s}`);
  }

  if (rejectedInvalidUrlAlert) await notifyBot(rejectedInvalidUrlAlert).catch(() => {});
  // 급변 감지분 → 알림(직전 자동 조회수 실측의 3배 이상 = 과대 오입력 의심). 사람이 입력한 시트값은 보존한다.
  if (spikeSuspected.length > 0) {
    const s = spikeSuspected.slice(0, 6).map(c =>
      `${c.target} ${c.date.slice(5, 10)} ${c.value.toLocaleString()}(직전 자동 ${c.previous_date.slice(5, 10)} ${c.previous_auto.toLocaleString()})`
    ).join(", ");
    await notifyBot(`⚠️ [시트 조회수 입력/${importSource}] 급변 의심 ${spikeSuspected.length}행 경고 — DB에는 manual=${isManualImport}로 반영했습니다. 오입력이면 시트에서 정정 후 다시 반영하세요: ${s}`);
  }

  console.info("stats_import_result", {
    source: importSource,
    manual: isManualImport,
    inserted,
    bannerInserted,
    preservedManual: preservedManual.length,
  });

  return NextResponse.json({
    ok: true,
    inserted,
    copy_suspected_skipped: 0,
    copy_suspected_warned: copySuspected.length,
    copy_suspected_sample: copySuspected.slice(0, 10),
    dup_column_skipped: dupConflict.length,
    dup_column_sample: dupConflict.slice(0, 10),
    spike_suspected_skipped: 0,
    spike_suspected_warned: spikeSuspected.length,
    spike_suspected_sample: spikeSuspected.slice(0, 10),
    banner_reach_inserted: bannerInserted,
    source: importSource,
    manual: isManualImport,
    preserved_manual: preservedManual.length,
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
    post_ended_skipped: postEnded.length,
    post_ended_sample: postEnded.slice(0, 10),
    future_date_skipped: futureDated.length,
    future_date_sample: futureDated.slice(0, 10),
    repeated_carry_skipped: repeatedCarry.length,
    repeated_carry_sample: repeatedCarry.slice(0, 10).map(r => ({
      url: urlByPid.get(r.post_id) ?? r.post_id,
      date: r.measured_at,
      value: r.play_count,
    })),
    matched_urls: [...new Set(items.map(i => i.url))].length - missing.size,
    missing_urls: missing.size,
    missing_sample: [...missing].slice(0, 5),
    rejected_invalid_url: rejectedInvalidUrl,
  });
}
