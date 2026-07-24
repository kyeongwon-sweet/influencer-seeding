import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appsScript = readFileSync(
  new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url),
  "utf8",
);

test("Apps Script mirror keeps live metadata and URL guards", () => {
  assert.match(appsScript, /"기획자":\s*"planner"/);
  assert.match(appsScript, /"제작자":\s*"creator"/);
  assert.match(appsScript, /obj\.planner\s*=/);
  assert.match(appsScript, /obj\.creator\s*=/);
  assert.ok(appsScript.includes("if (/instagram\\.com/i.test(rawUrl)"));
  assert.ok(appsScript.includes("!/\\/(p|reels|reel|tv)\\/"));
  assert.match(
    appsScript,
    /setFormulas\(incFormulas\);\s*try \{ refreshCumulativeViews\(\);/s,
  );
});

test("syncPricing inserts blank-only XLOOKUP formulas and preserves existing cells", () => {
  assert.match(appsScript, /function syncPricing\(\)/);
  assert.match(appsScript, /company === "" \|\| company == null/);
  assert.match(appsScript, /cost === "" \|\| cost == null/);
  assert.match(appsScript, /type === "위성채널" \|\| type === "온드미디어"/);
  assert.match(appsScript, /fieldCols\.company_name\)\.clearContent\(\)/);
  assert.match(appsScript, /fieldCols\.cost\)\.setValue\(0\)/);
  assert.match(appsScript, /setFormula\(\s*'=IFERROR\(XLOOKUP\('/s);
  assert.match(appsScript, /!\$B\$2:\$B/);
  assert.match(appsScript, /!\$D\$2:\$D/);
});

test("daily trigger installs and removes the 23:00 syncNew trigger", () => {
  assert.match(
    appsScript,
    /newTrigger\("syncNew"\)[\s\S]*?\.atHour\(23\)[\s\S]*?\.everyDays\(1\)/,
  );
  assert.match(
    appsScript,
    /function removeDailyTrigger\(\)[\s\S]*?getHandlerFunction\(\) === "syncNew"/,
  );
});
