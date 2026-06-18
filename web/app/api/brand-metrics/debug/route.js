export const runtime = 'nodejs';

// 임시 진단: YouTube Analytics 토큰/metrics 무엇이 문제인지 확인 (cron secret)
export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const date = new URL(req.url).searchParams.get("date") || "2026-06-16";
  const out = { date, steps: {} };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  out.steps.env = { hasClientId: !!clientId, hasSecret: !!clientSecret, hasRefresh: !!refreshToken };
  if (!clientId || !clientSecret || !refreshToken) return Response.json(out);

  // 1) 토큰 갱신
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const tokJson = await tokRes.json();
  out.steps.token = { http: tokRes.status, ok: tokRes.ok, error: tokJson.error ?? null, scope: tokJson.scope ?? null };
  if (!tokRes.ok) return Response.json(out);
  const at = tokJson.access_token;

  async function report(label, params) {
    const u = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    u.searchParams.set("ids", "channel==MINE");
    u.searchParams.set("startDate", date);
    u.searchParams.set("endDate", date);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${at}` } });
    const j = await r.json();
    out.steps[label] = { http: r.status, error: j.error?.message ?? j.error ?? null, columnHeaders: j.columnHeaders?.map(c => c.name), rows: j.rows };
  }

  // 현재 코드(잘못된 metrics)
  await report("current_views_uniqe_search", { metrics: "views,uniqeViewers,search", dimensions: "day" });
  // 후보 1: 총 조회수
  await report("views_only", { metrics: "views", dimensions: "day" });
  // 후보 2: 트래픽 소스별 조회수 (YT_SEARCH 찾기)
  await report("views_by_trafficsource", { metrics: "views", dimensions: "insightTrafficSourceType" });
  // 후보 3: 검색 소스 필터
  await report("views_filter_search", { metrics: "views", filters: "insightTrafficSourceType==YT_SEARCH" });

  return Response.json(out);
}
