import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repair = readFileSync(
  new URL("../../apps-script/repair_c15_costs_20260915.gs", import.meta.url),
  "utf8",
);
const deploy = readFileSync(
  new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url),
  "utf8",
);

test("C15 Apps Script audit stays exact and formula-safe", () => {
  assert.match(repair, /repair-c15-costs-2026-09-15/);
  assert.match(repair, /expectedCost: 60000/);
  assert.equal((repair.match(/key: "(?:ig|tt):/g) ?? []).length, 4);
  assert.match(repair, /matchCount: found\.length/);
  assert.match(repair, /match\.formula === ""/);
});

test("C15 Apps Script apply entry point is permanently disabled", () => {
  assert.match(repair, /buildFieldCols_\(sheet\)/);
  assert.match(repair, /applyC15Costs20260915\(\)[\s\S]*영구 차단/);
  assert.doesNotMatch(repair, /insertSheet\(|getRangeList\(|\.setValue\(|\.setValues\(/);
  assert.doesNotMatch(repair, /sponsored_posts|post_daily_stats|posted_at|reach_count|play_count/);
  assert.match(repair, /c15CostRepairSnapshot20260915_\(\)/);
  assert.match(deploy, /deprecatedLiveFiles[\s\S]*repair_c15_costs_20260915\.js/);
});
