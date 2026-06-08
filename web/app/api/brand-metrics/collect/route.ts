import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// ── YouTube Analytics ──────────────────────────────────────────────────────
async function fetchYouTubeMetrics(dateStr: string) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  // 1. refresh token → access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  if (!tokenRes.ok) return null;
  const { access_token } = await tokenRes.json();

  // 2. YouTube Analytics — 어제 하루치 데이터
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids",       "channel==MINE");
  url.searchParams.set("startDate", dateStr);
  url.searchParams.set("endDate",   dateStr);
  url.searchParams.set("metrics",   "views,uniqeViewers,search");
  url.searchParams.set("dimensions","day");

  const analyticsRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!analyticsRes.ok) return null;

  const json = await analyticsRes.json();
  const row = json.rows?.[0]; // [day, views, uniqeViewers, search]
  if (!row) return null;

  return {
    yt_views: row[1] as number,
    yt_unique_viewers: row[2] as number,
    yt_search_views: row[3] as number
  };
}

// ── Instagram Graph API ────────────────────────────────────────────────────
async function fetchInstagramMetrics(dateStr: string) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId      = process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !userId) return null;

  // since/until은 Unix timestamp (period=day 기준 하루)
  const since = Math.floor(new Date(dateStr + "T00:00:00+09:00").getTime() / 1000);
  const until = since + 86400;

  const url = new URL(`https://graph.instagram.com/v19.0/${userId}/insights`);
  url.searchParams.set("metric",       "profile_views,reach");
  url.searchParams.set("period",       "day");
  url.searchParams.set("since",        String(since));
  url.searchParams.set("until",        String(until));
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const json = await res.json();
  const metrics: Record<string, number> = {};
  for (const item of json.data ?? []) {
    const value = item.values?.find((v: { end_time: string }) =>
      v.end_time?.slice(0, 10) === dateStr
    )?.value ?? null;
    if (value !== null) metrics[item.name] = value;
  }

  return {
    ig_profile_views: metrics["profile_views"] ?? null,
    ig_reach:         metrics["reach"]         ?? null,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Vercel Cron 또는 GitHub Actions에서 호출 — CRON_SECRET으로 인증
  const authHeader = req.headers.get("authorization");
  const secret     = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 어제 날짜 (KST)
  const kstNow  = new Date(Date.now() + 9 * 3600 * 1000);
  kstNow.setDate(kstNow.getDate() - 1);
  const dateStr = kstNow.toISOString().slice(0, 10);

  const [yt, ig] = await Promise.all([
    fetchYouTubeMetrics(dateStr),
    fetchInstagramMetrics(dateStr),
  ]);

  const row = {
    measured_at:       dateStr,
    yt_views:          yt?.yt_views          ?? null,
    yt_unique_viewers: yt?.yt_unique_viewers ?? null,
    yt_search_views:   yt?.yt_search_views   ?? null,
    ig_profile_views:  ig?.ig_profile_views  ?? null,
    ig_reach:          ig?.ig_reach          ?? null,
  };

  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("brand_daily_metrics")
    .upsert(row, { onConflict: "measured_at" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, date: dateStr, ...row });
}
