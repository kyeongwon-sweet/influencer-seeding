export type InstagramMetricResult = {
  ig_profile_views: number | null;
  error: {
    httpStatus: number;
    code: number | null;
    type: string | null;
    message: string;
  } | null;
};

type GraphPayload = {
  data?: Array<{
    name?: unknown;
    total_value?: { value?: unknown };
  }>;
  error?: {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseInstagramInsightResponse(
  httpStatus: number,
  payload: GraphPayload,
): InstagramMetricResult {
  if (httpStatus < 200 || httpStatus >= 300 || payload.error) {
    return {
      ig_profile_views: null,
      error: {
        httpStatus,
        code: numberOrNull(payload.error?.code),
        type: stringOrNull(payload.error?.type),
        message: stringOrNull(payload.error?.message) ?? "Instagram Graph API request failed",
      },
    };
  }
  if (!Array.isArray(payload.data)) {
    return {
      ig_profile_views: null,
      error: {
        httpStatus,
        code: null,
        type: "invalid_response",
        message: "Instagram Graph API response has no data array",
      },
    };
  }
  const item = payload.data.find((entry) => entry.name === "profile_views");
  const metric = numberOrNull(item?.total_value?.value);
  if (metric == null) {
    return {
      ig_profile_views: null,
      error: {
        httpStatus,
        code: null,
        type: "missing_metric",
        message: "Instagram Graph API response has no profile_views value",
      },
    };
  }
  return { ig_profile_views: metric, error: null };
}
