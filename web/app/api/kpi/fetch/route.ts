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
  // 마커 → 그 아래 첫 'CVS 발주량' 헤더 행 → 목표/현황/달성률.
  // 탭마다 마커 형식이 다름: 듬뿍바=[6월 현황](월 포함), 쫀득바(신형)=[월별 현황](월은 26.06 행에서).
  let month = "";
  let markerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const j = rows[i].map((c) => String(c ?? "")).join(" ");
    const m = j.match(/\[(\d+월)\s*현황\]/);            // 구형: [6월 현황]
    if (m) { month = m[1]; markerIdx = i; break; }
    if (/\[월별\s*현황\]/.test(j)) { markerIdx = i; break; }  // 신형: [월별 현황]
  }
  if (markerIdx < 0) throw new Error(`${tab}: [N월 현황]/[월별 현황] 마커를 찾지 못함`);

  // 월 라벨 보강: 신형 마커엔 월이 없으므로 블록의 'YY.MM'(예 26.06) 값에서 추출(없으면 다른 탭 값으로 폴백).
  if (!month) {
    for (let i = markerIdx; i < Math.min(rows.length, markerIdx + 8); i++) {
      const mm = rows[i].map((c) => String(c ?? "")).join(" ").match(/\b\d{2}\.(\d{2})\b/);
      if (mm) { month = String(parseInt(mm[1], 10)) + "월"; break; }
    }
  }

  const hdrIdx = rows.findIndex((r, i) => i > markerIdx && r.some((c) => norm(c) === "CVS발주량") && r.some((c) => norm(c) === "인지조회비"));
  if (hdrIdx < 0) throw new Error(`${tab}: [${month} 현황] 헤더 행을 찾지 못함`);
  const header = rows[hdrIdx];
  // 헤더 텍스트 매칭(공백무시). 탭마다 표기가 미세하게 달라(쫀득바 신형 등) 정확일치가 안 되면
  // '겹치지 않는' 안전 폴백만 적용 — 잘못된 컬럼에 붙지 않도록 다른 지표와 배타적인 조건만 사용.
  const colOf = (name: string) => {
    let idx = header.findIndex((c) => norm(c) === norm(name));
    if (idx >= 0) return idx;
    const nn = norm(name);
    if (nn === norm("본부공헌이익(=가용예산)")) {
      // '본부공헌이익'으로 시작하되 '*...(판매)'(다른 지표)가 아닌 본체 컬럼.
      idx = header.findIndex((c) => { const x = norm(c); return x.startsWith("본부공헌이익") && !x.startsWith("*") && !x.includes("판매"); });
    } else if (nn === norm("*POS 일 판매량")) {
      // 'POS'와 '판매'를 함께 가진 유일 컬럼(‘*CVS 손익(판매)’엔 POS 없음).
      idx = header.findIndex((c) => { const x = norm(c); return x.includes("POS") && x.includes("판매"); });
    }
    return idx;
  };

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
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
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
  const { data: ins, error } = await supabase.from("kpi_snapshots").insert({ month_label: monthLabel, metrics }).select("id").single();
  if (error) {
    await notifyJob("KPI 스냅샷", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // 소비자(/api/kpi)는 최신 1행만 읽음 — 매일 크론이 같은 달 행을 무한 누적하지 않게 옛 행 정리(달별 최신 1행 유지)
  if (ins?.id) await supabase.from("kpi_snapshots").delete().eq("month_label", monthLabel).neq("id", ins.id);

  await notifyJob("KPI 스냅샷", "ok", `${monthLabel} ${TABS.length}개 제품 × ${METRICS.length}지표`);
  return NextResponse.json({ ok: true, month_label: monthLabel, metrics });
}
