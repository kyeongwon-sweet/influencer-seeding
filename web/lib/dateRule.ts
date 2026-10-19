export const MIN_ENTRY_DATE = "2020-01-01";

/** Today in KST, formatted as YYYY-MM-DD. */
export function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Yesterday in KST, formatted as YYYY-MM-DD. Used for after-midnight performance snapshots. */
export function yesterdayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 타임스탬프를 KST 날짜(YYYY-MM-DD)로. `toISOString().slice(0, 10)`은 UTC 날짜라
 * KST 00:00~08:59 시각이 하루 이른 날짜가 된다(2026-10-19 게시일·등록일 하루 밀림 사고 계열).
 * - 날짜만 있는 문자열은 그대로, 오프셋 없는 ISO 일시는 UTC로 본다(DB·Apify 관례).
 * - 숫자는 유닉스 시각(초, 1e12 이상이면 밀리초). 해석 불가면 null.
 */
export function kstDateOf(value: unknown): string | null {
  if (value == null || value === "") return null;
  let ms: number;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "number") {
    ms = value > 1e12 ? value : value * 1000;
  } else {
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const naiveIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
    ms = Date.parse(naiveIso ? `${s.replace(" ", "T")}Z` : s);
  }
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Max date for manual date inputs. */
export function maxDateKST(): string {
  return todayKST();
}

/** Valid manual entry date: YYYY-MM-DD from 2020-01-01 through today in KST. */
export function isValidEntryDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= MIN_ENTRY_DATE && s <= maxDateKST();
}

export type MonitoringCollectionContext = "scheduled" | "manual";

/** Resolve the snapshot label at kickoff, never from webhook arrival time. */
export function resolveMonitoringMeasuredAt(
  requestedDate: string | null | undefined,
  context: MonitoringCollectionContext,
): string {
  const measuredAt = requestedDate?.trim()
    || (context === "scheduled" ? yesterdayKST() : todayKST());
  if (!isValidEntryDate(measuredAt)) {
    throw new Error(`invalid measured_at: ${measuredAt}`);
  }
  return measuredAt;
}

/** Monitoring webhooks that write stats must carry the kickoff date explicitly. */
export function requireMonitoringWebhookDate(
  requestedDate: string | null | undefined,
  metadataOnly: boolean,
): string {
  if (!requestedDate?.trim()) {
    if (metadataOnly) return todayKST();
    throw new Error("monitoring webhook missing measuredAt");
  }
  return resolveMonitoringMeasuredAt(requestedDate, "manual");
}
