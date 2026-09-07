import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import {
  decideMetaAdsHealthTransition,
  evaluateMetaAdsHealth,
  type MetaAdsHealthState,
} from "@/lib/meta-ads-health";
import { notifyBot } from "@/lib/slack";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_JOB_TYPE = "monitoring";
const STATE_MARKER = "meta_ads_health_state";
const TEST_ALERT_TEXT = "✅ [Meta 광고비 헬스체크] 알림 경로 테스트";

type HealthResult = {
  ok: boolean;
  status: string;
  httpStatus: number;
  oauthCode: number | null;
  itemCount: number | null;
  targetDate?: string;
};

async function readStoredState() {
  const { data, error } = await getServerSupabase()
    .from("jobs")
    .select("id, payload")
    .eq("type", STATE_JOB_TYPE)
    .eq("status", "done")
    .contains("payload", { ops_marker: STATE_MARKER })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("state lookup failed");
  const payload = data?.payload as Record<string, unknown> | null | undefined;
  const state = payload?.health_state;
  const normalizedState: MetaAdsHealthState | null = state === "healthy" || state === "unhealthy"
    ? state
    : null;
  return {
    id: data?.id as string | undefined,
    state: normalizedState,
    lastChangedAt: typeof payload?.last_changed_at === "string" ? payload.last_changed_at : null,
    lastAlertedAt: typeof payload?.last_alerted_at === "string" ? payload.last_alerted_at : null,
  };
}

async function persistState(
  id: string | undefined,
  result: HealthResult,
  state: MetaAdsHealthState,
  changed: boolean,
  previousChangedAt: string | null,
  previousAlertedAt: string | null,
  alerted: boolean,
  checkedAt: string,
) {
  const payload = {
    ops_marker: STATE_MARKER,
    health_state: state,
    detail_status: result.status,
    http_status: result.httpStatus,
    oauth_code: result.oauthCode,
    item_count: result.itemCount,
    target_date: result.targetDate ?? null,
    last_checked_at: checkedAt,
    last_changed_at: changed || !previousChangedAt ? checkedAt : previousChangedAt,
    last_alerted_at: alerted ? checkedAt : previousAlertedAt,
  };
  const mutation = id
    ? getServerSupabase().from("jobs").update({ payload, error: null }).eq("id", id)
    : getServerSupabase().from("jobs").insert({
      type: STATE_JOB_TYPE,
      status: "done",
      payload,
    });
  const { error } = await mutation;
  if (error) throw new Error("state write failed");
}

async function respond(req: NextRequest, result: HealthResult, alertText: string) {
  if (req.method === "GET") {
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  }

  try {
    const previous = await readStoredState();
    const checkedAt = new Date().toISOString();
    const transition = decideMetaAdsHealthTransition(
      previous.state,
      result.ok,
      {
        forceNotify: req.nextUrl.searchParams.get("force") === "1",
        lastAlertedAt: previous.lastAlertedAt,
        nowMs: Date.parse(checkedAt),
      },
    );
    if (transition.shouldNotify) await notifyBot(alertText);
    await persistState(
      previous.id,
      result,
      transition.state,
      transition.changed,
      previous.lastChangedAt,
      previous.lastAlertedAt,
      transition.shouldNotify,
      checkedAt,
    );
    return NextResponse.json({
      ...result,
      alerted: transition.shouldNotify,
      reminderDue: transition.reminderDue,
      stateChanged: transition.changed,
      repeatSuppressed: !result.ok && !transition.shouldNotify,
    }, { status: transition.shouldFailWorkflow ? 503 : 200 });
  } catch {
    return NextResponse.json({
      ...result,
      statePersistenceError: true,
    }, { status: 503 });
  }
}

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

  if (req.method === "POST" && req.nextUrl.searchParams.get("test_alert") === "1") {
    await notifyBot(TEST_ALERT_TEXT);
    return NextResponse.json({
      ok: true,
      status: "test_alert_sent",
      statePersisted: false,
    });
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
    return notify
      ? respond(req, result, "🔴 [Meta 광고비 헬스체크] Vercel production 환경변수가 없습니다.")
      : NextResponse.json(result, { status: 503 });
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
    const result = { ...evaluateMetaAdsHealth(response.status, payload), targetDate };
    const alertText = `🔴 [Meta 광고비 헬스체크] ${result.status} · HTTP ${result.httpStatus}`
      + (result.oauthCode == null ? "" : ` · Meta code ${result.oauthCode}`)
      + "\n전환 광고비 그래프의 시스템 사용자 토큰·광고계정 권한을 확인해 주세요.";
    return notify
      ? respond(req, result, alertText)
      : NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch {
    const result = {
      ok: false,
      status: "network_error",
      httpStatus: 0,
      oauthCode: null,
      itemCount: null,
      targetDate,
    };
    return notify
      ? respond(
        req,
        result,
        "🔴 [Meta 광고비 헬스체크] Meta Graph API 연결 실패\n전환 광고비 그래프의 네트워크 상태를 확인해 주세요.",
      )
      : NextResponse.json(result, { status: 503 });
  }
}

// GET은 읽기 전용 점검, POST는 같은 점검 후 이상일 때만 Slack 알림.
export async function GET(req: NextRequest) { return handler(req, false); }
export async function POST(req: NextRequest) { return handler(req, true); }
