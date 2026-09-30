import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { notifyJob } from "@/lib/slack";
import { parseInstagramInsightResponse, type InstagramMetricResult } from "@/lib/brand-metrics-instagram";

export const maxDuration = 60; // 백필(?days=N) 시 여러 날 순차 수집 여유

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
  // 유효 YouTube Analytics metric만 사용(기존 "uniqeViewers" 오타 + 무효 "search"는 요청 자체를 실패시켰음).
  // ※ 이 OAuth 경로는 현재 死경로(yt_views/yt_unique_viewers 전 기간 미적재) — 토큰 미설정 시 위에서 null 반환.
  //   브랜드 그래프의 '유튜브 검색량'은 Google Trends(youtube_search_trends)로 별도 동작.
  url.searchParams.set("metrics",   "views,uniqueViewers");
  url.searchParams.set("dimensions","day");

  const analyticsRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!analyticsRes.ok) return null;

  const json = await analyticsRes.json();
  const row = json.rows?.[0]; // [day, views, uniqueViewers]
  if (!row) return null;

  return {
    yt_views: row[1] as number,
    yt_unique_viewers: row[2] as number,
    yt_search_views: null // 死필드(별도 Google Trends 사용) — Analytics에서 조회 안 함
  };
}

// ── Instagram Graph API ────────────────────────────────────────────────────
async function fetchInstagramMetrics(dateStr: string): Promise<InstagramMetricResult> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId      = process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !userId) {
    return {
      ig_profile_views: null,
      error: {
        httpStatus: 500,
        code: null,
        type: "missing_configuration",
        message: "INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID is missing",
      },
    };
  }

  // since/until은 Unix timestamp (period=day 기준 하루)
  const since = Math.floor(new Date(dateStr + "T00:00:00+09:00").getTime() / 1000);
  const until = since + 86400;

  // Facebook 로그인 경로(graph.facebook.com)로 인사이트 조회.
  // INSTAGRAM_USER_ID = Facebook 페이지에 연결된 IG 비즈니스 계정 ID,
  // INSTAGRAM_ACCESS_TOKEN = 해당 권한(instagram_manage_insights 등)을 가진 장기 토큰.
  // profile_views(프로필 방문) 조회. metric_type=total_value 필수.
  // ※ profile_views는 폐기가 아니라 total_value 형식 요구로 변경된 것 (Business Suite '프로필 방문'과 동일).
  const url = new URL(`https://graph.facebook.com/v23.0/${userId}/insights`);
  url.searchParams.set("metric",       "profile_views");
  url.searchParams.set("metric_type",  "total_value");
  url.searchParams.set("period",       "day");
  url.searchParams.set("since",        String(since));
  url.searchParams.set("until",        String(until));
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await res.json().catch(() => ({}));
    return parseInstagramInsightResponse(res.status, payload);
  } catch {
    return {
      ig_profile_views: null,
      error: {
        httpStatus: 0,
        code: null,
        type: "network_error",
        message: "Instagram Graph API network error",
      },
    };
  }
}

// ── Handler ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Vercel Cron 또는 GitHub Actions에서 호출 — CRON_SECRET으로 인증
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?days=N → 최근 N일 백필 (기본 1 = 어제만 / 크론 동작 유지, 최대 30)
  const daysParam = Number(new URL(req.url).searchParams.get("days") ?? "1");
  const days = Math.min(30, Math.max(1, Number.isFinite(daysParam) ? daysParam : 1));

  const rows: Record<string, unknown>[] = [];
  const instagramFailures: Array<{
    measured_at: string;
    httpStatus: number;
    code: number | null;
    type: string | null;
    message: string;
  }> = [];
  for (let back = 1; back <= days; back++) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    kst.setDate(kst.getDate() - back);
    const dateStr = kst.toISOString().slice(0, 10);
    const [yt, ig] = await Promise.all([
      fetchYouTubeMetrics(dateStr),
      fetchInstagramMetrics(dateStr),
    ]);
    rows.push({
      measured_at:       dateStr,
      yt_views:          yt?.yt_views          ?? null,
      yt_unique_viewers: yt?.yt_unique_viewers ?? null,
      yt_search_views:   yt?.yt_search_views   ?? null,
      ig_profile_views:  ig.ig_profile_views,
    });
    if (ig.error) instagramFailures.push({ measured_at: dateStr, ...ig.error });
  }

  const allInstagramNull = rows.every((row) => row.ig_profile_views == null);
  if (allInstagramNull) {
    const first = instagramFailures[0];
    const detail = first
      ? `HTTP ${first.httpStatus}${first.code == null ? "" : ` / Meta ${first.code}`} · ${first.message}`
      : "profile_views가 모든 날짜에서 null";
    await notifyJob("브랜드 지표", "fail", `인스타 프로필 방문 전부 미수집: ${detail}`);
    return NextResponse.json({
      ok: false,
      collected: 0,
      attempted: rows.length,
      instagram: { allNull: true, failures: instagramFailures },
    }, { status: 502 });
  }

  // 오류 날짜의 null을 기존 실측 위에 덮지 않는다. PostgREST의 defaultToNull=false와
  // 함께 실제로 측정된 필드만 갱신한다(0은 유효 실측이라 보존).
  const writeRows = rows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key, value]) => key === "measured_at" || value != null),
  ));
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("brand_daily_metrics")
    .upsert(writeRows, { onConflict: "measured_at", defaultToNull: false });

  if (error) {
    await notifyJob("브랜드 지표", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (instagramFailures.length > 0) {
    const first = instagramFailures[0];
    await notifyJob(
      "브랜드 지표",
      "fail",
      `인스타 일부 미수집 ${instagramFailures.length}/${rows.length}: HTTP ${first.httpStatus}`
      + `${first.code == null ? "" : ` / Meta ${first.code}`} · ${first.message}`,
    );
    return NextResponse.json({
      ok: false,
      partial: true,
      collected: rows.length - instagramFailures.length,
      attempted: rows.length,
      instagram: { allNull: false, failures: instagramFailures },
      rows,
    }, { status: 502 });
  }
  await notifyJob("브랜드 지표", "ok", `${rows.length}일 수집 (인스타/유튜브)`);
  return NextResponse.json({ ok: true, collected: rows.length, rows, instagram: { allNull: false, failures: [] } });
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 미사용, ?days= 쿼리만 사용)
export const GET = POST;
