import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValuesByTitle } from "@/lib/google-sheets";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;

// 마케팅T 시트의 [인지_쫀득바]/[인지_듬뿍바] 탭 [N월 현황] 블록에서 KPI를 읽는다.
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
const TABS = [
  { tab: "인지_쫀득바", product: "쫀득바" },
  { tab: "인지_듬뿍바", product: "듬뿍바" },
];

// 카드에 표시할 지표 14종 (시트 헤더명과 공백 무시 매칭). 표시 순서 = 이 순서.
const METRICS = [
  "CVS 발주량", "*POS 일 판매량", "광고비", "CVS 손익(발주)", "*CVS 손익(판매)", "검색량",
  "본부공헌이익(=가용예산)", "*본부공헌이익(판매)", "전환 손익", "*일 광고비 속도", "*검색당비용",
  "총 조회수 (전환+인지)", "인지 조회수", "인지 조회비",
];

type Cell = string | number | null;
const norm = (v: Cell) => String(v ?? "").replace(/\s+/g, "").trim();
function num(v: Cell): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s%₩]/g, ""));
  return isFinite(n) ? n : null;
}
// 시트의 달성률 셀: 비율(0~5 = 0~500%)만 유효. 목표=0 컬럼은 raw 큰 값/공백 → N/A.
function achieve(v: Cell): number | null {
  const n = num(v);
  if (n == null || Math.abs(n) > 5) return null;
  return Math.round(n * 100);
}

type Metric = { product: string; label: string; target: number | null; current: number | null; achievement: number | null };

async function readProduct(tab: string, product: string): Promise<{ metrics: Metric[]; month: string }> {
  const rows = await fetchSheetTabValuesByTitle(SPREADSHEET_ID, tab, "A1:Q30");
  // [N월 현황] 마커 → 그 아래 첫 'CVS 발주량' 헤더 행 → 목표/현황/달성률
  let month = "";
  let markerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].map((c) => String(c ?? "")).join(" ").match(/\[(\d+월)\s*현황\]/);
    if (m) { month = m[1]; markerIdx = i; break; }
  }
  if (markerIdx < 0) throw new Error(`${tab}: [N월 현황] 마커를 찾지 못함`);

  const hdrIdx = rows.findIndex((r, i) => i > markerIdx && r.some((c) => norm(c) === "CVS발주량") && r.some((c) => norm(c) === "인지조회비"));
  if (hdrIdx < 0) throw new Error(`${tab}: [${month} 현황] 헤더 행을 찾지 못함`);
  const header = rows[hdrIdx];
  const colOf = (name: string) => header.findIndex((c) => norm(c) === norm(name));

  const find = (kw: string) => rows.slice(hdrIdx + 1, hdrIdx + 6).find((r) => norm(r[1]).includes(kw));
  const targetRow = find("목표");
  const currentRow = find("현황");
  const achieveRow = find("달성");
  if (!targetRow || !currentRow) throw new Error(`${tab}: 목표/현황 행을 찾지 못함`);

  const metrics: Metric[] = METRICS.map((label) => {
    const ci = colOf(label);
    return {
      product,
      label,
      target: ci >= 0 ? num(targetRow[ci]) : null,
      current: ci >= 0 ? num(currentRow[ci]) : null,
      // 목표가 0/없음이면 달성률 무의미 → N/A
      achievement: ci >= 0 && num(targetRow[ci]) ? achieve(achieveRow?.[ci] ?? null) : null,
    };
  });
  return { metrics, month };
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) === "bad") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let metrics: Metric[] = [];
  let monthLabel = "";
  try {
    for (const { tab, product } of TABS) {
      const { metrics: m, month } = await readProduct(tab, product);
      metrics = metrics.concat(m);
      monthLabel = month || monthLabel;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyJob("KPI 스냅샷", "fail", `시트 조회 실패: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const supabase = getServerSupabase();
  const { error } = await supabase.from("kpi_snapshots").insert({ month_label: monthLabel, metrics });
  if (error) {
    await notifyJob("KPI 스냅샷", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await notifyJob("KPI 스냅샷", "ok", `${monthLabel} ${TABS.length}개 제품 × ${METRICS.length}지표`);
  return NextResponse.json({ ok: true, month_label: monthLabel, metrics });
}
