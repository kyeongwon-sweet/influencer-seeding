import { NextRequest, NextResponse } from "next/server";
import { getSheetTitles, fetchSheetTabValuesByTitle } from "@/lib/google-sheets";

export const runtime = "nodejs";

// 임시 진단: KPI 새 소스([인지_쫀득바]/[인지_듬뿍바] 탭 [6월 현황]) 배치 확인용. 구현 후 삭제.
const SID = "1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out: Record<string, unknown> = {};
  try {
    out.tabs = await getSheetTitles(SID);
  } catch (e) {
    out.tabs = String(e);
  }

  for (const title of ["인지_쫀득바", "인지_듬뿍바"]) {
    try {
      const rows = await fetchSheetTabValuesByTitle(SID, title, "A1:AB80");
      // 빈 끝 셀 제거 + 행 인덱스 부여. 6월/목표/현황/달성률/CVS 근처만 보기 쉽게.
      out[title] = rows
        .map((r, i) => ({ i, cells: r.map((c) => (c == null ? "" : c)) }))
        .filter((r) => r.cells.some((c) => String(c).trim() !== ""));
    } catch (e) {
      out[title] = String(e);
    }
  }

  return NextResponse.json(out);
}
