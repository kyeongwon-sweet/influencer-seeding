import { NextRequest, NextResponse } from "next/server";

// Clerk 인증 무시 (공개 API)
export const runtime = 'nodejs';

const META_ACCESS_TOKEN = process.env.META_BUSINESS_ACCESS_TOKEN ?? "";
const ACCOUNT_ID = process.env.META_BUSINESS_ACCOUNT_ID ?? "";

export async function GET(req: NextRequest) {
  try {
    console.log("[META_ADS] 요청 시작");
    console.log("[META_ADS] TOKEN 설정:", !!META_ACCESS_TOKEN);
    console.log("[META_ADS] ACCOUNT_ID:", ACCOUNT_ID);

    if (!META_ACCESS_TOKEN || !ACCOUNT_ID) {
      console.error("[META_ADS] 환경변수 누락");
      return NextResponse.json(
        { error: "Meta 환경변수 설정 필요" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "date_from과 date_to 필수" },
        { status: 400 }
      );
    }

    // Meta Ads API: 일별 광고 비용
    const url = new URL(
      `https://graph.instagram.com/v18.0/act_${ACCOUNT_ID}/insights`
    );
    url.searchParams.set("date_preset", "");
    url.searchParams.set("time_range", JSON.stringify({ since: dateFrom, until: dateTo }));
    url.searchParams.set("fields", "spend,date_start,impressions");
    url.searchParams.set("access_token", META_ACCESS_TOKEN);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok) {
      console.error("[META_ADS_ERROR]", data);
      return NextResponse.json(
        { error: data?.error?.message ?? "Meta API 요청 실패" },
        { status: res.status }
      );
    }

    // spend 기반으로 날짜별 집계
    const dailyCost = new Map<string, number>();
    if (data.data) {
      data.data.forEach((item: { spend: number; date_start: string }) => {
        const date = item.date_start;
        dailyCost.set(date, (dailyCost.get(date) ?? 0) + (item.spend ?? 0));
      });
    }

    // 날짜 범위 모두 채우기 (누적값)
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const result: { date: string; total_cost: number }[] = [];
    let cumulative = 0;

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      cumulative += dailyCost.get(dateStr) ?? 0;
      result.push({ date: dateStr, total_cost: cumulative });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[META_ADS_EXCEPTION]", err);
    return NextResponse.json(
      { error: "서버 오류" },
      { status: 500 }
    );
  }
}
