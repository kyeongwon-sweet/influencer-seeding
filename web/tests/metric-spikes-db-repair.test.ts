import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/ops/repair-metric-spikes-20260903/route.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const appsScript = readFileSync(new URL("../../apps-script/repair_metric_spikes_20260903.gs", import.meta.url), "utf8");

test("9/3 DB repair targets only the five confirmed metric rows", () => {
  assert.match(route, /const NORMALIZED_KEY = "ig:Dcf5OKEiZvJ"/);
  assert.match(route, /const DIRTY_VALUE = 116853/);
  for (const date of ["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]) {
    assert.match(route, new RegExp(date));
  }
  assert.match(route, /update\(\{ reach_count: null, play_count: null \}\)/);
  assert.doesNotMatch(route, /\.delete\(\)/);
});

test("DB repair preserves the manual lock and fails closed on drift", () => {
  assert.match(route, /row\.manual !== true/);
  assert.match(route, /value == null \|\| value === DIRTY_VALUE/);
  assert.match(route, /row\.reachCount == null/);
  assert.match(route, /row\.playCount == null/);
  assert.match(route, /updateQuery\.eq\("reach_count", DIRTY_VALUE\)/);
  assert.match(route, /updateQuery\.eq\("play_count", DIRTY_VALUE\)/);
  assert.match(route, /\.eq\("manual", true\)/);
  assert.match(route, /Unexpected live rows or missing manual lock/);
  assert.match(route, /Post-repair verification failed/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("Apps Script coordinates DB cleanup before the ten-cell sheet repair", () => {
  assert.match(middleware, /\/api\/ops\/repair-metric-spikes-20260903/);
  assert.match(route, /checkCronAuth\(req\)/);
  const dbApply = appsScript.indexOf("requestMetricSpikeDbRepair20260903_(true)");
  const sheetApply = appsScript.indexOf("repairMetricSpikes20260903(METRIC_SPIKE_REPAIR_20260903_SIGNATURE_, true)");
  assert.ok(dbApply >= 0 && sheetApply > dbApply);
  assert.match(appsScript, /before\.rows\.length !== 5/);
  assert.match(appsScript, /function auditMetricSpikeDb20260903\(\)/);
});
