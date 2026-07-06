import type { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, ALLOWED_POST_URL_RE } from "@/lib/url-utils";
import { normalizeChannelType } from "@/app/monitoring/lib";
import { triggerCaptionBackfill, needsCaption } from "@/lib/github-dispatch";
import { todayKST } from "@/lib/dateRule";

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
export async function upsertSponsoredRows(
  supabase: Supabase,
  list: Array<Record<string, unknown>>,
  source: string
): Promise<{ summary?: UpsertSummary; error?: string }> {
  const seen = new Set<string>();
  const rows = list
    .map(r => ({
      url:             r.url ? (normalizeUrl(String(r.url)) || String(r.url)) : "",
      posted_at:       r.posted_at || null,
      account_name:    r.account_name || null,
      company_name:    r.company_name || null,
      content_summary: r.content_summary || null,
      channel_type:    normalizeChannelType(r.channel_type ? String(r.channel_type) : null),
      project_name:    r.project_name || null,
      product_name:    r.product_name || null,
      cost:            r.cost != null && r.cost !== "" ? Number(r.cost) : null,
    }))
    .filter(r => {
      if (!r.url || !ALLOWED_POST_URL_RE.test(r.url)) return false;
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

  if (rows.length === 0) {
    return { summary: { upserted: 0, created: 0, meta_filled: 0, ended_marked: 0 } };
  }

  const META = ["posted_at", "account_name", "company_name", "content_summary", "channel_type", "project_name", "product_name", "cost"];

  // 기존 게시물(id+메타) 조회 — '빈 값만 채우기' 비교용.
  // ⚠️ URL이 많으면 .in() 쿼리 URL 길이 한도 초과로 400(Bad Request) → 80개씩 청크로 조회.
  const existingByUrl = new Map<string, Record<string, unknown>>();
  const allUrls = rows.map(r => r.url);
  for (let i = 0; i < allUrls.length; i += 80) {
    const { data: existing, error: ee } = await supabase
      .from("sponsored_posts")
      .select(`id, url, manual_fields, ${META.join(", ")}`)
      .in("url", allUrls.slice(i, i + 80));
    if (ee) return { error: `[조회] ${ee.message} | code=${ee.code ?? ""} | details=${ee.details ?? ""} | hint=${ee.hint ?? ""}` };
    for (const e of (existing ?? []) as unknown as Array<Record<string, unknown>>) existingByUrl.set(String(e.url), e);
  }

  // 신규 URL → 전체 메타로 생성
  const toCreate = rows.filter(r => !existingByUrl.has(r.url));
  let created = 0;
  if (toCreate.length > 0) {
    const { data: ins, error: ie } = await supabase
      .from("sponsored_posts")
      .upsert(toCreate, { onConflict: "url", ignoreDuplicates: true })
      .select("id");
    if (ie) return { error: `[신규생성] ${ie.message} | code=${ie.code ?? ""} | details=${ie.details ?? ""} | hint=${ie.hint ?? ""}` };
    created = (ins ?? []).length;
  }

  // 기존 게시물 → 비어있지 않은 값으로 덮어씀(manual_fields 보존·캡션 우선·빈값 유지).
  let metaFilled = 0;
  const metaUpdates: { id: string; upd: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const ex = existingByUrl.get(r.url);
    if (!ex) continue;
    const manual = Array.isArray(ex.manual_fields) ? (ex.manual_fields as string[]) : [];
    const upd: Record<string, unknown> = {};
    for (const f of META) {
      // 캡션은 항상 입력값 우선(정본) → manual_fields여도 비어있지 않은 값으로 덮음.
      if (f !== "content_summary" && manual.includes(f)) continue; // 그 외 수동 수정 필드 → 보존(덮지 않음)
      const val = (r as Record<string, unknown>)[f];
      const valPresent = val !== null && val !== undefined && val !== "";
      if (valPresent) upd[f] = val; // 값이 있으면 덮기 (비면 기존 유지)
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
  const today = todayKST();
  const endedUrls = rows
    .filter(r => /삭제|보관/.test(String(r.content_summary ?? "")))
    .map(r => r.url);
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

  // 캡션 빈 IG 글이 이번 배치에 있으면 캡션 보강 즉시 트리거(이벤트 기반)
  if (rows.some(r => needsCaption(r.url, r.content_summary))) await triggerCaptionBackfill(source);

  return { summary: { upserted: rows.length, created, meta_filled: metaFilled, ended_marked: endedMarked } };
}
