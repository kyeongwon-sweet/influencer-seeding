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

