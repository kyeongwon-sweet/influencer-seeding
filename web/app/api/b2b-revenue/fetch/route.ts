import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValues, getSheetTitles } from "@/lib/google-sheets";
import { notifyJob } from "@/lib/slack";

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
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows: (string | number | null)[][];
  try {
    rows = await fetchSheetTabValues(SPREADSHEET_ID, SHEET_GID, "A1:AB400"); // 일자별 누적 → 200행 초과 대비 여유
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyJob("B2B 발주량", "fail", `시트 조회 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
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
    await notifyJob("B2B 발주량", "fail", "일자별 표 헤더('CVS 발주량'+'B2B 발주량')를 찾지 못함");
    return NextResponse.json({ error: "일자별 표 헤더('CVS 발주량'+'B2B 발주량')를 찾지 못했습니다." }, { status: 500 });
  }

  // 시트 날짜는 M/D뿐이라 연도를 추정해야 함. 고정 '올해'는 연말·연초에 지난/다음 해 행이 잘못 매핑됨
  // → 현재 월(KST)과 6개월 이상 차이나면 인접 연도로 보정.
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const curYear = nowKST.getUTCFullYear(), curMonth = nowKST.getUTCMonth() + 1;
  const records: Record<string, unknown>[] = [];
  let started = false, gap = 0;
  for (let i = hdr + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateCell = row[cDate];
    // 날짜 구분자가 월별로 섞임(6월 "6/1" 슬래시, 7월 "7. 1" 점 등) → 점·슬래시·하이픈 모두 허용.
    // '26.07'(월 합계행)·'26.06' 같은 건 월 1~12·일 1~31 검증으로 걸러짐(연도.월 표기라 월=26 등).
    const ds = typeof dateCell === "string" ? dateCell : "";
    const m = ds.match(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})/);
    const mo = m ? Number(m[1]) : 0, day = m ? Number(m[2]) : 0;
    const isDate = mo >= 1 && mo <= 12 && day >= 1 && day <= 31;
    if (!isDate) {
      // 날짜 아님(월 경계 합계행·빈 행·구분행) → 바로 끊지 말 것. 예전엔 즉시 break라 6/30 다음
      // '26.07' 합계행에 막혀 7월 전체 누락(2026-07). 연속 6줄 넘게 비면 표 끝으로 보고 종료.
      if (started && ++gap > 6) break;
      continue;
    }
    gap = 0;
    started = true;
    const year = mo - curMonth > 6 ? curYear - 1 : curMonth - mo > 6 ? curYear + 1 : curYear;
    const mm = String(mo).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
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
    await notifyJob("B2B 발주량", "fail", "일자별 데이터 행을 찾지 못함");
    return NextResponse.json({ error: "일자별 데이터 행을 찾지 못했습니다." }, { status: 500 });
  }

  const supabase = getServerSupabase();
  const { error } = await supabase.from("b2b_daily_metrics").upsert(records, { onConflict: "date" });
  if (error) {
    await notifyJob("B2B 발주량", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await notifyJob("B2B 발주량", "ok", `${records.length}일 (${records[0].date} ~ ${records[records.length - 1].date})`);
  const debug_titles = await getSheetTitles(SPREADSHEET_ID).catch(() => ["<titles fetch fail>"]); // TEMP
  return NextResponse.json({ ok: true, count: records.length, first: records[0].date, last: records[records.length - 1].date,
    debug: { rows_total: rows.length, hdr, cDate, tab_titles: debug_titles, tail_rows: rows.slice(-4) } }); // TEMP 진단
}
