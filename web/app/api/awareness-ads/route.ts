import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabValues } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const maxDuration = 30;

// 마케팅T 시트 [인지_쫀득바] 탭의 '일별 시계열' 영역에서 인지 광고(메타/틱톡/유튜브)의
// 그날 조회수·광고비를 읽는다. 값은 DB에 없고 이 시트에만 있어(팀이 매일 수동 입력) 여기서 직접 읽는다.
//   - 일별 값(누적 아님) → 그대로 사용. 메타 = 릴스+배너 합산, 틱톡/유튜브는 릴스 1칸.
//   - 각 인지광고 채널은 [광고비, 조회수(Thruplay/참여), 조회당비용] 3칸 세트.
//
// ⚠️ 열번호 하드코딩 금지(재발방지). 시트가 재편될 때마다 고정 인덱스가 밀려 3번 깨졌다:
//     2026-07-20(세트 재편) · 2026-08-14(석영→재원, -3) · 2026-08-19(+1 열삽입, 날짜 B→C).
//   → 이제 **헤더 라벨로 열을 자동 탐지**한다(detectColumns). 시트에 열이 삽입/이동돼도 안 깨짐.
//     · 섹션헤더 행 = "Meta_인지_릴스" 포함 행. 그 다음 행 = 서브헤더(광고비/Thruplay/조회당…).
//     · 채널 광고비 열 = 섹션라벨 열의 서브헤더가 "광고비"면 그 열, 아니면 그 왼쪽(유튜브는 라벨이
//       Thruplay 칸에 얹혀 있어 -1 보정 필요). 조회수 = 광고비+1.
//     · 전환 조회수 = 서브헤더가 "전환 조회수"인 열. 날짜 = "M. D (요일)" 패턴이 가장 많은 좌측 열.
//   → 탐지 실패 시 값 대신 warn을 반환(발송 전 검수가 warn을 차단하므로 사람이 즉시 인지).
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
const GID = 1224959784; // 인지_쫀득바

type Cell = string | number | null | undefined;
type Pair = { cost: number; view: number };
type ColMap = {
  date: number;
  conversionView: number; // -1이면 없음
  metaReel: Pair;
  ttReel: Pair;
  ytReel: Pair;
  metaBanner: Pair;
};

const norm = (v: Cell) => String(v ?? "").replace(/\s+/g, "");

// "7. 13 (월)" → { m: 7, d: 13 } (없으면 null). 요일 괄호까지 있어야 일별 날짜로 인정.
function parseMD(v: Cell): { m: number; d: number } | null {
  const mm = String(v ?? "").match(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\(/);
  return mm ? { m: parseInt(mm[1], 10), d: parseInt(mm[2], 10) } : null;
}

// 헤더 라벨 기반 열 자동 탐지. 실패 시 null.
function detectColumns(rows: Cell[][]): ColMap | null {
  // 1) 섹션헤더 행 + 서브헤더 행
  const secRow = rows.findIndex((r) => r.some((c) => norm(c).includes("Meta_인지_릴스")));
  if (secRow < 0) return null;
  const sec = rows[secRow];
  const sub = rows[secRow + 1] || [];

  // 2) 채널별 (광고비, 조회수) 열. 섹션라벨 열 기준으로 서브헤더 "광고비"를 찾아 정렬.
  const findPair = (labelHas: string): Pair | null => {
    const c = sec.findIndex((v) => norm(v).includes(labelHas));
    if (c < 0) return null;
    const cost = norm(sub[c]) === "광고비" ? c : norm(sub[c - 1]) === "광고비" ? c - 1 : -1;
    if (cost < 0) return null;
    return { cost, view: cost + 1 }; // 광고비 바로 오른쪽이 Thruplay/참여(조회수)
  };
  const metaReel = findPair("Meta_인지_릴스");
  const ttReel = findPair("틱톡_인지_릴스");
  const ytReel = findPair("유튜브_인지_릴스");
  const metaBanner = findPair("Meta_인지_배너");
  if (!metaReel || !ttReel || !ytReel || !metaBanner) return null;

  // 3) 전환 조회수 열(서브헤더 라벨). 없으면 -1(전환 미표시).
  const conversionView = sub.findIndex((v) => norm(v) === "전환조회수");

  // 4) 날짜 열: "M. D (요일)" 매칭이 가장 많은 좌측 열(0~8 스캔).
  let date = -1;
  let best = 0;
  for (let c = 0; c <= 8; c++) {
    let cnt = 0;
    for (const r of rows) if (parseMD(r[c])) cnt++;
    if (cnt > best) { best = cnt; date = c; }
  }
  if (date < 0 || best < 3) return null;

  return { date, conversionView, metaReel, ttReel, ytReel, metaBanner };
}

function numOrNull(v: Cell): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s₩%]/g, ""));
  return isFinite(n) ? n : null;
}

// 조회수 칸에 ₩(원화=광고비)가 들어있으면 열이 밀린 것 → 오정렬 신호.
function rawHasWon(v: Cell): boolean {
  return typeof v === "string" && v.includes("₩");
}

// 조회수 합산(메타처럼 릴스+배너 2칸). 하나라도 값 있으면 합, 둘 다 빈칸이면 null(≠0).
// 조회수 칸에 ₩(광고비)가 잡히면 오정렬로 보고 그 칸 제외 + warns 기록.
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
    // 헤더 자동탐지 + 미래 열삽입 대비해 넉넉히 읽는다.
    rows = await fetchSheetTabValues(SPREADSHEET_ID, GID, "A1:CZ500");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `시트 조회 실패: ${msg}` }, { status: 502 });
  }

  const COL = detectColumns(rows);
  if (!COL) {
    // 탐지 실패 = 시트 헤더 변경 의심. 값 대신 warn(발송 전 검수가 차단 → 사람이 즉시 인지).
    return NextResponse.json({
      date,
      found: false,
      warn: ["인지광고 열 자동탐지 실패 — 시트 헤더(Meta_인지_릴스/틱톡/유튜브/배너·전환 조회수·날짜) 확인 필요"],
    });
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
    views: sumViews(target, [COL.metaReel.view, COL.metaBanner.view], "메타", warns),
    cost: sumOrNull(target, [COL.metaReel.cost, COL.metaBanner.cost]),
  };
  const tiktok: Channel = {
    views: sumViews(target, [COL.ttReel.view], "틱톡", warns),
    cost: numOrNull(target[COL.ttReel.cost]),
  };
  const youtube: Channel = {
    views: sumViews(target, [COL.ytReel.view], "유튜브", warns),
    cost: numOrNull(target[COL.ytReel.cost]),
  };
  // 전환 조회수(일별). "0"은 0으로, 빈칸은 null로. 헤더 없으면 null(미표시).
  const conversionViews = COL.conversionView >= 0 ? numOrNull(target[COL.conversionView]) : null;

  return NextResponse.json({
    date,
    found: true,
    meta,
    tiktok,
    youtube,
    conversion: { views: conversionViews },
    ...(warns.length ? { warn: warns } : {}),
  });
}
