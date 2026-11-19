import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStatsImportRetryContract,
  STATS_IMPORT_RETRY_CONTRACT_VERSION,
} from "../lib/stats-import-retry.ts";

const WARNING_FIELDS = [
  "copy_suspected_warned", "copy_suspected_skipped",
  "spike_suspected_warned", "spike_suspected_skipped",
  "dup_column_skipped", "missing_urls", "non_video_play_rejected",
  "rejected_invalid_url", "future_date_skipped",
];

test("stats-import retry contract identifies every warning class by URL", () => {
  for (const field of WARNING_FIELDS) {
    const contract = buildStatsImportRetryContract([
      { field, count: 1, urls: [`https://example.test/${field}`] },
    ]);
    assert.deepEqual(contract, {
      version: STATS_IMPORT_RETRY_CONTRACT_VERSION,
      complete: true,
      warning_fields: [field],
      retry_urls: [`https://example.test/${field}`],
    });
  }
});

test("stats-import retry contract deduplicates URLs without losing warning fields", () => {
  const contract = buildStatsImportRetryContract([
    { field: "copy_suspected_warned", count: 2, urls: ["https://example.test/a", "https://example.test/a"] },
    { field: "copy_suspected_skipped", count: 1, urls: ["https://example.test/a", "https://example.test/a"] },
  ]);
  assert.equal(contract.complete, true);
  assert.deepEqual(contract.warning_fields, ["copy_suspected_warned", "copy_suspected_skipped"]);
  assert.deepEqual(contract.retry_urls, ["https://example.test/a"]);
});

test("stats-import retry contract marks global or partially identified warnings incomplete", () => {
  for (const warnings of [
    [{ field: "missing_urls", count: 1, urls: [] }],
    [{ field: "future_date_skipped", count: 2, urls: ["https://example.test/a"] }],
    [{ field: "rejected_invalid_url", count: 1, urls: [""] }],
    [
      { field: "missing_urls", count: 1, urls: ["https://example.test/a"] },
      { field: "missing_urls", count: 1, urls: ["https://example.test/b"] },
    ],
  ]) {
    assert.equal(buildStatsImportRetryContract(warnings).complete, false);
  }
});

test("stats-import retry contract has a complete empty shape when no warning is positive", () => {
  assert.deepEqual(buildStatsImportRetryContract([
    { field: "missing_urls", count: 0, urls: [] },
  ]), {
    version: STATS_IMPORT_RETRY_CONTRACT_VERSION,
    complete: true,
    warning_fields: [],
    retry_urls: [],
  });
});
