import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValuesByTitle } from "@/lib/google-sheets";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;

const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
// 발주량 소스: 제품별 '인지_*' 3탭의 [일자별 현황](날짜 | CVS 발주량 | B2B 발주량).
// 시트가 제품별 탭 구조로 바뀌어 통합표('N월 현황')가 6/30에서 끝남 → 전 기간을 3탭 C+D 합산으로 통일(2026-07-07).
// order 필드만 upsert → 이익/공헌이익 컬럼은 onConflict 시 기존값 보존.
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

  // TEMP: 탭 원본 구조 확인용(?dump=인지_쫀득바). 확인 후 제거.
  const dumpTab = req.nextUrl.searchParams.get("dump");
  if (dumpTab) {
    const rr = await fetchSheetTabValuesByTitle(SPREADSHEET_ID, dumpTab, "A1:T160");
    const mk = rr.findIndex((r) => r.some((c) => typeof c === "string" && c.includes("일자별 현황")));
    // 헤더(marker+3 부근) + 7월 데이터 행만 반환
    const header = mk >= 0 ? rr.slice(mk, mk + 4).map((r, i) => ({ i: mk + i, r })) : [];
    const july = rr.map((r, i) => ({ i, r })).filter((x) => typeof x.r[1] === "string" && /^7\s*[.\/-]\s*\d/.test(String(x.r[1]).trim()));
    return NextResponse.json({ tab: dumpTab, marker: mk, header, july });
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

  // 제품별 '인지_*' 3탭 → 날짜별 CVS+B2B 발주량 합산
  const agg = new Map<string, { cvs: number; b2b: number }>();
  const seenTabs: string[] = [];
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
    seenTabs.push(tab);
    let s = false, g = 0;
    for (let i = h + 1; i < rr.length; i++) {
      const md = parseMD(rr[i][di]);
      if (!md) { if (s && ++g > 8) break; continue; }
      g = 0; s = true;
      const date = `${yearOf(md.mo)}-${String(md.mo).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
      const cvs = toNum(rr[i][ci]) ?? 0, b2b = toNum(rr[i][bi]) ?? 0;
      const e = agg.get(date) ?? { cvs: 0, b2b: 0 };
      e.cvs += cvs; e.b2b += b2b; agg.set(date, e);
    }
  }

  const records = [...agg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      dumbuk_order: v.cvs,       // CVS 발주량
      jjondeuk_order: v.b2b,     // B2B 발주량
      total_order: v.cvs + v.b2b,
      updated_at: new Date().toISOString(),
    }));

  if (records.length === 0) {
    await notifyJob("B2B 발주량", "fail", `일자별 데이터 행을 찾지 못함(탭 인식: ${seenTabs.join(",") || "없음"})`);
    return NextResponse.json({ error: "일자별 데이터 행을 찾지 못했습니다.", seenTabs }, { status: 500 });
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
