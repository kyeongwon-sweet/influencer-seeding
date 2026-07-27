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
  assert.match(appsScript, /const norm_ = \(s\) => 'REGEXREPLACE\(REGEXREPLACE\(LOWER\('/);
  assert.match(appsScript, /ARRAYFORMULA\('/);
  assert.match(appsScript, /setFormula\(\s*'=IFERROR\(XLOOKUP\('/s);
  assert.match(appsScript, /!\$B\$2:\$B/);
  assert.match(appsScript, /!\$D\$2:\$D/);
});

test("overwriteViralHandles_ only touches viral account_name and self-heals daily via dailyAuto", () => {
  const start = appsScript.indexOf("function overwriteViralHandles_()");
  assert.notEqual(start, -1, "overwriteViralHandles_ 함수가 있어야 함");
  const end = appsScript.indexOf("function overwriteViralHandles()", start);
  const body = appsScript.slice(start, end);
  // 바이럴 행만 처리
  assert.match(body, /indexOf\("바이럴"\) < 0\) continue/);
  // DB 빈값이면 덮어쓰기 금지(빈칸으로 안 지움)
  assert.match(body, /if \(!dbName\) continue/);
  // 동일하면 no-op
  assert.match(body, /if \(cur === dbName\) continue/);
  // 채널명(account_name) 열만 되쓰기
  assert.match(body, /setValues\(accs\)/);
  // dailyAuto가 매일 실행(재발 차단)
  assert.match(appsScript, /\["overwriteViralHandles", overwriteViralHandles_\]/);
});

test("dailyAuto imports sheet stats before exporting DB stats back to the sheet", () => {
  const dailyStart = appsScript.indexOf("function dailyAuto()");
  const importIdx = appsScript.indexOf("const importOk = importStats();", dailyStart);
  const exportIdx = appsScript.indexOf("const exportOk = exportStats();", dailyStart);
  assert.notEqual(dailyStart, -1);
  assert.notEqual(importIdx, -1);
  assert.notEqual(exportIdx, -1);
  assert.ok(importIdx < exportIdx);
});

test("syncCreators only fills blanks and preserves manual planner/creator values", () => {
  const start = appsScript.indexOf("function syncCreators()");
  const end = appsScript.indexOf("function getPricingSheet_()", start);
  const body = appsScript.slice(start, end);
  assert.match(body, /const key = linkKey_\(String\(currentUrls\[i\]\[0\]/);
  assert.match(body, /\(planners\[i\]\[0\] === "" \|\| planners\[i\]\[0\] == null\) && plannerByKey\[key\]/);
  assert.match(body, /\(makers\[i\]\[0\] === "" \|\| makers\[i\]\[0\] == null\) && makerByKey\[key\]/);
});

test("daily trigger installs and removes the 00:00 syncNew trigger", () => {
  assert.match(
    appsScript,
    /newTrigger\("syncNew"\)[\s\S]*?\.atHour\(0\)[\s\S]*?\.everyDays\(1\)/,
  );
  assert.match(
    appsScript,
    /function removeDailyTrigger\(\)[\s\S]*?getHandlerFunction\(\) === "syncNew"/,
  );
});
