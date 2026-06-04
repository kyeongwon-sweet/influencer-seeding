export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    if (!dateFrom || !dateTo) {
      return Response.json({ error: "date_from과 date_to는 필수입니다" }, { status: 400 });
    }

    const accessToken = process.env.META_BUSINESS_ACCESS_TOKEN;
    const accountId = process.env.META_BUSINESS_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      console.error("[META_API] 환경변수 누락: META_BUSINESS_ACCESS_TOKEN, META_BUSINESS_ACCOUNT_ID");
      return Response.json({ error: "Meta API 설정이 필요합니다" }, { status: 500 });
    }

    // Meta Ads API: 일별 광고비 데이터 조회
    // https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights
    const timeRange = { since: dateFrom, until: dateTo };
    const url = `https://graph.facebook.com/v18.0/act_${accountId}/insights?fields=spend,date_start&date_preset=custom_date_range&time_range=${encodeURIComponent(JSON.stringify(timeRange))}&access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("[META_API_ERROR]", data);
      return Response.json({ error: "Meta API 오류", details: data }, { status: response.status });
    }

    // API 응답을 date별로 정렬하고 누적합 계산
    if (!data.data || !Array.isArray(data.data)) {
      console.warn("[META_API] 예상치 못한 응답 형식:", data);
      return Response.json([]);
    }

    // 날짜별로 정렬
    const sorted = data.data.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    // 누적합 계산
    let cumulative = 0;
    const result = sorted.map(item => {
      const spend = parseFloat(item.spend) || 0;
      cumulative += spend;
      return {
        date: item.date_start,
        total_cost: Math.round(cumulative * 100) / 100, // 소수점 2자리
      };
    });

    return Response.json(result);
  } catch (err) {
    console.error("[API_ERROR]", err);
    return Response.json({ error: "API 에러", message: err.message }, { status: 500 });
  }
}
