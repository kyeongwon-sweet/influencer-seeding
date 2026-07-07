import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValuesByTitle } from "@/lib/google-sheets";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;

// 마케팅T 대시보드. 발주량 소스: 제품별 '인지_*' 탭의 [일자별 현황] 표(날짜 | CVS 발주량 | B2B 발주량).
// ⚠️ 6월까지는 'N월 현황' 통합표(GID 588764344)를 읽었으나, 7월부터 시트가 제품별 탭 구조로 바뀜
//    ('6월 현황'은 6/30에서 끝남). → 3개 제품 탭의 일자별 CVS+B2B 발주량을 날짜별 합산으로 전환(2026-07-07).
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
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

  // TEMP 진단: ?dump=<탭> → [일자별 현황] 헤더·날짜행 추출
  if (req.nextUrl.searchParams.has("dump")) {
    const t = req.nextUrl.searchParams.get("dump") || "";
    const rr = await fetchSheetTabValuesByTitle(SPREADSHEET_ID, t, "A1:H200").catch((e) => [["<err>", String(e).slice(0, 80)]]);
    const marker = rr.findIndex((r) => r.some((c) => typeof c === "string" && c.includes("일자별 현황")));
    const hdrIdx = rr.findIndex((r, i) => i > (marker < 0 ? 0 : marker) && r.some((c) => typeof c === "string" && c.trim() === "CVS 발주량") && r.some((c) => typeof c === "string" && c.trim() === "B2B 발주량"));
    const slice = hdrIdx >= 0 ? rr.slice(hdrIdx, hdrIdx + 45) : rr.slice(0, 30);
    return NextResponse.json({ title: t, marker, hdrIdx, header: hdrIdx >= 0 ? rr[hdrIdx] : null, sample: slice.map((r) => [r[1], r[2], r[3]]) });
  }

  // 시트 날짜는 M/D뿐이라 연도를 추정. 현재 월(KST)과 6개월 이상 차이나면 인접 연도로 보정.
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const curYear = nowKST.getUTCFullYear(), curMonth = nowKST.getUTCMonth() + 1;

  // 3개 제품 탭의 [일자별 현황]에서 CVS 발주량 + B2B 발주량을 날짜별로 합산.
  const agg = new Map<string, { cvs: number; b2b: number }>();
  const perTab: Record<string, unknown>[] = [];
  for (const tab of INJI_TABS) {
    let rr: (string | number | null)[][];
    try {
      rr = await fetchSheetTabValuesByTitle(SPREADSHEET_ID, tab, "A1:H200");
    } catch (e) {
      perTab.push({ tab, error: String(e).slice(0, 60) });
      continue;
    }
    // [일자별 현황] 마커 아래에서 'CVS 발주량'+'B2B 발주량'을 동시에 가진 헤더 행을 찾는다
    // (상단 주차별 표에는 B2B 발주량이 없어 자연히 일자별 헤더가 잡힘).
    const marker = rr.findIndex((r) => r.some((c) => typeof c === "string" && c.includes("일자별 현황")));
    let h = -1, ci = -1, bi = -1, di = -1;
    for (let i = Math.max(0, marker); i < rr.length; i++) {
      const c = rr[i].findIndex((x) => typeof x === "string" && x.trim() === "CVS 발주량");
      const b = rr[i].findIndex((x) => typeof x === "string" && x.trim() === "B2B 발주량");
      if (c >= 0 && b >= 0) {
        h = i; ci = c; bi = b;
        const d = rr[i].findIndex((x) => typeof x === "string" && x.trim() === "날짜");
        di = d >= 0 ? d : c - 1;
        break;
      }
    }
    if (h < 0) { perTab.push({ tab, error: "일자별 헤더('CVS 발주량'+'B2B 발주량') 없음" }); continue; }

    let started = false, gap = 0, n = 0;
    for (let i = h + 1; i < rr.length; i++) {
      // 월 합계행(26.05·26.06·26.07 등)은 날짜셀이 number → 문자열 아닌 것 skip. 일별은 "7. 1 (수)" 문자열.
      const ds = typeof rr[i][di] === "string" ? (rr[i][di] as string) : "";
      const m = ds.match(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})/);
      const mo = m ? Number(m[1]) : 0, day = m ? Number(m[2]) : 0;
      if (!(mo >= 1 && mo <= 12 && day >= 1 && day <= 31)) {
        if (started && ++gap > 8) break; // 표 끝(연속 공백)에서 종료
        continue;
      }
      gap = 0; started = true;
      const year = mo - curMonth > 6 ? curYear - 1 : curMonth - mo > 6 ? curYear + 1 : curYear;
      const date = `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cvs = toNum(rr[i][ci]) ?? 0, b2b = toNum(rr[i][bi]) ?? 0;
      const e = agg.get(date) ?? { cvs: 0, b2b: 0 };
      e.cvs += cvs; e.b2b += b2b;
      agg.set(date, e);
      n++;
    }
    perTab.push({ tab, hdrIdx: h, ci, bi, di, nDates: n });
  }

  const records = [...agg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date,
      dumbuk_order: v.cvs,     // CVS 발주량 합계(전 제품) — 기존 필드 의미(CVS 채널) 유지
      jjondeuk_order: v.b2b,   // B2B 발주량 합계(전 제품)
      total_order: v.cvs + v.b2b,
      updated_at: new Date().toISOString(),
    }));

  if (records.length === 0) {
    await notifyJob("B2B 발주량", "fail", "인지 탭 일자별 발주량을 찾지 못함");
    return NextResponse.json({ error: "인지 탭 일자별 발주량을 찾지 못했습니다.", perTab }, { status: 500 });
  }

  const supabase = getServerSupabase();
  // ⚠️ order 필드(dumbuk_order·jjondeuk_order·total_order)만 upsert → 6월 기존 이익/공헌이익 컬럼은
  //    onConflict 시 미지정이라 보존됨(6월 현황 소스에서 채워진 값 유지). 7월+ 신규행은 그 컬럼 null.
  const { error } = await supabase.from("b2b_daily_metrics").upsert(records, { onConflict: "date" });
  if (error) {
    await notifyJob("B2B 발주량", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await notifyJob("B2B 발주량", "ok", `${records.length}일 (${records[0].date} ~ ${records[records.length - 1].date})`);
  return NextResponse.json({
    ok: true, count: records.length, first: records[0].date, last: records[records.length - 1].date,
    debug: { perTab, d0630: agg.get("2026-06-30"), july: ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-05", "2026-07-06"].map((d) => ({ d, ...(agg.get(d) ?? {}) })) }, // TEMP
  });
}
