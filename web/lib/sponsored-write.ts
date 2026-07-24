import type { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey, ALLOWED_POST_URL_RE, isInstagramNonPostUrl } from "@/lib/url-utils";
import { normalizeChannelType, isFreeChannel } from "@/app/monitoring/lib";
import { triggerCaptionBackfill, needsCaption } from "@/lib/github-dispatch";
import { todayKST } from "@/lib/dateRule";
import { startActorRun } from "@/lib/apify";

type Supabase = ReturnType<typeof getServerSupabase>;

export type UpsertSummary = {
  upserted: number;
  created: number;
  meta_filled: number;
  ended_marked: number;
};

/**
 * 협찬 게시물 행 배열 upsert — 시트 bulk와 CSV 업로드가 공유하는 단일 쓰기 정책.
 *
 * 정책(시트 동기화와 동일):
 * - 필드 명시 매핑 + 빈값→null 정제, URL 정규화, 허용 플랫폼만, 배치 내 중복 URL 제거
 * - 신규 URL → 전체 메타로 생성
 * - 기존 URL → 비어있지 않은 값만 덮어씀. 단 ① manual_fields(대시보드 수동 수정)는 보존,
 *   ② 캡션(content_summary)만 항상 입력값 우선, ③ 빈 값은 기존 유지(지우지 않음)
 * - 캡션에 '삭제'/'보관' 포함 행 → ended_at 종료 처리(이미 종료면 유지)
 */
// 틱톡 단축링크(vt.tiktok.com/...)를 실제 영상 URL로 해석. 순수 정규화(normalizeUrl)로는 ID를 알 수 없어
// 반드시 네트워크 해석이 필요 — 안 하면 단축링크가 그대로 저장돼 수집 실패·수동 교체·정식링크 재등록 시 중복이 생김
// (2026-07-07 시으니네(TT) 사례). 해석 실패 시 원본 유지(다음 동기화 때 재시도).
export async function resolveTikTokShortUrl(url: string): Promise<string> {
  if (!/^https?:\/\/vt\.tiktok\.com\//i.test(url)) return url;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
    const loc = res.headers.get("location");
    if (loc && /tiktok\.com\/.+\/video\/\d+/.test(loc)) return loc.split("?")[0];
  } catch { /* 해석 실패 → 원본 유지 */ }
  return url;
}

