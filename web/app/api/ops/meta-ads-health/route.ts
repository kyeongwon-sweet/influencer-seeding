import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { evaluateMetaAdsHealth } from "@/lib/meta-ads-health";
import { notifyBot } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function yesterdayKST(): string {
  const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  return new Date(Date.parse(`${kstToday}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function handler(req: NextRequest, notify: boolean) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = process.env.META_BUSINESS_ACCESS_TOKEN;
  const rawAccountId = process.env.META_BUSINESS_ACCOUNT_ID;
  if (!accessToken || !rawAccountId) {
    const result = {
      ok: false,
      status: "missing_configuration",
      httpStatus: 500,
      oauthCode: null,
      itemCount: null,
    };
    if (notify) {
      await notifyBot("🔴 [Meta 광고비 헬스체크] Vercel production 환경변수가 없습니다.").catch(() => {});
    }
    return NextResponse.json(result, { status: 503 });
  }

  const accountId = rawAccountId.replace(/^act_/, "");
  const targetDate = yesterdayKST();
  const url = new URL(`https://graph.facebook.com/v18.0/act_${accountId}/insights`);
  url.searchParams.set("fields", "spend,date_start");
  url.searchParams.set("time_range", JSON.stringify({ since: targetDate, until: targetDate }));
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const result = evaluateMetaAdsHealth(response.status, payload);
    if (!result.ok && notify) {
      await notifyBot(
        `🔴 [Meta 광고비 헬스체크] ${result.status} · HTTP ${result.httpStatus}`
        + (result.oauthCode == null ? "" : ` · Meta code ${result.oauthCode}`)
        + "\n전환 광고비 그래프의 시스템 사용자 토큰·광고계정 권한을 확인해 주세요.",
      ).catch(() => {});
    }
    return NextResponse.json({ ...result, targetDate }, { status: result.ok ? 200 : 503 });
  } catch {
    if (notify) {
      await notifyBot(
        "🔴 [Meta 광고비 헬스체크] Meta Graph API 연결 실패\n전환 광고비 그래프의 네트워크 상태를 확인해 주세요.",
      ).catch(() => {});
    }
    return NextResponse.json({
      ok: false,
      status: "network_error",
      httpStatus: 0,
      oauthCode: null,
      itemCount: null,
      targetDate,
    }, { status: 503 });
  }
}

// GET은 읽기 전용 점검, POST는 같은 점검 후 이상일 때만 Slack 알림.
export async function GET(req: NextRequest) { return handler(req, false); }
export async function POST(req: NextRequest) { return handler(req, true); }
