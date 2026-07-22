/** Banner posts use reach_count as their only view-like metric. */
export function isBannerChannelType(value: unknown): boolean {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, "");
  return normalized.includes("\ubc30\ub108") || normalized.includes("banner");
}
