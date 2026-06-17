export const runtime = 'nodejs';

// 임시 진단: Meta가 실제로 어떤 날짜·spend를 주는지 원본 그대로 확인 (cron secret 인증)
export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const since = searchParams.get("since") || "2026-06-01";
  const until = searchParams.get("until") || "2026-06-17";

  const token = process.env.META_BUSINESS_ACCESS_TOKEN;
  const account = process.env.META_BUSINESS_ACCOUNT_ID;
  if (!token || !account) {
    return Response.json({ error: "env missing", hasToken: !!token, hasAccount: !!account });
  }

  const url = new URL(`https://graph.facebook.com/v18.0/act_${account}/insights`);
  url.searchParams.append('fields', 'spend,date_start,date_stop');
  url.searchParams.append('time_range', JSON.stringify({ since, until }));
  url.searchParams.append('time_increment', '1');
  url.searchParams.append('access_token', token);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json();
  return Response.json({
    requested: { since, until },
    account_tail: String(account).slice(-4),
    http: res.status,
    error: data.error ?? null,
    rowCount: Array.isArray(data.data) ? data.data.length : null,
    rows: Array.isArray(data.data) ? data.data.map(r => ({ d: r.date_start, spend: r.spend })) : data,
    paging: data.paging ? Object.keys(data.paging) : null,
  });
}
