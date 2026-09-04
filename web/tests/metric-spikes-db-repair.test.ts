import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/ops/repair-metric-spikes-20260903/route.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const appsScript = readFileSync(new URL("../../apps-script/repair_metric_spikes_20260903.gs", import.meta.url), "utf8");

test("9/3 DB repair keeps only read-only inspection for the five historical rows", () => {
  assert.match(route, /const NORMALIZED_KEY = "ig:Dcf5OKEiZvJ"/);
  assert.match(route, /const DIRTY_VALUE = 116853/);
  for (const date of ["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]) {
    assert.match(route, new RegExp(date));
  }
  assert.doesNotMatch(route, /\.update\(/);
  assert.doesNotMatch(route, /\.delete\(\)/);
});

test("DB repair POST is permanently disabled after the verdict reversal", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /checkCronAuth\(req\)/);
  assert.match(route, /one-time repair is permanently disabled/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /Invalid confirmation/);
  assert.match(route, /value == null \|\| value === DIRTY_VALUE/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("DB repair GET exposes read-only final verification", () => {
  assert.match(route, /const SECOND_DIRTY_VALUE = 198660/);
  assert.match(route, /const VERIFIED_DATE = "2026-09-02"/);
  assert.match(route, /globalReachCounts/);
  assert.match(route, /verifiedDateRows/);
  assert.match(route, /\.eq\("reach_count", DIRTY_VALUE\)/);
  assert.match(route, /\.eq\("reach_count", SECOND_DIRTY_VALUE\)/);
  assert.match(route, /\.eq\("measured_at", VERIFIED_DATE\)/);
  assert.doesNotMatch(route, /\.update\(/);
});

test("legacy Apps Script call remains authenticated but cannot mutate through the disabled route", () => {
  assert.match(middleware, /\/api\/ops\/repair-metric-spikes-20260903/);
  assert.match(route, /checkCronAuth\(req\)/);
  const dbApply = appsScript.indexOf("requestMetricSpikeDbRepair20260903_(true)");
  const sheetApply = appsScript.indexOf("repairMetricSpikes20260903(METRIC_SPIKE_REPAIR_20260903_SIGNATURE_, true)");
  assert.ok(dbApply >= 0 && sheetApply > dbApply);
  assert.match(appsScript, /before\.rows\.length !== 5/);
  assert.match(appsScript, /function auditMetricSpikeDb20260903\(\)/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /\.update\(/);
});
