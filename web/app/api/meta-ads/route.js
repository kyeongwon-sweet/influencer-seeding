export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    if (!dateFrom || !dateTo) {
      return Response.json({ error: "date_from과 date_to는 필수입니다" }, { status: 400 });
    }

    // ========================================
    // 📌 임시: Mock 데이터 반환
    // (실제 Meta API는 웹훅/서버 설정 필요)
    // ========================================
    const result = [];
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    let cumulative = 0;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      // 일별 광고비: 300,000 ~ 800,000원 사이
      const dailySpend = Math.floor(Math.random() * 500000) + 300000;
      cumulative += dailySpend;
      result.push({ date: dateStr, total_cost: Math.round(cumulative) });
    }

    return Response.json(result);

    // ========================================
    // TODO: 실제 Meta Ads API 구현
    // 필요한 것:
    // - META_BUSINESS_ACCESS_TOKEN (유효한 토큰)
    // - META_BUSINESS_ACCOUNT_ID (광고 계정 ID)
    // - ads_management 권한
    // ========================================
  } catch (err) {
    console.error("[API_ERROR]", err);
    return Response.json({ error: "API 에러", message: err.message }, { status: 500 });
  }
}
