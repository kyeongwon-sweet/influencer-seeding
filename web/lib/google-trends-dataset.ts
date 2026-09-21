export type GoogleTrendRow = {
  measured_at: string;
  keyword: string;
  value: number | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateFromUnixSeconds(value: unknown): string | null {
  const seconds = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** SignalBench의 현재 형식과 기존 Apify 형식을 같은 DB 행으로 정규화한다. */
export function parseGoogleTrendDataset(items: unknown[]): GoogleTrendRow[] {
  const rows: GoogleTrendRow[] = [];

  for (const rawItem of items) {
    if (!isRecord(rawItem)) continue;
    const keyword = typeof rawItem.searchTerm === "string" ? rawItem.searchTerm.trim() : "";
    if (!keyword) continue;

    const timeline = Array.isArray(rawItem.interestOverTime) ? rawItem.interestOverTime : [];
    if (timeline.length > 0) {
      for (const rawPoint of timeline) {
        if (!isRecord(rawPoint)) continue;
        const measuredAt = dateFromUnixSeconds(rawPoint.timestamp);
        if (!measuredAt) continue;
        rows.push({ measured_at: measuredAt, keyword, value: numericValue(rawPoint.value) });
      }
      continue;
    }

    // 이미 시작된 구형 액터 run의 webhook이 늦게 도착해도 저장할 수 있게 호환한다.
    const legacyTimeline = Array.isArray(rawItem.interestOverTime_timelineData)
      ? rawItem.interestOverTime_timelineData
      : [];
    for (const rawPoint of legacyTimeline) {
      if (!isRecord(rawPoint)) continue;
      const measuredAt = dateFromUnixSeconds(rawPoint.time);
      if (!measuredAt) continue;
      const values = Array.isArray(rawPoint.value) ? rawPoint.value : [];
      rows.push({ measured_at: measuredAt, keyword, value: numericValue(values[0]) });
    }
  }

  return rows;
}
