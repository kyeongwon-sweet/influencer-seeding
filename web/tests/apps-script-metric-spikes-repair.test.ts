import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repair = readFileSync(new URL("../../apps-script/repair_metric_spikes_20260903.gs", import.meta.url), "utf8");
const runner = readFileSync(new URL("../../scripts/repair_metric_spikes_20260903.mjs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url), "utf8");

test("metric spike repair is exact-key, exact-date, and exact-value guarded", () => {
  for (const marker of [
    'ig:DcVKpb3BInV", date: "2026-08-26", dirty: 116853',
    'ig:DcVKpb3BInV", date: "2026-09-01", dirty: 198660',
    'ig:Db5dILHxraF", date: "2026-08-26", dirty: 469130',
    'tt:7670156284628307207", date: "2026-08-26", dirty: 469130',
  ]) assert.match(repair, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(repair, /key: "ig:Dcf5OKEiZvJ"/);
  assert.match(repair, /dirty_counts: Object\.freeze\(\{ "116853": 5, "198660": 1 \}\)/);
  assert.match(repair, /if \(carryTargets\.length !== 6\)/);
  assert.match(repair, /target\.state === "pending" && metricSpikeRepairNumber20260903_\(current\) !== target\.dirty/);
  assert.match(repair, /db_conflicts: snapshot\.targets\.filter/);
  assert.match(repair, /apply === true && dbConflicts\.length/);
  assert.match(repair, /DB에 대상 날짜값이 남아 있어 적용 중단/);
  assert.match(repair, /buildUrlKeyIndex_\(currentUrls, linkKey_\)/);
});

test("metric spike repair writes only target date cells and preserves H/I formulas", () => {
  assert.match(repair, /writeColumnRuns_\(before\.sheet, Number\(col\), byCol\[col\], before\.lastRow\)/);
  assert.doesNotMatch(repair, /getRange\([^\n]*,\s*8\)\.set/);
  assert.doesNotMatch(repair, /getRange\([^\n]*,\s*9\)\.set/);
  assert.match(repair, /oldState\.h_formula !== newState\.h_formula \|\| oldState\.i_formula !== newState\.i_formula/);
  assert.match(repair, /oldState\.untouched_metrics !== newState\.untouched_metrics/);
});

test("runner backs up the dry-run before apply and guarded deploy includes the repair", () => {
  const backupAt = runner.indexOf("fs.writeFileSync(backupPath");
  const applyAt = runner.indexOf("const applied = await execute(token, true)");
  assert.ok(backupAt >= 0 && applyAt > backupAt);
  assert.match(runner, /parameters: \[SIGNATURE, apply\]/);
  assert.match(runner, /const EXPECTED = 10/);
  assert.match(runner, /result\.target_count !== EXPECTED/);
  assert.match(deploy, /repair_metric_spikes_20260903\.gs/);
  assert.match(repair, /function auditMetricSpikes20260903\(\)/);
  assert.match(repair, /function applyMetricSpikes20260903\(\)/);
});
