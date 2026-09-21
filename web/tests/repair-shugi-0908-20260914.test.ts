import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repair = readFileSync(
  new URL("../../apps-script/repair_shugi_0908_20260914.gs", import.meta.url),
  "utf8",
);
const runner = readFileSync(
  new URL("../../scripts/repair_shugi_0908_20260914.mjs", import.meta.url),
  "utf8",
);
const deploy = readFileSync(
  new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url),
  "utf8",
);

test("Shugi repair is scoped to one URL key, account, date, and exact value transition", () => {
  assert.match(repair, /key: "ig:DdBU6JmhltN"/);
  assert.match(repair, /account: "슈기"/);
  assert.match(repair, /date: "2026-09-08"/);
  assert.match(repair, /oldValue: 463731/);
  assert.match(repair, /newValue: 413000/);
  assert.match(repair, /matches\.length !== 1/);
  assert.match(repair, /assertRowCountStable_/);
  assert.match(repair, /dateA1: colLetter_\(dateCol\) \+ row/);
});

test("Shugi repair writes only the exact date cell and preserves formulas plus adjacent dates", () => {
  assert.match(repair, /getRange\(before\.match\.row, before\.dateCol\)\.setValue\(target\.newValue\)/);
  assert.match(repair, /H\/I 수식 변경 감지/);
  assert.match(repair, /인접 날짜셀 변경 감지/);
  assert.doesNotMatch(repair, /deleteRow|deleteRows|clearContent|syncAll\(/);
});

test("runner requires dry-run, backs up, applies, and independently re-reads", () => {
  assert.match(runner, /const before = await execute\(token, \[SIGNATURE, false\]\)/);
  assert.match(runner, /shugi_0908_sheet_backup_20260914_/);
  assert.match(runner, /const applied = await execute\(token, \[SIGNATURE, true\]\)/);
  assert.match(runner, /const verified = await execute\(token, \[SIGNATURE, false\]\)/);
  assert.match(runner, /verified\.cumulativeFormula !== before\.cumulativeFormula/);
});

test("guarded clasp cleanup retires the completed one-off Shugi repair source", () => {
  assert.match(deploy, /deprecatedLiveFiles[\s\S]*repair_shugi_0908_20260914\.js/);
});
