import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runMonitoring = readFileSync(new URL("../../scripts/run_monitoring.py", import.meta.url), "utf8");
const apifyWebhook = readFileSync(new URL("../app/api/apify-webhook/route.ts", import.meta.url), "utf8");
const collectNow = readFileSync(new URL("../app/api/monitoring/collect-now/route.ts", import.meta.url), "utf8");

test("run_monitoring preserves same-date manual stat rows before auto upsert", () => {
  assert.match(runMonitoring, /def _filter_manual_preserved_rows/);
  assert.match(runMonitoring, /\.eq\("manual", True\)/);
  assert.match(runMonitoring, /rows = _preserve_same_date_manual_stats\(db, rows, "run_monitoring"\)/);
  assert.match(runMonitoring, /reach_rows = _preserve_same_date_manual_stats\(db, reach_rows, "banner reach snapshot"\)/);
});

test("apify webhook skips same-date manual rows before post_daily_stats upsert", () => {
  assert.match(apifyWebhook, /const sameDateManual = new Set<string>\(\)/);
  assert.match(apifyWebhook, /s\.manual && String\(s\.measured_at\)\.slice\(0, 10\) === today/);
  assert.match(apifyWebhook, /const rowsToUpsert = rows\.filter/);
  assert.match(apifyWebhook, /\.upsert\(rowsToUpsert, \{ onConflict: 'post_id,measured_at' \}\)/);
  assert.match(apifyWebhook, /manual_preserved: manualPreserved/);
});

test("collect-now skips same-date manual rows before post_daily_stats upsert", () => {
  assert.match(collectNow, /const sameDateManual = new Set<string>\(\)/);
  assert.match(collectNow, /\.eq\("measured_at", measuredAt\)/);
  assert.match(collectNow, /\.eq\("manual", true\)/);
  assert.match(collectNow, /const statsToUpsert = statsToInsert\.filter/);
  assert.match(collectNow, /\.upsert\(statsToUpsert, \{/);
  assert.match(collectNow, /manual_preserved: manualPreserved/);
});
