import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabValues } from "@/lib/google-sheets";

export const runtime = "nodejs";
export const maxDuration = 30;

// 마케팅T 시트 [인지_쫀득바] 탭의 '일별 시계열' 영역에서 인지 광고(메타/틱톡/유튜브)의
// 그날 조회수·광고비를 읽는다. 값은 DB에 없고 이 시트에만 있어(팀이 매일 수동 입력) 여기서 직접 읽는다.
//   - 일별 값(누적 아님) → 그대로 사용.
//   - 각 광고채널은 [광고비, 조회수] 인접쌍. 열은 고정(0-based, A=0):
//       메타: 광고비 AJ(35)/조회수 AK(36), 광고비 AS(44)/조회수 AT(45)  → 두 블록 합산
//       틱톡: 광고비 AM(38)/조회수 AN(39)
//       유튜브: 광고비 AP(41)/조회수 AQ(42)
//   - 날짜는 B열의 "M. D (요일)" 라벨. 주간요약/일별 블록에 같은 날짜가 중복될 수 있어
//     '마지막(=가장 아래=일별 블록)' 매칭 행을 채택한다.
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
const GID = 1224959784; // 인지_쫀득바
const COL = {
  date: 1,        // B
  metaCostA: 35, metaViewA: 36,  // AJ, AK
  ttCost: 38, ttView: 39,        // AM, AN
  ytCost: 41, ytView: 42,        // AP, AQ
  metaCostB: 44, metaViewB: 45,  // AS, AT
};

type Cell = string | number | null | undefined;

function numOrNull(v: Cell): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s₩%]/g, ""));
  return isFinite(n) ? n : null;
}

// "7. 13 (월)" → { m: 7, d: 13 } (없으면 null)
function parseMD(v: Cell): { m: number; d: number } | null {
  const mm = String(v ?? "").match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
  return mm ? { m: parseInt(mm[1], 10), d: parseInt(mm[2], 10) } : null;
}

// 인접 블록 합산(메타처럼 2블록). 하나라도 값이 있으면 합, 둘 다 미입력(빈칸)이면 null(≠0).
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
    rows = await fetchSheetTabValues(SPREADSHEET_ID, GID, "A1:AV500");
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

  const meta: Channel = {
    views: sumOrNull(target, [COL.metaViewA, COL.metaViewB]),
    cost: sumOrNull(target, [COL.metaCostA, COL.metaCostB]),
  };
  const tiktok: Channel = { views: numOrNull(target[COL.ttView]), cost: numOrNull(target[COL.ttCost]) };
  const youtube: Channel = { views: numOrNull(target[COL.ytView]), cost: numOrNull(target[COL.ytCost]) };

  return NextResponse.json({ date, found: true, meta, tiktok, youtube });
}
