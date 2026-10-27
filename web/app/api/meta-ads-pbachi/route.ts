import { yesterdayKST } from "@/lib/dateRule";
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { AWARENESS_ACCOUNT_ID, aggregatePbachi, isPbachiAd, type MetaAdRow } from "@/lib/meta-pbachi";

export const runtime = "nodejs";
export const maxDuration = 60;

// 바치케(P바치) 메타 광고의 그날 지표(광고 관리자 기준, 읽기 전용). 2026-10-27 추가.
// 사용자 기준: 바치케 광고 = 광고명·광고그룹명·캠페인명 중 하나에 'P바치' / 전환 조회수 = 노출수.
// 1단계: 시트(파인트 인지광고 대시보드)와 실측 대조용 — 광고 목적별 합계를 돌려준다. ?debug=1 이면 광고별 내역.
// 토큰은 Vercel production 에만 있다(GitHub 시크릿 없음) → 리포트·점검은 이 라우트를 거친다.
const FIELDS = "campaign_name,adset_name,ad_name,objective,spend,impressions,reach,video_thruplay_watched_actions,actions";

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const date = (req.nextUrl.searchParams.get("date") || yesterdayKST()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식" }, { status: 400 });
  }
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  // account=awareness → 인지 전용 계정(고정 ID). 그 외 값은 받지 않는다(임의 계정 조회 금지).
  const which = req.nextUrl.searchParams.get("account") || "main";
  if (which !== "main" && which !== "awareness") {
    return NextResponse.json({ error: "account는 main|awareness" }, { status: 400 });
  }
  const token = process.env.META_BUSINESS_ACCESS_TOKEN;
  const accountId = which === "awareness"
    ? AWARENESS_ACCOUNT_ID
    : (process.env.META_BUSINESS_ACCOUNT_ID || "").replace(/^act_/, "");
  if (!token || !accountId) {
    return NextResponse.json({ error: "META_BUSINESS_ACCESS_TOKEN/ACCOUNT_ID 미설정" }, { status: 503 });
  }

  const rows: MetaAdRow[] = [];
  let next: string | null = (() => {
    const u = new URL(`https://graph.facebook.com/v18.0/act_${accountId}/insights`);
    u.searchParams.set("level", "ad");
    u.searchParams.set("fields", FIELDS);
    u.searchParams.set("time_range", JSON.stringify({ since: date, until: date }));
    u.searchParams.set("limit", "500");
    return u.toString();
  })();
  try {
    for (let page = 0; next && page < 20; page++) {
      const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json({ date, error: "Meta Graph 오류", httpStatus: res.status, meta: body?.error ?? body }, { status: 502 });
      }
      rows.push(...((body.data ?? []) as MetaAdRow[]));
      next = body.paging?.next ?? null;
    }
  } catch (e) {
    return NextResponse.json({ date, error: `Meta 조회 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const agg = aggregatePbachi(rows);
  // 점검용: 계정 전체를 캠페인 단위로(P바치 표시 여부 포함) — 시트 '전환' 숫자가 무엇의 합인지 맞춰 보기 위함.
  const byCampaign = new Map<string, { campaign: string; objective: string; impressions: number; spend: number; ads: number; pbachiAds: number }>();
  if (debug) {
    for (const r of rows) {
      const k = r.campaign_name || "(이름 없음)";
      const c = byCampaign.get(k) ?? { campaign: k, objective: r.objective || "UNKNOWN", impressions: 0, spend: 0, ads: 0, pbachiAds: 0 };
      c.impressions += Number(r.impressions) || 0;
      c.spend += Math.round(Number(r.spend) || 0);
      c.ads += 1;
      if (isPbachiAd(r)) c.pbachiAds += 1;
      byCampaign.set(k, c);
    }
  }
  return NextResponse.json({
    date,
    account: which,
    accountId,
    ...agg,
    ...(debug
      ? {
          campaigns: Array.from(byCampaign.values()).sort((a, b) => b.impressions - a.impressions),
          ads: rows.filter(isPbachiAd).map((r) => ({
            campaign: r.campaign_name, adset: r.adset_name, ad: r.ad_name, objective: r.objective,
            impressions: r.impressions, spend: r.spend,
            thruplay: (r.video_thruplay_watched_actions ?? []).map((x) => x.value).join(","),
          })),
        }
      : {}),
  });
}
