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
      console.error("[META_API] 환경변수 누락");
      return Response.json({ error: "환경변수 설정 필요: META_BUSINESS_ACCESS_TOKEN, META_BUSINESS_ACCOUNT_ID" }, { status: 500 });
    }

    // Meta Marketing API: 광고 계정의 일별 광고비 조회
    // time_range는 JSON으로 전달 (URLSearchParams에서 수동으로 인코딩)
    const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });
    const url = `https://graph.facebook.com/v18.0/act_${accountId}/insights?fields=spend,date_start&time_range=${encodeURIComponent(timeRange)}&access_token=${encodeURIComponent(accessToken)}`;

    console.log("[META_API] 요청 URL:", url.replace(accessToken, '***').replace(timeRange, '***'));

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("[META_API_ERROR]", response.status, data);
      return Response.json(
        { error: "Meta API 오류", details: data.error?.message || data.error },
        { status: response.status }
      );
    }

    // API 응답 검증
    if (!data.data || !Array.isArray(data.data)) {
      console.warn("[META_API] 예상치 못한 응답 형식:", data);
      return Response.json([]);
    }

    // 날짜별 정렬 및 누적합 계산
    const sorted = data.data
      .filter(item => item.date_start && item.spend)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    let cumulative = 0;
    const result = sorted.map(item => {
      const spend = parseFloat(item.spend) || 0;
      cumulative += spend;
      return {
        date: item.date_start,
        total_cost: Math.round(cumulative * 100) / 100,
      };
    });

    console.log("[META_API] 성공:", result.length, "일자 데이터");
    return Response.json(result);
  } catch (err) {
    console.error("[API_ERROR]", err.message);
    return Response.json({ error: "API 에러", message: err.message }, { status: 500 });
  }
}
