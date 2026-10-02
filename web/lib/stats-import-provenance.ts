export type StatsImportSource = "daily_auto" | "manual_sheet";
export type ImportedMetric = "play_count" | "reach_count";

export type ExistingMetricSnapshot = {
  manual: boolean | null;
  play_count: number | null;
  reach_count: number | null;
};

type ResolveImportedManualFlagArgs = {
  source: StatsImportSource;
  metric: ImportedMetric;
  incomingValue: number;
  existing?: ExistingMetricSnapshot;
};

/**
 * `manual` describes where the value came from, not who started the import.
 * A daily sync may safely preserve an identical automatic DB value, but a new
 * or changed sheet value is sheet-authored and must remain protected as manual.
 */
export function resolveImportedManualFlag({
  source,
  metric,
  incomingValue,
  existing,
}: ResolveImportedManualFlagArgs): boolean {
  if (source === "manual_sheet") return true;
  if (!existing || existing.manual) return true;

  const existingValue = existing[metric];
  if (existingValue == null) return true;
  return Number(existingValue) !== Number(incomingValue);
}
