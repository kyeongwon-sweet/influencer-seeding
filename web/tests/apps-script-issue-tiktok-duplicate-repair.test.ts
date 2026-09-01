import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../apps-script/repair_issue_tiktok_duplicate_20260901.gs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url), "utf8");

test("issue TikTok duplicate repair distinguishes the two real creatives", () => {
  assert.match(source, /sharedKey: "tt:7677969398061141255"/);
  assert.match(source, /replacementKey: "tt:7678330001627909394"/);
  assert.match(source, /replacementUrl: "https:\/\/www\.tiktok\.com\/@issuetteugi\/video\/7678330001627909394"/);
  assert.match(source, /canonicalPostedAt: "2026-08-25"/);
  assert.match(source, /canonicalDate: "2026-08-25"/);
  assert.match(source, /canonicalAssetMarker: "지젤\.비주얼"/);
  assert.match(source, /misplacedPostedAt: "2026-08-26"/);
  assert.match(source, /misplacedDate: "2026-08-30"/);
  assert.match(source, /misplacedAssetMarker: "행복지수 10000%"/);
  assert.match(source, /shared\.length !== 2/);
  assert.match(source, /replacements\.length !== 0/);
  assert.match(source, /canonical\.length !== 1 \|\| misplaced\.length !== 1/);
});

test("issue TikTok duplicate repair backs up and changes only the misplaced URL", () => {
  const backup = source.indexOf("issueTiktokDuplicateBackup20260901_(before)");
  const write = source.indexOf("urlRange.setValue(target.replacementUrl)");
  assert.ok(backup >= 0 && write > backup);
  assert.doesNotMatch(source, /deleteRow|deleteRows/);
  assert.doesNotMatch(source, /target\.cumulativeCol\)\.setValue/);
  assert.match(source, /rows_deleted: 0/);
  assert.match(source, /h_formulas_preserved: true/);
  assert.match(source, /metric_values_preserved: true/);
});

test("guarded clasp deployment includes the surgical duplicate repair", () => {
  assert.match(deploy, /repair_issue_tiktok_duplicate_20260901\.gs/);
});

test("issue TikTok duplicate repair verifies the final sheet and DB state read-only", () => {
  assert.match(source, /function verifyIssueTiktokDuplicate20260901\(\)/);
  assert.match(source, /fetchCollectedStats_\(\)\.forEach\(function\(post\)/);
  assert.match(source, /sheet_canonical_0901/);
  assert.match(source, /db_replacement_0830/);
});

test("issue TikTok final 136 fill is backed up and gated by the DB manual value", () => {
  const fn = source.slice(source.indexOf("function fillIssueTiktokCanonical136After20260901"));
  assert.match(fn, /pair\[2\] === true/);
  assert.match(fn, /issueTiktokDuplicateBackup20260901_/);
  assert.match(fn, /finalCell\.setValue\(finalValue\)/);
  assert.doesNotMatch(fn, /deleteRow|deleteRows/);
});
