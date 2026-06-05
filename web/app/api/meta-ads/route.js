export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    if (!dateFrom || !dateTo) {
      return Response.json({ error: "date_from과 date_to는 필수입니다" }, { status: 400 });
    }

    console.log("[Meta Ads API] 광고비 데이터 조회:", dateFrom, "~", dateTo);

    const accessToken = process.env.META_BUSINESS_ACCESS_TOKEN;
    const accountId = process.env.META_BUSINESS_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      const errorMsg = "META_BUSINESS_ACCESS_TOKEN 또는 META_BUSINESS_ACCOUNT_ID 환경변수가 설정되지 않았습니다";
      console.error("[Meta Ads API]", errorMsg);
      return Response.json({ error: errorMsg }, { status: 500 });
    }

    const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });
    const url = `https://graph.facebook.com/v18.0/act_${accountId}/insights?fields=spend,date_start&time_range=${encodeURIComponent(timeRange)}&access_token=${encodeURIComponent(accessToken)}`;

    console.log("[Meta Ads API] 요청 URL:", url.replace(accessToken, "***"));

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("[Meta Ads API] 오류:", data.error);
      return Response.json({ error: "Meta API 오류", details: data.error }, { status: response.status });
    }

    console.log("[Meta Ads API] 전체 응답:", JSON.stringify(data, null, 2));

    if (!data.data || !Array.isArray(data.data)) {
      console.log("[Meta Ads API] 데이터 없음");
      return Response.json([]);
    }

    console.log("[Meta Ads API] 수신 데이터:", data.data.length, "건");
    console.log("[Meta Ads API] 각 항목의 필드명:", Object.keys(data.data[0] || {}));
    console.log("[Meta Ads API] 상세 데이터:", JSON.stringify(data.data.slice(0, 10), null, 2));

    const sorted = data.data
      .filter(item => item.date_start && item.spend)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    console.log("[Meta Ads API] 필터링 후:", sorted.length, "건");

    let cumulative = 0;
    const result = sorted.map(item => {
      const spend = parseFloat(item.spend) || 0;
      cumulative += spend;
      return {
        date: item.date_start.split('T')[0],  // YYYY-MM-DD 형식
        total_cost: Math.round(cumulative * 100) / 100
      };
    });

    console.log("[Meta Ads API] 누적 데이터 반환:", result.length, "건");
    return Response.json(result);

  } catch (err) {
    console.error("[Meta Ads API] 오류:", err.message);
    return Response.json({ error: "API 오류", message: err.message }, { status: 500 });
  }
}