export async function upsertSponsoredRows(
  supabase: Supabase,
  list: Array<Record<string, unknown>>,
  source: string
): Promise<{ summary?: UpsertSummary; error?: string }> {
  const seen = new Set<string>();
  // 시트 채널명에 붙는 작업용 마커(●)는 DB 계정명에서 제거 — 시트에선 팀 표기용으로 유지되므로
  // 여기서 걸러야 매일 syncAll 때 재유입되지 않음(2026-07-06, 'chachaping_zzal ●' 6건 사례).
  const cleanName = (v: unknown) => {
    const s = String(v ?? "").replace(/●/g, "").trim();
    return s || null;
  };
  // 단축링크는 정규화 전에 해석(표준형으로 접혀야 기존 행과 onConflict 매칭됨). vt 링크만 네트워크 발생(드묾).
  const resolved: Array<Record<string, unknown>> = await Promise.all(
    list.map(async r => ({ ...r, url: r.url ? await resolveTikTokShortUrl(String(r.url)) : r.url }))
  );
  const rows = resolved
    .map(r => {
      const url = r.url ? (normalizeUrl(String(r.url)) || String(r.url)) : "";
      const channel_type = normalizeChannelType(r.channel_type ? String(r.channel_type) : null);
      const free = isFreeChannel(channel_type);
      return {
        url,
        normalized_key: postIdentityKey(url),
        posted_at:       r.posted_at || null,
        account_name:    cleanName(r.account_name),
        company_name:    free ? null : (r.company_name || null),
        content_summary: r.content_summary || null,
        channel_type,
        project_name:    r.project_name || null,
        product_name:    r.product_name || null,
        asset_name:      r.asset_name || null,   // 소재명 보존(시트 E열) — ⚠️ DB에 asset_name 컬럼 있어야 함
        planner:         r.planner || null,
        creator:         r.creator || null,
        cost:            free ? 0 : (r.cost != null && r.cost !== "" ? Number(r.cost) : null),
      };
    })
    .filter(r => {
      if (!r.url || !ALLOWED_POST_URL_RE.test(r.url)) return false;
      if (isInstagramNonPostUrl(r.url)) return false;
      const key = r.normalized_key ?? r.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (rows.length === 0) {
    return { summary: { upserted: 0, created: 0, meta_filled: 0, ended_marked: 0 } };
  }

  // ⚠️ asset_name(소재명 보존): DB에 asset_name 컬럼이 생긴 뒤에만 이 브랜치를 main에 머지할 것.
  // 컬럼 없이 배포하면 아래 SELECT `${META.join(", ")}`가 에러 → 동기화 전체가 깨짐.
  const META = ["posted_at", "account_name", "company_name", "content_summary", "channel_type", "project_name", "product_name", "asset_name", "planner", "creator", "cost"];
  // 기획자·제작자는 '시트 무조건 우선'(사용자 2026-07-23): 대시보드 수동값(manual_fields)도 시트값으로 덮는다.
  const SHEET_WINS = new Set(["planner", "creator"]);

  // 기존 게시물(id+메타) 조회 — '빈 값만 채우기' 비교용.
  // ⚠️ URL이 많으면 .in() 쿼리 URL 길이 한도 초과로 400(Bad Request) → 80개씩 청크로 조회.
  const existingByUrl = new Map<string, Record<string, unknown>>();
  const existingByIdentity = new Map<string, Record<string, unknown>>();
  const allUrls = rows.map(r => r.url);
  const allIdentityKeys = rows.map(r => r.normalized_key).filter((v): v is string => Boolean(v));
  let supportsNormalizedKey = allIdentityKeys.length > 0;
  if (supportsNormalizedKey) {
    for (let i = 0; i < allIdentityKeys.length; i += 80) {
      const { data: existing, error: ee } = await supabase
        .from("sponsored_posts")
        .select(`id, url, normalized_key, manual_fields, ${META.join(", ")}`)
        .in("normalized_key", allIdentityKeys.slice(i, i + 80));
      if (ee) {
        supportsNormalizedKey = false;
        existingByIdentity.clear();
        break;
      }
      for (const e of (existing ?? []) as unknown as Array<Record<string, unknown>>) {
        const key = String(e.normalized_key ?? postIdentityKey(String(e.url)) ?? e.url);
        existingByIdentity.set(key, e);
        existingByUrl.set(String(e.url), e);
      }
    }
  }
  for (let i = 0; i < allUrls.length; i += 80) {
    const { data: existing, error: ee } = await supabase
      .from("sponsored_posts")
      .select(`id, url, manual_fields, ${META.join(", ")}`)
      .in("url", allUrls.slice(i, i + 80));
    if (ee) return { error: `[조회] ${ee.message} | code=${ee.code ?? ""} | details=${ee.details ?? ""} | hint=${ee.hint ?? ""}` };
    for (const e of (existing ?? []) as unknown as Array<Record<string, unknown>>) {
      existingByUrl.set(String(e.url), e);
      existingByIdentity.set(postIdentityKey(String(e.url)) ?? String(e.url), e);
    }
  }

  // 신규 URL → 전체 메타로 생성
  const toCreate = rows.filter(r => !existingByIdentity.has(r.normalized_key ?? r.url) && !existingByUrl.has(r.url));
  let created = 0;
  if (toCreate.length > 0) {
    const createRows = supportsNormalizedKey ? toCreate : toCreate.map(({ normalized_key, ...r }) => {
      void normalized_key;
      return r;
    });
    const writeQuery = supportsNormalizedKey
      ? supabase.from("sponsored_posts").insert(createRows)
      : supabase.from("sponsored_posts").upsert(createRows, { onConflict: "url", ignoreDuplicates: true });
    const { data: ins, error: ie } = await writeQuery.select("id");
    if (ie) return { error: `[신규생성] ${ie.message} | code=${ie.code ?? ""} | details=${ie.details ?? ""} | hint=${ie.hint ?? ""}` };
    created = (ins ?? []).length;

    // 🆕 등록 동기화 시 캡션·첫 조회수 즉시 수집 — 신규 IG '게시물' 중 캡션 없는 것만 Apify 1회 스크랩.
    // apify-webhook이 캡션(비어있을 때만)·계정명·오늘 stats를 채움 → 별도 backfill(GHA)을 기다릴 필요 없음.
    // (GH_DISPATCH_TOKEN 기반 즉시 트리거가 미설정으로 한 번도 안 돌아, 2026-07-06 신규 11건 캡션이 종일 비었던 문제의 근본 해법)
    // 가드: shortcode 있는 게시물 URL만(프로필형 directUrls 과수집 방지), 배치당 100개 캡.
    const igNew = [...new Set(
      toCreate
        .filter(r => needsCaption(r.url, r.content_summary) && /instagram\.com\/p\/[A-Za-z0-9_-]+/.test(r.url))
        .map(r => r.url)
    )].slice(0, 100);
    if (igNew.length > 0 && process.env.APIFY_API_TOKEN) {
      const appUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : `https://${process.env.VERCEL_URL}`;
      const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
      const { data: job } = await supabase
        .from("jobs")
        .insert({ type: "monitoring", status: "pending", payload: {} })
        .select().single();
      if (job) {
        const runError = await startActorRun(
          "apify/instagram-scraper",
          { directUrls: igNew, resultsType: "posts", resultsLimit: igNew.length, addParentData: true },
          `${appUrl}/api/apify-webhook?token=${encodeURIComponent(webhookSecret)}&jobId=${job.id}&jobType=monitoring`
        ).then(() => null).catch((e: unknown) => e);
        if (runError) {
          // 스크랩 실패해도 등록 자체엔 영향 없음(캡션은 크론 안전망·자정 수집이 커버)
          await supabase.from("jobs").update({ status: "failed", error: String(runError) }).eq("id", job.id);
        }
      }
    }
  }

  // 기존 게시물 → '변경분만' 덮어씀(manual_fields 보존[캡션 포함]·빈값 유지·동일값 skip).
  let metaFilled = 0;
  const metaUpdates: { id: string; upd: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const ex = existingByIdentity.get(r.normalized_key ?? r.url) ?? existingByUrl.get(r.url);
    if (!ex) continue;
    const manual = Array.isArray(ex.manual_fields) ? (ex.manual_fields as string[]) : [];
    const upd: Record<string, unknown> = {};
    for (const f of META) {
      // 수동 수정 필드(캡션 포함)는 보존 — 대시보드에서 마지막으로 고친 값을 시트가 덮지 않음.
      // (캡션도 이제 동일 정책. 시트 빈칸이면 아래 valPresent에서 skip → needsCaption 자동 불러오기가 채움)
      if (!SHEET_WINS.has(f) && manual.includes(f)) continue;
      const val = (r as Record<string, unknown>)[f];
      const valPresent = val !== null && val !== undefined && val !== "";
      if (!valPresent) continue; // 시트가 비면 기존 유지(지우지 않음)
      // '변경분만' 반영: 시트값이 DB 기존값과 동일하면 skip — 불필요한 덮어쓰기 제거 +
      // 시스템이 갱신한 값(스크랩 등)을 같은 값으로 되쓰는 낭비 방지. 다를 때만 덮음.
      if (String(val).trim() === String(ex[f] ?? "").trim()) continue;
      upd[f] = val;
    }
    // 무상채널 자가치유: 위성/온드에 기존 업체명·광고비가 남아있으면 강제로 비운다(시트 정정이 DB에 안 닿는 갭 보정)
    if (isFreeChannel(r.channel_type)) {
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

  // 캡션에 '삭제' 또는 '보관'이 포함된 행 → '종료'(ended_at) 처리. 이미 종료된 건은 날짜 유지(중복 방지).
  // 단, 시트/대시보드에서 수동으로 트래킹 재개한 행(manual_fields includes ended_at)은
  // 캡션에 예전 "삭제/보관" 문구가 남아 있어도 재종료하지 않는다.
  const today = todayKST();
  const endedRows = rows
    .filter(r => {
      if (!/삭제|보관/.test(String(r.content_summary ?? ""))) return false;
      const ex = existingByIdentity.get(r.normalized_key ?? r.url) ?? existingByUrl.get(r.url);
      const manual = Array.isArray(ex?.manual_fields) ? (ex.manual_fields as string[]) : [];
      return !manual.includes("ended_at");
    })
  const endedIds = [
    ...new Set(
      endedRows
        .map(r => existingByIdentity.get(r.normalized_key ?? r.url) ?? existingByUrl.get(r.url))
        .map(ex => String(ex?.id ?? ""))
        .filter(Boolean)
    ),
  ];
  const endedUrls = [
    ...new Set(
      endedRows
        .filter(r => !(existingByIdentity.get(r.normalized_key ?? r.url) ?? existingByUrl.get(r.url)))
        .map(r => r.url)
    ),
  ];
  let endedMarked = 0;
  if (endedIds.length > 0) {
    const { data: upd } = await supabase
      .from("sponsored_posts")
      .update({ ended_at: today })
      .in("id", endedIds)
      .is("ended_at", null)
      .select("id");
    endedMarked += (upd ?? []).length;
  }
  if (endedUrls.length > 0) {
    const { data: upd } = await supabase
      .from("sponsored_posts")
      .update({ ended_at: today })
      .in("url", endedUrls)
      .is("ended_at", null)
      .select("id");
    endedMarked += (upd ?? []).length;
  }

  // 캡션 빈 IG 글이 이번 배치에 있으면 캡션 보강 즉시 트리거(이벤트 기반)
  if (rows.some(r => needsCaption(r.url, r.content_summary))) await triggerCaptionBackfill(source);

  return { summary: { upserted: rows.length, created, meta_filled: metaFilled, ended_marked: endedMarked } };
}
