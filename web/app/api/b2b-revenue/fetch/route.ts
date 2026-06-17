import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValues } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

// 마케팅T 대시보드 - 일자별 현황 탭
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
const SHEET_GID = 588764344;

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).replace(/[,\s₩]/g, "").replace(/^\((.+)\)$/, "-$1").trim();
  if (s === "" || s === "-" || s === "#REF!" || s === "#N/A") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows: (string | number | null)[][];
  try {
    rows = await fetchSheetTabValues(SPREADSHEET_ID, SHEET_GID, "A1:AB200");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // 일자별 표 헤더: 'CVS 발주량' 과 'B2B 발주량' 을 동시에 가진 행 (요약표와 구분됨)
  const has = (row: (string | number | null)[], label: string) =>
    row.findIndex((c) => typeof c === "string" && c.trim() === label);
  let hdr = -1, cCVS = -1, cB2B = -1, cDate = -1;
  for (let i = 0; i < rows.length; i++) {
    const ci = has(rows[i], "CVS 발주량");
    const bi = has(rows[i], "B2B 발주량");
    if (ci >= 0 && bi >= 0) {
      hdr = i; cCVS = ci; cB2B = bi;
      // '날짜' 헤더가 비어있는 시트가 있어(CVS 발주량 왼쪽 열이 날짜) → 못 찾으면 cCVS-1로 폴백
      const di = has(rows[i], "날짜");
      cDate = di >= 0 ? di : ci - 1;
      break;
    }
  }
  if (hdr < 0) {
    return NextResponse.json({ error: "일자별 표 헤더('CVS 발주량'+'B2B 발주량')를 찾지 못했습니다." }, { status: 500 });
  }

  const year = new Date().getFullYear();
  const records: Record<string, unknown>[] = [];
  let started = false;
  for (let i = hdr + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateCell = row[cDate];
    const m = typeof dateCell === "string" ? dateCell.match(/(\d{1,2})\/(\d{1,2})/) : null;
    if (!m) { if (started) break; else continue; }
    started = true;
    const mm = String(m[1]).padStart(2, "0");
    const dd = String(m[2]).padStart(2, "0");
    const date = `${year}-${mm}-${dd}`;

    const dumbuk_order = toNum(row[cCVS]);
    const dumbuk_profit = toNum(row[cCVS + 1]);
    const dumbuk_conv_pl = toNum(row[cCVS + 2]);
    const dumbuk_ad_cost = toNum(row[cCVS + 3]);
    const dumbuk_contribution = toNum(row[cCVS + 4]);
    const jjondeuk_order = toNum(row[cB2B]);
    const jjondeuk_profit = toNum(row[cB2B + 1]);
    const jjondeuk_conv_pl = toNum(row[cB2B + 2]);
    const jjondeuk_ad_cost = toNum(row[cB2B + 3]);
    const jjondeuk_contribution = toNum(row[cB2B + 4]);

    const total_order = (dumbuk_order ?? 0) + (jjondeuk_order ?? 0);
    const total_contribution = (dumbuk_contribution ?? 0) + (jjondeuk_contribution ?? 0);

    records.push({
      date,
      dumbuk_order, dumbuk_profit, dumbuk_conv_pl, dumbuk_ad_cost, dumbuk_contribution,
      jjondeuk_order, jjondeuk_profit, jjondeuk_conv_pl, jjondeuk_ad_cost, jjondeuk_contribution,
      total_order, total_contribution,
      updated_at: new Date().toISOString(),
    });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "일자별 데이터 행을 찾지 못했습니다." }, { status: 500 });
  }

  const supabase = getServerSupabase();
  const { error } = await supabase.from("b2b_daily_metrics").upsert(records, { onConflict: "date" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: records.length, first: records[0].date, last: records[records.length - 1].date });
}
