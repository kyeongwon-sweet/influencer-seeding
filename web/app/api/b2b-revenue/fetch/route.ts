import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValuesByTitle, fetchSheetTabValues } from "@/lib/google-sheets";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;

const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
// 시트가 제품별 탭 구조로 개편(2026-07) → 통합표가 6/30에서 끝남. 대시보드 두 칸(듬뿍바/쫀득바)을
// 각 제품 탭 전체로 매핑: 발주량(CVS+B2B)·이익·광고비·본부공헌이익(=CVS손익)을 [일자별 현황]에서 읽음.
// 전환손익 컬럼은 일별 섹션에 없음 → 항상 null(대시보드에서 "-"). 파인트는 제외(사용자 결정).
const DUMBUK_TAB = "인지_듬뿍바";   // → dumbuk_* (대시보드 '듬뿍바' 칸)
const JJONDEUK_TAB = "인지_쫀득바"; // → jjondeuk_* (대시보드 '쫀득바' 칸)

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).replace(/[,\s₩]/g, "").replace(/^\((.+)\)$/, "-$1").trim();
  if (s === "" || s === "-" || s.startsWith("#")) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

type DayVals = { order: number; profit: number | null; ad: number | null; contrib: number | null };

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TEMP: 연동 시트 고아 행(메타 비었는데 날짜칸에 값만 있는 행) 스캔. 확인 후 제거.
  if (req.nextUrl.searchParams.get("orphan")) {
    const rows = await fetchSheetTabValues("10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak", 1937186871, "A1:BZ2000");
    const header = (rows[0] ?? []) as (string | number | null)[];
    const findCol = (kw: string) => header.findIndex((c) => typeof c === "string" && c.includes(kw));
    const cUrl = findCol("URL"), cAcc = findCol("채널명");
    // 날짜 컬럼 = 헤더가 M.D/M. D 형태
    const dateCols: number[] = [];
    header.forEach((h, i) => { if (/(\d{1,2})\s*[.\/]\s*(\d{1,2})/.test(String(h ?? "")) && i > 8) dateCols.push(i); });
    const orphans: { row: number; valueCells: number }[] = [];
    let orphanSumCells = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] as (string | number | null)[];
      const url = String(r[cUrl] ?? "").trim();
      const acc = String(r[cAcc] ?? "").trim();
      if (url || acc) continue; // 메타 있으면 정상
      const vc = dateCols.filter((c) => { const v = r[c]; return v != null && v !== "" && !isNaN(Number(String(v).replace(/,/g, ""))); }).length;
      if (vc > 0) { orphans.push({ row: i + 1, valueCells: vc }); orphanSumCells += vc; }
    }
    const firstDate = dateCols.length ? dateCols[0] : 20;
    const orphanRowNums = orphans.map((o) => o.row);
    const minR = Math.min(...orphanRowNums), maxR = Math.max(...orphanRowNums);
    // 연속 블록으로 묶기
    const blocks: { start: number; end: number }[] = [];
    for (const rn of orphanRowNums) { const last = blocks[blocks.length - 1]; if (last && rn === last.end + 1) last.end = rn; else blocks.push({ start: rn, end: rn }); }
    // meta 있는(정상) 데이터행 마지막 위치
    let lastMetaRow = 0, metaRowCount = 0;
    for (let i = 1; i < rows.length; i++) { const r = rows[i] as (string | number | null)[]; const url = String(r[cUrl] ?? "").trim(); const acc = String(r[cAcc] ?? "").trim(); if (url || acc) { lastMetaRow = i + 1; metaRowCount++; } }
    // 첫 orphan 직전 3개 정상행 meta(URL/채널명/업체명/프로젝트명)
    const context = [minR - 3, minR - 2, minR - 1].filter((n) => n >= 2).map((n) => { const r = (rows[n - 1] as (string|number|null)[]) ?? []; return { row: n, url: String(r[cUrl] ?? ""), acc: String(r[cAcc] ?? ""), company: String(r[3] ?? ""), project: String(r[6] ?? "") }; });
    return NextResponse.json({ totalRows: rows.length, metaRowCount, lastMetaRow, orphanRows: orphans.length, orphanRange: [minR, maxR], blockCount: blocks.length, blocks: blocks.slice(0, 30), contextBeforeFirstOrphan: context });
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

  // 한 제품 탭의 [일자별 현황] 섹션을 날짜별로 파싱
  const parseTab = async (title: string): Promise<Map<string, DayVals>> => {
    const out = new Map<string, DayVals>();
    const rr = await fetchSheetTabValuesByTitle(SPREADSHEET_ID, title, "A1:T160");
    const mk = rr.findIndex((r) => r.some((c) => typeof c === "string" && c.includes("일자별 현황")));
    const find = (row: (string | number | null)[], pred: (s: string) => boolean) =>
      row.findIndex((c) => typeof c === "string" && pred(c.trim()));
    // 마커 이후 'CVS 발주량'+'B2B 발주량' 둘 다 있는 헤더 행(월요약 섹션과 구분)
    let h = -1, cCVS = -1, cB2B = -1, cDate = -1, cProfit = -1, cAd = -1, cContrib = -1;
    for (let i = Math.max(0, mk); i < rr.length; i++) {
      const ci = find(rr[i], (s) => s === "CVS 발주량"), bi = find(rr[i], (s) => s === "B2B 발주량");
      if (ci >= 0 && bi >= 0) {
        h = i; cCVS = ci; cB2B = bi;
        const di = find(rr[i], (s) => s === "날짜"); cDate = di >= 0 ? di : ci - 1;
        cProfit = find(rr[i], (s) => s.includes("이익") && s.includes("원")); // "○○바 이익(300원)"
        cAd = find(rr[i], (s) => s === "전체 광고비");
        cContrib = find(rr[i], (s) => s === "CVS 손익");
        break;
      }
    }
    if (h < 0) return out;
    let started = false, gap = 0;
    for (let i = h + 1; i < rr.length; i++) {
      const md = parseMD(rr[i][cDate]);
      if (!md) { if (started && ++gap > 8) break; continue; }
      gap = 0; started = true;
      const date = `${yearOf(md.mo)}-${String(md.mo).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
      const order = (toNum(rr[i][cCVS]) ?? 0) + (toNum(rr[i][cB2B]) ?? 0);
      out.set(date, {
        order,
        profit: cProfit >= 0 ? toNum(rr[i][cProfit]) : null,
        ad: cAd >= 0 ? toNum(rr[i][cAd]) : null,
        contrib: cContrib >= 0 ? toNum(rr[i][cContrib]) : null,
      });
    }
    return out;
  };

  let dumbuk: Map<string, DayVals>, jjondeuk: Map<string, DayVals>;
  try {
    [dumbuk, jjondeuk] = await Promise.all([parseTab(DUMBUK_TAB), parseTab(JJONDEUK_TAB)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyJob("B2B 발주량", "fail", `시트 조회 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const dates = [...new Set([...dumbuk.keys(), ...jjondeuk.keys()])].sort((a, b) => a.localeCompare(b));
  const records = dates.map((date) => {
    const d = dumbuk.get(date), j = jjondeuk.get(date);
    return {
      date,
      dumbuk_order: d?.order ?? 0,
      dumbuk_profit: d?.profit ?? null,
      dumbuk_conv_pl: null,        // 일별 섹션에 전환손익 컬럼 없음 → 통일해서 비움
      dumbuk_ad_cost: d?.ad ?? null,
      dumbuk_contribution: d?.contrib ?? null,
      jjondeuk_order: j?.order ?? 0,
      jjondeuk_profit: j?.profit ?? null,
      jjondeuk_conv_pl: null,
      jjondeuk_ad_cost: j?.ad ?? null,
      jjondeuk_contribution: j?.contrib ?? null,
      total_order: (d?.order ?? 0) + (j?.order ?? 0),
      total_contribution: (d?.contrib ?? 0) + (j?.contrib ?? 0),
      updated_at: new Date().toISOString(),
    };
  });

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
  return NextResponse.json({ ok: true, count: records.length, first: records[0].date, last: records[records.length - 1].date });
}
