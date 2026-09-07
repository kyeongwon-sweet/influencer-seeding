import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repair = readFileSync(
  new URL("../../apps-script/repair_posted_at_20260907.gs", import.meta.url),
  "utf8",
);
const runner = readFileSync(
  new URL("../../scripts/repair_posted_at_20260907.mjs", import.meta.url),
  "utf8",
);
const deploy = readFileSync(
  new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url),
  "utf8",
);

test("posted-at repair is scoped to one exact URL-key, account, and date transition", () => {
  assert.match(repair, /key: "ig:DclKlzuJof6"/);
  assert.match(repair, /account: "25\.5_mag"/);
  assert.match(repair, /oldDate: "2026-08-30"/);
  assert.match(repair, /newDate: "2026-08-28"/);
  assert.match(repair, /matches\.length !== 1/);
  assert.match(repair, /assertRowCountStable_/);
});

test("posted-at repair writes only the posted-at cell and verifies adjacent columns", () => {
  assert.match(repair, /getRange\(before\.match\.row, before\.fieldCols\.posted_at\)\.setValue\(corrected\)/);
  assert.match(repair, /if \(col === before\.fieldCols\.posted_at - 1\) continue/);
  assert.match(repair, /인접셀 변경 감지/);
  assert.doesNotMatch(repair, /play_count|reach_count|deleteRow|deleteRows/);
});

test("runner backs up before apply, executes syncAll, and verifies sheet plus DB", () => {
  assert.match(runner, /posted_at_25_5_mag_backup_20260907_/);
  assert.match(runner, /execute\(token, "syncAll"\)/);
  assert.match(runner, /execute\(token, "verifyPostedAt20260907"\)/);
  assert.match(repair, /CONFIG\.LIST_API_URL/);
  assert.match(repair, /db_posted_at: dbPostedAt/);
});

test("guarded clasp deploy includes the one-off repair source", () => {
  assert.match(deploy, /repair_posted_at_20260907\.gs/);
});
