import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValues, fetchSheetTabValuesByTitle } from "@/lib/google-sheets";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;

const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
// 6월(이하): 'N월 현황' 통합표(GID) — 발주량 + 이익/공헌이익 전 필드.
const SHEET_GID = 588764344;
// 7월+: 시트가 제품별 탭 구조로 바뀌어 통합표가 6/30에서 끝남 → 제품별 '인지_*' 탭의
//       [일자별 현황](날짜|CVS 발주량|B2B 발주량)을 날짜별 합산해 발주량만 보강(2026-07-07).
//       ※ 6월은 통합표값 유지(사용자 결정) — 7월+만 이 소스로 추가.
const INJI_TABS = ["인지_쫀득바", "인지_듬뿍바", "인지_파인트"];

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).replace(/[,\s₩]/g, "").replace(/^\((.+)\)$/, "-$1").trim();
  if (s === "" || s === "-" || s === "#REF!" || s === "#N/A") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const curYear = nowKST.getUTCFullYear(), curMonth = nowKST.getUTCMonth() + 1;
  const yearOf = (mo: number) => (mo - curMonth > 6 ? curYear - 1 : curMonth - mo > 6 ? curYear + 1 : curYear);
  const parseMD = (cell: string | number | null): { mo: number; day: number } | null => {
    const s = typeof cell === "string" ? cell : ""; // 월 합계행(26.05 등)은 number → 제외
    const m = s.match(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})/);
    if (!m) return null;
    const mo = Number(m[1]), day = Number(m[2]);
    return mo >= 1 && mo <= 12 && day >= 1 && day <= 31 ? { mo, day } : null;
  };

  // ── 1) '6월 현황' 통합표 → 6월(이하) 레코드(발주량 + 이익/공헌이익 전 필드) ──
  let rows: (string | number | null)[][];
  try {
    rows = await fetchSheetTabValues(SPREADSHEET_ID, SHEET_GID, "A1:AB400");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyJob("B2B 발주량", "fail", `시트 조회 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  const has = (row: (string | number | null)[], label: string) =>
    row.findIndex((c) => typeof c === "string" && c.trim() === label);
  let hdr = -1, cCVS = -1, cB2B = -1, cDate = -1;
  for (let i = 0; i < rows.length; i++) {
    const ci = has(rows[i], "CVS 발주량"), bi = has(rows[i], "B2B 발주량");
    if (ci >= 0 && bi >= 0) { hdr = i; cCVS = ci; cB2B = bi; const di = has(rows[i], "날짜"); cDate = di >= 0 ? di : ci - 1; break; }
  }
  if (hdr < 0) {
    await notifyJob("B2B 발주량", "fail", "'6월 현황' 일자별 표 헤더를 찾지 못함");
    return NextResponse.json({ error: "일자별 표 헤더('CVS 발주량'+'B2B 발주량')를 찾지 못했습니다." }, { status: 500 });
  }
  const records: Record<string, unknown>[] = [];
  let started = false, gap = 0, juneMax = "0000-00-00";
  for (let i = hdr + 1; i < rows.length; i++) {
    const md = parseMD(rows[i][cDate]);
    if (!md) { if (started && ++gap > 6) break; continue; }
    gap = 0; started = true;
    const date = `${yearOf(md.mo)}-${String(md.mo).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
    if (date > juneMax) juneMax = date;
    const dumbuk_order = toNum(rows[i][cCVS]);
    const jjondeuk_order = toNum(rows[i][cB2B]);
    records.push({
      date,
      dumbuk_order, dumbuk_profit: toNum(rows[i][cCVS + 1]), dumbuk_conv_pl: toNum(rows[i][cCVS + 2]), dumbuk_ad_cost: toNum(rows[i][cCVS + 3]), dumbuk_contribution: toNum(rows[i][cCVS + 4]),
      jjondeuk_order, jjondeuk_profit: toNum(rows[i][cB2B + 1]), jjondeuk_conv_pl: toNum(rows[i][cB2B + 2]), jjondeuk_ad_cost: toNum(rows[i][cB2B + 3]), jjondeuk_contribution: toNum(rows[i][cB2B + 4]),
      total_order: (dumbuk_order ?? 0) + (jjondeuk_order ?? 0),
      total_contribution: (toNum(rows[i][cCVS + 4]) ?? 0) + (toNum(rows[i][cB2B + 4]) ?? 0),
      updated_at: new Date().toISOString(),
    });
  }

  // ── 2) 제품별 '인지_*' 3탭 → juneMax 이후(7월+)만 CVS+B2B 발주량 합산(order 필드만) ──
  const agg = new Map<string, { cvs: number; b2b: number }>();
  for (const tab of INJI_TABS) {
    let rr: (string | number | null)[][];
    try { rr = await fetchSheetTabValuesByTitle(SPREADSHEET_ID, tab, "A1:H200"); } catch { continue; }
    const marker = rr.findIndex((r) => r.some((c) => typeof c === "string" && c.includes("일자별 현황")));
    let h = -1, ci = -1, bi = -1, di = -1;
    for (let i = Math.max(0, marker); i < rr.length; i++) {
      const c = rr[i].findIndex((x) => typeof x === "string" && x.trim() === "CVS 발주량");
      const b = rr[i].findIndex((x) => typeof x === "string" && x.trim() === "B2B 발주량");
      if (c >= 0 && b >= 0) { h = i; ci = c; bi = b; const d = rr[i].findIndex((x) => typeof x === "string" && x.trim() === "날짜"); di = d >= 0 ? d : c - 1; break; }
    }
    if (h < 0) continue;
    let s = false, g = 0;
    for (let i = h + 1; i < rr.length; i++) {
      const md = parseMD(rr[i][di]);
      if (!md) { if (s && ++g > 8) break; continue; }
      g = 0; s = true;
      const date = `${yearOf(md.mo)}-${String(md.mo).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
      if (date <= juneMax) continue; // 6월(이하)은 통합표값 유지 → 7월+만 반영
      const cvs = toNum(rr[i][ci]) ?? 0, b2b = toNum(rr[i][bi]) ?? 0;
      const e = agg.get(date) ?? { cvs: 0, b2b: 0 };
      e.cvs += cvs; e.b2b += b2b; agg.set(date, e);
    }
  }
  for (const [date, v] of [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    records.push({ date, dumbuk_order: v.cvs, jjondeuk_order: v.b2b, total_order: v.cvs + v.b2b, updated_at: new Date().toISOString() });
  }

  if (records.length === 0) {
    await notifyJob("B2B 발주량", "fail", "일자별 데이터 행을 찾지 못함");
    return NextResponse.json({ error: "일자별 데이터 행을 찾지 못했습니다." }, { status: 500 });
  }

  const supabase = getServerSupabase();
  // 7월+ 레코드는 order 필드만 → onConflict 시 이익/공헌이익 컬럼 미갱신(6월은 위에서 전 필드 채움).
  const { error } = await supabase.from("b2b_daily_metrics").upsert(records, { onConflict: "date" });
  if (error) {
    await notifyJob("B2B 발주량", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await notifyJob("B2B 발주량", "ok", `${records.length}일 (${records[0].date} ~ ${records[records.length - 1].date})`);
  return NextResponse.json({ ok: true, count: records.length, first: records[0].date, last: records[records.length - 1].date, juneMax });
}
