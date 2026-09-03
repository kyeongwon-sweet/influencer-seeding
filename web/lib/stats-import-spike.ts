export type AutomaticPlayMeasurement = {
  post_id: string;
  measured_at: string;
  play_count: number | null;
  manual: boolean | null;
};

export type PreviousAutomaticPlay = {
  measured_at: string;
  play_count: number;
};

type ImportMetricRow = {
  post_id: string;
  measured_at: string;
};

export type ExplicitMediaMetadata = {
  type?: unknown;
  mediaType?: unknown;
  media_type?: unknown;
};

export function isExplicitNonVideoMedia(row: ExplicitMediaMetadata): boolean {
  const mediaType = String(row.mediaType ?? row.media_type ?? row.type ?? "").trim().toLowerCase();
  // GraphSidecar is intentionally excluded: the collector treats slide reels as playable media.
  return mediaType === "image"
    || mediaType === "graphimage"
    || mediaType === "sidecar"
    || mediaType === "carousel_album";
}

export function quarantineAutomaticSuspects<T extends ImportMetricRow>(
  rows: T[],
  suspectKeys: ReadonlySet<string>,
  metric: "play_count" | "reach_count",
  isManualImport: boolean,
): { kept: T[]; quarantined: T[] } {
  if (isManualImport || suspectKeys.size === 0) return { kept: rows, quarantined: [] };

  const kept: T[] = [];
  const quarantined: T[] = [];
  for (const row of rows) {
    const date = String(row.measured_at).slice(0, 10);
    const key = `${metric}|${row.post_id}|${date}`;
    (suspectKeys.has(key) ? quarantined : kept).push(row);
  }
  return { kept, quarantined };
}

export function buildAutomaticPlayHistory(rows: AutomaticPlayMeasurement[]) {
  const history = new Map<string, PreviousAutomaticPlay[]>();
  for (const row of rows) {
    const playCount = Number(row.play_count);
    if (row.manual || !Number.isFinite(playCount) || playCount <= 0) continue;
    const measuredAt = String(row.measured_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt)) continue;
    const list = history.get(row.post_id) ?? [];
    list.push({ measured_at: measuredAt, play_count: playCount });
    history.set(row.post_id, list);
  }
  for (const list of history.values()) {
    list.sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  }
  return history;
}

export function previousAutomaticPlay(
  history: Map<string, PreviousAutomaticPlay[]>,
  postId: string,
  beforeDate: string,
): PreviousAutomaticPlay | null {
  const rows = history.get(postId) ?? [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].measured_at < beforeDate) return rows[i];
  }
  return null;
}
