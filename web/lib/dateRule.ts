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

/*
 * ⛔ 절대 규칙(2026-10-19 사용자 지시): 업무 날짜를 `toISOString().slice(0, 10)`·`.split("T")[0]` 등으로
 *    직접 만들지 않는다 — 그건 **UTC 날짜**라 KST 00:00~08:59 시각이 하루 이르게 찍힌다(반복 사고).
 *    날짜 문자열은 **이 파일의 헬퍼로만** 만든다. web/tests/kst-date-guard.test.ts 가 이 파일 밖의 사용을 막는다.
 *      · 지금/오늘          → todayKST() · yesterdayKST() · daysAgoKST(n)
 *      · 타임스탬프 → 날짜   → kstDateOf(value)
 *      · 날짜 ± n일          → addDaysToDate(day, n)   (날짜만 다루므로 시간대 무관)
 *      · 원본이 UTC 일 버킷  → utcDateOf(value)        (Trends·시트 일련번호처럼 '그 날짜 자체'가 UTC 자정일 때만)
 */

/** YYYY-MM-DD 이고 달력상 실제 날짜인가(2026-02-30 같은 값은 false). */
export function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 날짜(YYYY-MM-DD)에 n일을 더한다. 시각이 없으므로 시간대와 무관하게 정확하다. */
export function addDaysToDate(day: string, delta: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** KST 오늘로부터 n일 전 날짜. */
export function daysAgoKST(n: number): string {
  return addDaysToDate(todayKST(), -n);
}

/**
 * ⚠️ 의도적 UTC 날짜 — 원본 값이 'UTC 자정에 찍힌 일 단위 버킷'일 때만 쓴다
 * (Google Trends 일 버킷 시각, Google 시트 날짜 일련번호, 이미 +9h 시프트한 Date).
 * 실제 사건 시각(등록·게시·수집 시각)에는 절대 쓰지 말고 kstDateOf 를 쓴다.
 */
export function utcDateOf(value: number | Date): string | null {
  const ms = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
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
