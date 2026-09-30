import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { fetchSheetTabValues } from "@/lib/google-sheets";
import {
  buildProductSearchTrends,
  PRODUCT_SEARCH_BRAND_KEY,
} from "@/lib/product-search-trends";

export const runtime = "nodejs";

// 상품별 검색량 Google Sheet. 2026-08-20 보안 정책에 따라 공개 링크가 해제되어
// 이미 공유된 서비스 계정으로 Dashboard 탭을 읽는다.
const SHEET_ID = "1fxxxTHRQUQ7NIAB8WSK2lKjPyVYrPe63_RPMKfm_v3M";
const SHEET_GID = 426959601;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let rows: (string | number | null)[][];
  try {
    rows = await fetchSheetTabValues(SHEET_ID, SHEET_GID, "A1:U2000");
  } catch (error) {
    const message = error instanceof Error ? error.message : "시트 네트워크 오류";
    console.error(`[product-search-trends] ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const result = buildProductSearchTrends(rows, PRODUCT_SEARCH_BRAND_KEY);
  return NextResponse.json(result, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } });
}
