export async function GET(req) {
  try {
    // 간단한 테스트 응답
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    // 임시 광고비 데이터
    const result = [];
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    let cost = 10000;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      cost += Math.random() * 5000;
      result.push({ date: dateStr, total_cost: Math.round(cost) });
    }

    return Response.json(result);
  } catch (err) {
    console.error("[API_ERROR]", err);
    return Response.json({ error: "API 에러" }, { status: 500 });
  }
}
