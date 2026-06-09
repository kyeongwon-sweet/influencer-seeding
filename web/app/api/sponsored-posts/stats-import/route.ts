import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 구글 시트 Apps Script → 일자별 조회수(post_daily_stats) 수동 백필 (인증 불필요)
 *
 * 입력: [{ url, measured_at: "YYYY-MM-DD", play_count: number }, ...]  또는 { rows: [...] }
 * 처리: url 정규화 → sponsored_posts.id 매칭 → post_daily_stats 에 upsert
 *       (onConflict: post_id,measured_at → 같은 날짜는 덮어씀)
 *       (url, measured_at) 중복은 마지막 값으로 합침. 게시물 미등록 URL은 건너뛰고 보고.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
  if (!list) {
    return NextResponse.json({ error: "행 배열(또는 {rows:[...]})이 필요합니다" }, { status: 400 });
  }

  // 정규화 + (url, measured_at) 중복 제거 (마지막 값 우선)
  const byKey = new Map<string, { url: string; measured_at: string; play_count: number }>();
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || !r.url || !r.measured_at) continue;
    const url = normalizeUrl(String(r.url)) || String(r.url);
    const measured_at = String(r.measured_at);
    if (r.play_count === null || r.play_count === undefined || r.play_count === "") continue;
    const play_count = Number(r.play_count);
    if (!Number.isFinite(play_count)) continue;
    byKey.set(`${url}|${measured_at}`, { url, measured_at, play_count });
  }
  const items = [...byKey.values()];
  if (items.length === 0) return NextResponse.json({ ok: true, inserted: 0, matched_urls: 0, missing_urls: 0 });

  const supabase = getServerSupabase();

  // url → post_id 매핑
  const urls = [...new Set(items.map(i => i.url))];
  const { data: posts, error: pe } = await supabase
    .from("sponsored_posts")
    .select("id, url")
    .in("url", urls);
  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });

  const idByUrl = new Map((posts ?? []).map((p: { id: string; url: string }) => [p.url, p.id]));

  const statsRows: Array<{ post_id: string; measured_at: string; play_count: number }> = [];
  const missing = new Set<string>();
  for (const it of items) {
    const pid = idByUrl.get(it.url);
    if (!pid) { missing.add(it.url); continue; }
    statsRows.push({ post_id: pid, measured_at: it.measured_at, play_count: it.play_count });
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
    matched_urls: urls.length - missing.size,
    missing_urls: missing.size,
    missing_sample: [...missing].slice(0, 5),
  });
}
