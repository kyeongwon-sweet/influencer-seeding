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

test("cumulative anchor self-heals: onEdit hook + spill-block detection + warning-only guard", () => {
  // ① onStatusEdit_가 다중셀 제한 전에 H열 자가치유를 호출
  const editStart = appsScript.indexOf("function onStatusEdit_(e)");
  assert.notEqual(editStart, -1);
  const editBody = appsScript.slice(editStart, appsScript.indexOf("function installStatusEditTrigger()", editStart));
  const healCallIdx = editBody.indexOf("healCumulativeOnEdit_(e, sheet)");
  const singleCellIdx = editBody.indexOf("getNumRows() !== 1");
  assert.notEqual(healCallIdx, -1, "onStatusEdit_가 healCumulativeOnEdit_를 호출해야 함");
  assert.ok(healCallIdx < singleCellIdx, "자가치유는 단일셀 제한보다 먼저(다중셀 붙여넣기도 감지)");
  // ② healCumulativeOnEdit_는 H열 미포함 편집이면 즉시 반환, 포함이면 refreshCumulativeViews 호출
  const healStart = appsScript.indexOf("function healCumulativeOnEdit_(");
  assert.notEqual(healStart, -1);
  const healBody = appsScript.slice(healStart, appsScript.indexOf("function refreshCumulativeViews()", healStart));
  assert.match(healBody, /getLastColumn\(\) < cumCol \|\| e\.range\.getColumn\(\) > cumCol\) return/);
  assert.match(healBody, /refreshCumulativeViews\(\)/);
  // ③ refreshCumulativeViews가 스필 차단(#REF!)을 재설치 조건에 포함
  const refStart = appsScript.indexOf("function refreshCumulativeViews()");
  const refBody = appsScript.slice(refStart, appsScript.indexOf("function parseCreator_(", refStart));
  assert.match(refBody, /anchorBlocked = !!existing && String\(anchor\.getDisplayValue\(\)\)\.charAt\(0\) === "#"/);
  assert.match(refBody, /existing\.indexOf\(marker\) < 0 \|\| anchorBlocked/);
  // ④ H열 경고 보호(AUTO_CUM_GUARD, warning-only) 멱등 설치
  assert.match(refBody, /AUTO_CUM_GUARD/);
  assert.match(refBody, /setWarningOnly\(true\)/);
});

test("warnDateColumnEdit_ alerts on today/future date-column manual entry without touching values", () => {
  const start = appsScript.indexOf("function warnDateColumnEdit_(");
  assert.notEqual(start, -1, "warnDateColumnEdit_ 함수가 있어야 함");
  const body = appsScript.slice(start, appsScript.indexOf("function healCumulativeOnEdit_(", start));
  // onStatusEdit_에 배선(자가치유 다음)
  const editStart = appsScript.indexOf("function onStatusEdit_(e)");
  const editBody = appsScript.slice(editStart, appsScript.indexOf("function installStatusEditTrigger()", editStart));
  assert.match(editBody, /warnDateColumnEdit_\(e, sheet\)/);
  // exportStats와 동일한 연도 롤오버 규칙으로 열→날짜 매핑
  assert.match(body, /parseMonthDay_\(header\[c - 1\]\)/);
  assert.match(body, /if \(prevMonth !== null && md\.mo < prevMonth\) year\+\+/);
  // 미래=경고, 오늘=안내, KST 오늘 기준
  assert.match(body, /todayStr_\(\)/);
  assert.match(body, /d > today/);
  assert.match(body, /d === today/);
  // 값 무수정(무결성 절대규칙): setValue/clearContent 금지, toast만
  assert.doesNotMatch(body, /\.(setValue|setValues|clearContent|setFormula)\(/);
  assert.match(body, /toast\(/);
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
  const dailyStart = appsScript.indexOf("function dailyAuto()");
  const importIdx = appsScript.indexOf('["importStats", importStats]', defsStart);
  const exportIdx = appsScript.indexOf('["exportStats", exportStats]', defsStart);
  assert.notEqual(defsStart, -1);
  assert.notEqual(dailyStart, -1);
  assert.notEqual(importIdx, -1);
  assert.notEqual(exportIdx, -1);
  assert.ok(importIdx < exportIdx);
  assert.match(appsScript, /duration_ms: finishedMs - startedMs/);
  assert.match(appsScript, /DAILY_AUTO_LAST_STAGES_JSON/);
  assert.match(appsScript, /dailyAuto_stage /);
  assert.match(appsScript.slice(dailyStart), /return withAutoWriteGuard_\(function\(\)/);
});

test("dailyAuto retries only pull/import/export once after seven minutes", () => {
  const retryStart = appsScript.indexOf("function dailyAutoRetry_()");
  const dailyStart = appsScript.indexOf("function dailyAuto()", retryStart);
  assert.notEqual(retryStart, -1);
  assert.match(
    appsScript,
    /DAILY_AUTO_RETRYABLE_STAGES_ = \["pullFromDB", "importStats", "exportStats"\]/,
  );
  assert.match(appsScript, /DAILY_AUTO_RETRY_DELAY_MS_ = 7 \* 60 \* 1000/);
  assert.match(appsScript, /newTrigger\("dailyAutoRetry_"\)[\s\S]*?\.after\(DAILY_AUTO_RETRY_DELAY_MS_\)/);
  assert.match(appsScript, /function dailyAutoRetry_\(\)/);
  assert.match(appsScript.slice(retryStart, dailyStart), /return withAutoWriteGuard_\(function\(\)/);
  assert.doesNotMatch(
    appsScript.slice(
      retryStart,
      dailyStart,
    ),
    /scheduleDailyAutoRetry_/,
  );
});

test("automatic sheet writes suppress edit-trigger fanout", () => {
  const statusEditStart = appsScript.indexOf("function onStatusEdit_(e)");
  assert.notEqual(statusEditStart, -1);
  assert.match(appsScript, /AUTO_WRITE_ACTIVE_UNTIL_PROP/);
  assert.match(appsScript, /function isAutoWriteActive_/);
  assert.match(appsScript, /function withAutoWriteGuard_/);
  assert.match(appsScript, /function skipEditDuringAutoWrite_/);
  assert.match(appsScript, /edit_trigger_skipped/);
  assert.match(appsScript.slice(statusEditStart), /skipEditDuringAutoWrite_\("onStatusEdit_"\)/);
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
  const statusBody = appsScript.slice(statusStart, statusEnd);
  assert.match(statusBody, /writeColumnByKey_\(/);
  assert.match(statusBody, /const latestLastRow = sheet\.getLastRow\(\)/);
  assert.match(statusBody, /if \(String\(latestUrls\[i\]\[0\] \|\| ""\)\.trim\(\) !== ""\) continue/);
  assert.match(statusBody, /writeColumnRuns_\(sheet, statusCol, clearedEdits, latestLastRow\)/);
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
