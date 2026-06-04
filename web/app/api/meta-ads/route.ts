import { NextRequest, NextResponse } from "next/server";

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  console.log("[META_ADS] GET 요청 수신", new Date().toISOString());

  try {
    const token = process.env.META_BUSINESS_ACCESS_TOKEN;
    const accountId = process.env.META_BUSINESS_ACCOUNT_ID;

    console.log("[META_ADS] TOKEN 있음?", !!token);
    console.log("[META_ADS] ACCOUNT_ID:", accountId);

    if (!token || !accountId) {
      console.error("[META_ADS] 환경변수 없음");
      return NextResponse.json({
        error: "환경변수 없음",
        hasToken: !!token,
        hasAccountId: !!accountId
      }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    console.log("[META_ADS] 날짜:", dateFrom, "~", dateTo);

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "date_from, date_to 필수" },
        { status: 400 }
      );
    }

    // 테스트: 임시 데이터 반환
    const result = [
      { date: dateFrom, total_cost: 10000 },
      { date: dateTo, total_cost: 25000 }
    ];

    console.log("[META_ADS] 응답:", result);
    return NextResponse.json(result);

  } catch (err) {
    console.error("[META_ADS] 에러:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "서버 에러", details: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
