import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { fetchSheetTabValues } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 홈 '이달의 목표' 카드 — 마케팅T 시트 [인지_쫀득바] 탭의 월 현황 블록(26.MM 행 아래 목표/현황/달성률)을 읽어 반환.
// 블록 구조(시트): [26.07 | CVS 발주량 | 광고비 | … | 인지 조회비] 헤더 행 + 목표/현황/달성률 3행.
// 현재 월(KST)을 자동 인식해 다음 달부터는 자동으로 새 블록을 읽음. 서비스계정 뷰어 권한(기존 kpi와 동일 시트).
const SPREADSHEET_ID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";
const GID = 1224959784;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let values: (string | number | null)[][];
  try {
    values = await fetchSheetTabValues(SPREADSHEET_ID, GID, "A1:S400");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  const monthKey = `${String(now.getUTCFullYear()).slice(2)}.${String(now.getUTCMonth() + 1).padStart(2, "0")}`; // "26.07"
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").trim();

  // 디버그: ?raw=1 이면 월 블록 주변 원시 행을 반환(파싱 검증용)
  const raw = new URL(req.url).searchParams.get("raw") === "1";

  // 1) "26.MM" 셀이 있는 헤더 행 탐색
  let headerRow = -1, monthCol = -1;
  for (let i = 0; i < values.length; i++) {
    const j = (values[i] ?? []).findIndex(c => norm(c) === monthKey);
    if (j !== -1) { headerRow = i; monthCol = j; break; }
  }
  if (headerRow === -1) {
    return NextResponse.json({ error: `'${monthKey}' 블록을 찾지 못했습니다`, ...(raw ? { sample: values.slice(0, 30).map(r => r.slice(0, 6)) } : {}) }, { status: 404 });
  }
  if (raw) {
    return NextResponse.json({ monthKey, headerRow, monthCol, rows: values.slice(headerRow, headerRow + 5).map(r => r.slice(0, 18)) });
  }

  // 2) 헤더 라벨(월 셀 오른쪽) + 아래 3행(목표/현황/달성률) 매핑
  const labels: string[] = [];
  const header = values[headerRow] ?? [];
  for (let c = monthCol + 1; c < header.length; c++) labels.push(String(header[c] ?? "").trim());
  const pick = (name: string) => {
    for (let i = headerRow + 1; i <= headerRow + 4 && i < values.length; i++) {
      const row = values[i] ?? [];
      const first = row.slice(0, monthCol + 1).map(norm).find(Boolean);
      if (first === name) return labels.map((_, k) => row[monthCol + 1 + k] ?? null);
    }
    return null;
  };
  const goal = pick("목표"), current = pick("현황"), rate = pick("달성률");
  if (!goal || !current) {
    return NextResponse.json({ error: "목표/현황 행을 찾지 못했습니다" }, { status: 404 });
  }

  const metrics = labels
    .map((label, i) => ({ label, goal: goal[i], current: current[i], rate: rate ? rate[i] : null }))
    .filter(m => m.label && (m.goal != null || m.current != null));

  return NextResponse.json(
    { month: now.getUTCMonth() + 1, monthKey, metrics, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } }
  );
}
