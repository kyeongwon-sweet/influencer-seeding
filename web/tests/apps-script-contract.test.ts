import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appsScript = readFileSync(
  new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url),
  "utf8",
);
const writeGuard = readFileSync(
  new URL("../../_WriteGuard.gs", import.meta.url),
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
  const start = appsScript.indexOf("function syncPricing()");
  const end = appsScript.indexOf("function installDailyTrigger()", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /company === "" \|\| company == null/);
  assert.match(body, /cost === "" \|\| cost == null/);
  assert.match(body, /!companyFormulas\[r\]\[0\]/);
  assert.match(body, /!costFormulas\[r\]\[0\]/);
  assert.match(body, /type === "위성채널" \|\| type === "온드미디어"/);
  assert.match(body, /companyEdits\.push\(\{ row: rowNum, value: "" \}\)/);
  assert.match(body, /costEdits\.push\(\{ row: rowNum, value: 0 \}\)/);
  assert.match(body, /const norm_ = \(s\) => 'REGEXREPLACE\(REGEXREPLACE\(LOWER\('/);
  assert.match(body, /ARRAYFORMULA\('/);
  assert.match(body, /value: '=IFERROR\(XLOOKUP\('/);
  assert.match(body, /!\$B\$2:\$B/);
  assert.match(body, /!\$D\$2:\$D/);
  assert.match(body, /assertRowCountStable_\(sheet, lastRow, "syncPricing"\)/);
  assert.match(body, /writeColumnRuns_\(sheet, fieldCols\.company_name, companyEdits, lastRow\)/);
  assert.match(body, /writeColumnRuns_\(sheet, fieldCols\.cost, costEdits, lastRow\)/);
  assert.doesNotMatch(body, /getRange\(rowNum,[\s\S]*?\.(?:setValue|setFormula|clearContent)\(/);
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

test("dailyAuto records every stage and imports stats before exporting DB stats", () => {
  const defsStart = appsScript.indexOf("function dailyAutoStageDefs_()");
  const importIdx = appsScript.indexOf('["importStats", importStats]', defsStart);
  const exportIdx = appsScript.indexOf('["exportStats", exportStats]', defsStart);
  assert.notEqual(defsStart, -1);
  assert.notEqual(importIdx, -1);
  assert.notEqual(exportIdx, -1);
  assert.ok(importIdx < exportIdx);
  assert.match(appsScript, /duration_ms: finishedMs - startedMs/);
  assert.match(appsScript, /DAILY_AUTO_LAST_STAGES_JSON/);
  assert.match(appsScript, /dailyAuto_stage /);
});

test("dailyAuto retries only pull/import/export once after seven minutes", () => {
  assert.match(
    appsScript,
    /DAILY_AUTO_RETRYABLE_STAGES_ = \["pullFromDB", "importStats", "exportStats"\]/,
  );
  assert.match(appsScript, /DAILY_AUTO_RETRY_DELAY_MS_ = 7 \* 60 \* 1000/);
  assert.match(appsScript, /newTrigger\("dailyAutoRetry_"\)[\s\S]*?\.after\(DAILY_AUTO_RETRY_DELAY_MS_\)/);
  assert.match(appsScript, /function dailyAutoRetry_\(\)/);
  assert.doesNotMatch(
    appsScript.slice(
      appsScript.indexOf("function dailyAutoRetry_()"),
      appsScript.indexOf("function dailyAuto()", appsScript.indexOf("function dailyAutoRetry_()")),
    ),
    /scheduleDailyAutoRetry_/,
  );
});

test("fillCaptionFromAsset_ keeps the live existing-caption self-heal", () => {
  const start = appsScript.indexOf("function fillCaptionFromAsset_()");
  const end = appsScript.indexOf("function dailyAuto()", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /const currentCaption = String\(caps\[i\]\[0\] \|\| ""\)/);
  assert.match(body, /currentCaption\.trim\(\) !== ""/);
  assert.match(body, /normalizedCaption !== currentCaption/);
  assert.match(body, /\\s\*\\\.디자인\\s\*\\d\*\\s\*\$/);
  assert.match(body, /split\("_"\)\[8\]/);
});

test("syncCreators only fills blanks and preserves manual planner/creator values", () => {
  const start = appsScript.indexOf("function syncCreators()");
  const end = appsScript.indexOf("function getPricingSheet_()", start);
  const body = appsScript.slice(start, end);
  assert.match(body, /const blankOnly = function\(current\)/);
  assert.equal((body.match(/writeColumnByKey_\(/g) ?? []).length, 2);
  assert.match(body, /plannerByKey,[\s\S]*?linkKey_,[\s\S]*?blankOnly/);
  assert.match(body, /makerByKey,[\s\S]*?linkKey_,[\s\S]*?blankOnly/);
  assert.doesNotMatch(body, /setValues\(planners\)|setValues\(makers\)/);
});

test("URL-key writers re-read current URLs and write only changed row runs", () => {
  assert.match(writeGuard, /function writeColumnByKey_\(/);
  assert.match(
    writeGuard,
    /getRange\(dataStartRow, urlCol, n, 1\)\.getValues\(\);\s*\/\/ 쓰기 직전 최신 위치/,
  );
  assert.match(writeGuard, /function writeColumnRuns_\(/);
  assert.match(writeGuard, /sorted\[end\]\.row === sorted\[end - 1\]\.row \+ 1/);
  assert.match(writeGuard, /if \(shouldWrite && !shouldWrite/);
  const statusStart = appsScript.indexOf("function syncStatus()");
  const statusEnd = appsScript.indexOf("function refreshCumulativeViews()", statusStart);
  assert.match(appsScript.slice(statusStart, statusEnd), /writeColumnByKey_\(/);
});

test("writeColumnByKey_ follows the latest URL order and preserves nonblank manual cells", () => {
  const helpers = new Function(
    `${writeGuard}\nreturn { writeColumnByKey_: writeColumnByKey_ };`,
  )() as {
    writeColumnByKey_: (
      sheet: unknown,
      dataStartRow: number,
      urlCol: number,
      targetCol: number,
      values: Record<string, string>,
      keyFn: (url: string) => string,
      shouldWrite: (current: unknown) => boolean,
    ) => number;
  };
  const writes: Array<{ row: number; col: number; values: unknown[][] }> = [];
  const sheet = {
    getLastRow: () => 4,
    getRange: (row: number, col: number, numRows: number) => ({
      getValues: () => {
        if (row === 2 && col === 1) return [["u2"], ["u1"], ["u3"]];
        if (row === 2 && col === 2) return [["manual"], [""], ["old"]];
        throw new Error(`unexpected getValues range ${row},${col},${numRows}`);
      },
      setValues: (values: unknown[][]) => writes.push({ row, col, values }),
    }),
  };
  const changed = helpers.writeColumnByKey_(
    sheet,
    2,
    1,
    2,
    { u1: "planner-1", u2: "planner-2" },
    url => url,
    current => current === "",
  );
  assert.equal(changed, 1);
  assert.deepEqual(writes, [{ row: 3, col: 2, values: [["planner-1"]] }]);
});

test("daily trigger installs and removes the 00:00 syncNew trigger", () => {
  assert.match(
    appsScript,
    /newTrigger\("syncNew"\)[\s\S]*?\.atHour\(0\)[\s\S]*?\.everyDays\(1\)/,
  );
  assert.match(
    appsScript,
    /function removeDailyTrigger\(\)[\s\S]*?\["syncNew", "dailyAuto", "dailyAutoRetry_"\]/,
  );
  assert.match(appsScript, /\["syncNew", "dailyAuto", "dailyAutoRetry_"\]/);
});
