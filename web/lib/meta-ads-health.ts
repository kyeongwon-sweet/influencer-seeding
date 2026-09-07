export type MetaAdsHealthStatus =
  | "healthy"
  | "oauth_error"
  | "permission_error"
  | "meta_error"
  | "invalid_response";

export type MetaAdsHealth = {
  ok: boolean;
  status: MetaAdsHealthStatus;
  httpStatus: number;
  oauthCode: number | null;
  itemCount: number | null;
};

export type MetaAdsHealthState = "healthy" | "unhealthy";

export type MetaAdsHealthTransition = {
  state: MetaAdsHealthState;
  changed: boolean;
  reminderDue: boolean;
  shouldNotify: boolean;
  shouldFailWorkflow: boolean;
};

export const META_ADS_UNHEALTHY_REMINDER_DAYS = 7;

type MetaAdsHealthTransitionOptions = {
  forceNotify?: boolean;
  lastAlertedAt?: string | null;
  nowMs?: number;
  reminderDays?: number;
};

type MetaPayload = {
  data?: unknown;
  error?: {
    code?: unknown;
  };
};

function numericCode(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function evaluateMetaAdsHealth(httpStatus: number, payload: MetaPayload): MetaAdsHealth {
  const oauthCode = numericCode(payload.error?.code);
  if (httpStatus < 200 || httpStatus >= 300) {
    const status: MetaAdsHealthStatus = oauthCode === 190
      ? "oauth_error"
      : httpStatus === 401 || httpStatus === 403
        ? "permission_error"
        : "meta_error";
    return { ok: false, status, httpStatus, oauthCode, itemCount: null };
  }

  if (!Array.isArray(payload.data)) {
    return {
      ok: false,
      status: "invalid_response",
      httpStatus,
      oauthCode,
      itemCount: null,
    };
  }

  return {
    ok: true,
    status: "healthy",
    httpStatus,
    oauthCode: null,
    itemCount: payload.data.length,
  };
}

export function decideMetaAdsHealthTransition(
  previousState: MetaAdsHealthState | null,
  currentOk: boolean,
  options: MetaAdsHealthTransitionOptions = {},
): MetaAdsHealthTransition {
  const state: MetaAdsHealthState = currentOk ? "healthy" : "unhealthy";
  const changed = previousState !== state;
  const forceNotify = options.forceNotify ?? false;
  const nowMs = options.nowMs ?? Date.now();
  const reminderDays = options.reminderDays ?? META_ADS_UNHEALTHY_REMINDER_DAYS;
  const lastAlertedMs = Date.parse(options.lastAlertedAt ?? "");
  const reminderDue = !currentOk
    && !changed
    && !forceNotify
    && (!Number.isFinite(lastAlertedMs)
      || nowMs - lastAlertedMs >= reminderDays * 86_400_000);
  const transitionAlert = !currentOk && changed;
  const forcedAlert = !currentOk && forceNotify;
  const shouldNotify = transitionAlert || forcedAlert || reminderDue;
  return {
    state,
    changed,
    reminderDue,
    shouldNotify,
    // 주기 재알림은 Slack만 보내고 GHA는 녹색으로 유지해 cron_watchdog 중복을 막는다.
    shouldFailWorkflow: transitionAlert || forcedAlert,
  };
}
