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

  // 메인 라우트(/api/meta-ads)의 effectiveTo 로직 재현
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const yest = new Date(new Date(kstToday + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const effectiveTo = until < kstToday ? until : yest;

  // 메인 라우트 파이프라인 그대로: until=effectiveTo로 재요청 → 일별 매핑
  const mainUrl = new URL(`https://graph.facebook.com/v18.0/act_${account}/insights`);
  mainUrl.searchParams.append('fields', 'spend,date_start');
  mainUrl.searchParams.append('time_range', JSON.stringify({ since, until: effectiveTo }));
  mainUrl.searchParams.append('time_increment', '1');
  mainUrl.searchParams.append('access_token', token);
  const mres = await fetch(mainUrl.toString(), { cache: "no-store" });
  const mdata = await mres.json();
  const mainResult = (Array.isArray(mdata.data) ? mdata.data : [])
    .filter(it => it.date_start && it.spend)
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
    .map(it => ({ date: it.date_start.split("T")[0], cost: Math.round((parseFloat(it.spend) || 0) * 100) / 100 }));

  return Response.json({
    mainResult_count: mainResult.length,
    mainResult_range: mainResult.length ? `${mainResult[0].date} ~ ${mainResult[mainResult.length-1].date}` : "none",
    mainResult,
    requested: { since, until },
    kstToday, effectiveTo,
    account_tail: String(account).slice(-4),
    http: res.status,
    error: data.error ?? null,
    rowCount: Array.isArray(data.data) ? data.data.length : null,
    rows: Array.isArray(data.data) ? data.data.map(r => ({ d: r.date_start, spend: r.spend })) : data,
    paging: data.paging ? Object.keys(data.paging) : null,
  });
}
