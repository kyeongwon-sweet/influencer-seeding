import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabValues } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const maxDuration = 30;

// 마케팅T 시트 [인지_쫀득바] 탭의 '일별 시계열' 영역에서 인지 광고(메타/틱톡/유튜브)의
// 그날 조회수·광고비를 읽는다. 값은 DB에 없고 이 시트에만 있어(팀이 매일 수동 입력) 여기서 직접 읽는다.
//   - 일별 값(누적 아님) → 그대로 사용.
//   - 각 인지광고 채널은 [광고비, 조회수, 조회당비용] 3칸 세트. 열은 고정(0-based, A=0):
//       Meta_인지_릴스 (석영):  광고비 AW(48) / 조회수 AX(49)
//       틱톡_인지_릴스 (석영):  광고비 AZ(51) / 조회수 BA(52)
//       유튜브_인지_릴스 (석영): 광고비 BC(54) / 조회수 BD(55)
//       Meta_인지_배너 (석영):  광고비 BF(57) / 조회수 BG(58)
//     → 메타 = 릴스(AX) + 배너(BG) 합산(광고비도 AW+BF 합산). 틱톡/유튜브는 릴스 1칸.
//   - ⚠️ 2026-07-20: 이전엔 AK/AN/AQ/AT(전환·바이럴 채널의 광고비 칸)를 조회수로 잘못 읽어
//     메타/유튜브 값이 광고비(₩)로 오염됐음(시트 열 재편으로 고정 열번호가 밀림). 실제 인지광고
//     플랫폼별 조회수는 AW~BG 세트에 있음(사용자 확인). 재발 방지: 조회수 칸에 ₩(=광고비)가
//     잡히면 오정렬로 보고 해당 값 제외 + warn 반환(numOrNull은 ₩를 떼므로 raw로 별도 검사).
//   - 날짜는 B열의 "M. D (요일)" 라벨. 주간요약/일별 블록에 같은 날짜가 중복될 수 있어
//     '마지막(=가장 아래=일별 블록)' 매칭 행을 채택한다.
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
const GID = 1224959784; // 인지_쫀득바
const COL = {
  date: 1,                                  // B
  metaReelCost: 48, metaReelView: 49,       // AW, AX  Meta_인지_릴스 (석영)
  ttReelCost: 51, ttReelView: 52,           // AZ, BA  틱톡_인지_릴스 (석영)
  ytReelCost: 54, ytReelView: 55,           // BC, BD  유튜브_인지_릴스 (석영)
  metaBannerCost: 57, metaBannerView: 58,   // BF, BG  Meta_인지_배너 (석영)
};

type Cell = string | number | null | undefined;

function numOrNull(v: Cell): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s₩%]/g, ""));
  return isFinite(n) ? n : null;
}

// 조회수 칸에 ₩(원화=광고비)가 들어있으면 열이 밀린 것 → 오정렬 신호.
function rawHasWon(v: Cell): boolean {
  return typeof v === "string" && v.includes("₩");
}

// "7. 13 (월)" → { m: 7, d: 13 } (없으면 null)
function parseMD(v: Cell): { m: number; d: number } | null {
  const mm = String(v ?? "").match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
  return mm ? { m: parseInt(mm[1], 10), d: parseInt(mm[2], 10) } : null;
}

// 조회수 합산(메타처럼 릴스+배너 2칸). 하나라도 값이 있으면 합, 둘 다 미입력(빈칸)이면 null(≠0).
// 조회수 칸에 ₩(광고비)가 잡히면 오정렬로 보고 그 칸은 제외하고 warns에 기록.
function sumViews(row: Cell[], idxs: number[], label: string, warns: string[]): number | null {
  let sum = 0;
  let any = false;
  for (const i of idxs) {
    if (rawHasWon(row[i])) {
      warns.push(`${label} 조회수 칸(열 ${i})에 ₩값 감지 — 시트 열 정렬 확인 필요(광고비 오독 방지)`);
      continue;
    }
    const n = numOrNull(row[i]);
    if (n != null) { sum += n; any = true; }
  }
  return any ? sum : null;
}

// 광고비(₩) 합산. 광고비는 ₩가 정상이라 그대로 numOrNull 합산.
function sumOrNull(row: Cell[], idxs: number[]): number | null {
  let sum = 0;
  let any = false;
  for (const i of idxs) {
    const n = numOrNull(row[i]);
    if (n != null) { sum += n; any = true; }
  }
  return any ? sum : null;
}

function kstYesterday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000 - 24 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

type Channel = { views: number | null; cost: number | null };

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const date = (req.nextUrl.searchParams.get("date") || kstYesterday()).slice(0, 10);
  const parts = date.split("-").map((s) => parseInt(s, 10));
  const mo = parts[1];
  const dy = parts[2];
  if (!mo || !dy) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식" }, { status: 400 });
  }

  let rows: Cell[][];
  try {
    // BG(58)까지 필요 → BJ까지 여유 있게 읽는다.
    rows = await fetchSheetTabValues(SPREADSHEET_ID, GID, "A1:BJ500");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `시트 조회 실패: ${msg}` }, { status: 502 });
  }

  // 같은 날짜가 여러 번 나오면 마지막(일별 블록) 행 채택.
  let target: Cell[] | null = null;
  for (const r of rows) {
    const md = parseMD(r[COL.date]);
    if (md && md.m === mo && md.d === dy) target = r;
  }
  if (!target) {
    return NextResponse.json({ date, found: false });
  }

  const warns: string[] = [];
  const meta: Channel = {
    views: sumViews(target, [COL.metaReelView, COL.metaBannerView], "메타", warns),
    cost: sumOrNull(target, [COL.metaReelCost, COL.metaBannerCost]),
  };
  const tiktok: Channel = {
    views: sumViews(target, [COL.ttReelView], "틱톡", warns),
    cost: numOrNull(target[COL.ttReelCost]),
  };
  const youtube: Channel = {
    views: sumViews(target, [COL.ytReelView], "유튜브", warns),
    cost: numOrNull(target[COL.ytReelCost]),
  };

  return NextResponse.json({
    date,
    found: true,
    meta,
    tiktok,
    youtube,
    ...(warns.length ? { warn: warns } : {}),
  });
}
