import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, ALLOWED_POST_URL_RE } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 구글 시트 Apps Script → 협찬 게시물 일괄 추가 (인증 불필요, 공개 인터페이스)
 *
 * 부모 라우트 `/api/sponsored-posts` 가 Vercel/Turbopack 라우팅 manifest 누락으로
 * 404가 되는 문제를 우회하기 위한 자식 라우트. (자식 라우트는 정상 배포됨)
 *
 * 요청 body: 행 배열  [{ url, posted_at?, account_name?, content_summary?,
 *   channel_type?, project_name?, product_name?, cost? }, ...]
 * 또는 { rows: [...] } 형태도 허용.
 *
 * 플랫폼 제한 없음 (instagram / youtube / tiktok 등 모든 URL). URL만 정규화 후 upsert.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
  if (!list) {
    return NextResponse.json({ error: "행 배열(또는 {rows:[...]})이 필요합니다" }, { status: 400 });
  }

  // 필드 명시 매핑 + 빈값→null 정제(""의 date/numeric 캐스트 오류·임의 키 방지)
  // + URL 정규화 + 허용 플랫폼만 + 같은 배치 내 중복 URL 제거
  const seen = new Set<string>();
  const rows = (list as Array<Record<string, unknown>>)
    .map(r => ({
      url:             r.url ? (normalizeUrl(String(r.url)) || String(r.url)) : "",
      posted_at:       r.posted_at || null,
      account_name:    r.account_name || null,
      content_summary: r.content_summary || null,
      channel_type:    r.channel_type || null,
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
    return NextResponse.json({ ok: true, upserted: 0 });
  }

  const supabase = getServerSupabase();
  const META = ["posted_at", "account_name", "content_summary", "channel_type", "project_name", "product_name", "cost"];

  // 기존 게시물(id+메타) 조회 — '빈 값만 채우기' 비교용
  const { data: existing, error: ee } = await supabase
    .from("sponsored_posts")
    .select(`id, url, ${META.join(", ")}`)
    .in("url", rows.map(r => r.url));
  if (ee) return NextResponse.json({ error: ee.message }, { status: 500 });
  const existingByUrl = new Map<string, Record<string, unknown>>(
    (existing ?? []).map((e: Record<string, unknown>) => [String(e.url), e])
  );

  // 신규 URL → 전체 메타로 생성
  const toCreate = rows.filter(r => !existingByUrl.has(r.url));
  let created = 0;
  if (toCreate.length > 0) {
    const { data: ins, error: ie } = await supabase
      .from("sponsored_posts")
      .upsert(toCreate, { onConflict: "url", ignoreDuplicates: true })
      .select("id");
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 });
    created = (ins ?? []).length;
  }

  // 기존 게시물 → 빈 필드만 시트 값으로 채움. 값이 있으면 유지(절대 안 지움) → 사이트 인라인 수정값 보존.
  let metaFilled = 0;
  for (const r of rows) {
    const ex = existingByUrl.get(r.url);
    if (!ex) continue;
    const upd: Record<string, unknown> = {};
    for (const f of META) {
      const cur = ex[f];
      const curEmpty = cur === null || cur === undefined || cur === "";
      const val = (r as Record<string, unknown>)[f];
      const valPresent = val !== null && val !== undefined && val !== "";
      if (curEmpty && valPresent) upd[f] = val;
    }
    if (Object.keys(upd).length > 0) {
      const { error: ue } = await supabase.from("sponsored_posts").update(upd).eq("id", String(ex.id));
      if (!ue) metaFilled++;
    }
  }

  // 캡션에 '삭제' 또는 '보관'이 포함된 행 → '종료'(ended_at) 처리. 이미 종료된 건은 날짜 유지(중복 방지).
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
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

  return NextResponse.json({ ok: true, upserted: rows.length, created, meta_filled: metaFilled, ended_marked: endedMarked }, { status: 200 });
}
