export const STATS_IMPORT_RETRY_CONTRACT_VERSION = 1;

export type StatsImportRetryWarning = {
  field: string;
  count: number;
  urls: string[];
};

export type StatsImportRetryContract = {
  version: number;
  complete: boolean;
  warning_fields: string[];
  retry_urls: string[];
};

/**
 * Build the response metadata that lets Apps Script settle the healthy posts in
 * a stats-import batch while retaining only the posts that need another pass.
 *
 * `complete=false` is deliberate fail-closed metadata.  It is returned when a
 * positive warning count cannot be backed by at least that many identified URL
 * occurrences; the client then retains the entire batch, matching the legacy
 * behaviour instead of guessing which post was affected.
 */
export function buildStatsImportRetryContract(
  warnings: StatsImportRetryWarning[],
): StatsImportRetryContract {
  const warningFields: string[] = [];
  const retryUrls: string[] = [];
  const seenFields = new Set<string>();
  const seenUrls = new Set<string>();
  let complete = true;

  for (const warning of warnings) {
    const count = Number(warning.count);
    if (!Number.isFinite(count) || count <= 0) continue;

    const field = String(warning.field || "");
    if (!field || seenFields.has(field)) {
      complete = false;
    } else {
      seenFields.add(field);
      warningFields.push(field);
    }

    const urls = Array.isArray(warning.urls) ? warning.urls.map((url) => String(url || "")) : [];
    if (urls.length < count || urls.some((url) => !url)) complete = false;
    for (const url of urls) {
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      retryUrls.push(url);
    }
  }

  if (warningFields.length > 0 && retryUrls.length === 0) complete = false;
  return {
    version: STATS_IMPORT_RETRY_CONTRACT_VERSION,
    complete,
    warning_fields: warningFields,
    retry_urls: retryUrls,
  };
}
