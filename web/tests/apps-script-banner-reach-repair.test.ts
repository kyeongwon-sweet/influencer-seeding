import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../apps-script/repair_banner_reach_20260901.gs", import.meta.url),
  "utf8",
);
const deploy = readFileSync(
  new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url),
  "utf8",
);

test("banner reach repair is scoped to one URL key, date, and canonical value", () => {
  assert.match(source, /key: "ig:Dbx04ORkiHK"/);
  assert.match(source, /date: "2026-08-30"/);
  assert.match(source, /value: 31186/);
  assert.match(source, /rows\.length !== 1/);
  assert.match(source, /metricDateColumns_\(sheet\)/);
  assert.match(source, /allowed = \[null, 29133, 35289, target\.value\]/);
  assert.match(source, /before\.otherAboveCanonicalCells !== 0/);
});

test("banner reach repair backs up before writing and never writes H", () => {
  const backup = source.indexOf("bannerReachRepairBackup20260901_(before)");
  const write = source.indexOf("getRange(before.metricA1).setValue(target.value)");
  assert.ok(backup >= 0 && write > backup);
  assert.match(source, /after\.cumulativeFormula !== before\.cumulativeFormula/);
  assert.match(source, /Number\(after\.cumulativeValue\) !== target\.value/);
  assert.doesNotMatch(source, /getRange\(before\.cumulativeA1\)\.setValue/);
});

test("guarded clasp deployment includes the one-cell repair", () => {
  assert.match(deploy, /repair_banner_reach_20260901\.gs/);
});
