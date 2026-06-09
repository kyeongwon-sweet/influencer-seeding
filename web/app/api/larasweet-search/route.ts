import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 라라스윗 검색량(절대) — 외부 시트(B열)에서 Apps Script로 푸시 → 저장 / 조회.
 *
 * POST (인증 불필요): [{ measured_at: "YYYY-MM-DD", search_volume: number }, ...]  또는 { rows: [...] }
 *   → larasweet_search_daily 에 upsert (onConflict: measured_at)
 * GET  (인증 불필요): { latest: { measured_at, search_volume } | null }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
  if (!list) {
    return NextResponse.json({ error: "행 배열(또는 {rows:[...]})이 필요합니다" }, { status: 400 });
  }

  // (measured_at 유효 + 숫자) 만, 같은 날짜는 마지막 값
  const byDate = new Map<string, number>();
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || !r.measured_at) continue;
    const measured_at = String(r.measured_at);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(measured_at)) continue;
    const v = Number(r.search_volume);
    if (!Number.isFinite(v)) continue;
    byDate.set(measured_at, Math.round(v));
  }
  const rows = [...byDate.entries()].map(([measured_at, search_volume]) => ({ measured_at, search_volume }));
  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("larasweet_search_daily")
    .upsert(rows, { onConflict: "measured_at" })
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, upserted: (data ?? []).length });
}

export async function GET() {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("larasweet_search_daily")
    .select("measured_at, search_volume")
    .order("measured_at", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ latest: data?.[0] ?? null });
}
