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

test("cumulative V4: per-row formulas, manual values preserved, no spill anchor", () => {
  // ① onStatusEdit_가 다중셀 제한 전에 H열 재충전 훅을 호출
  const editStart = appsScript.indexOf("function onStatusEdit_(e)");
  assert.notEqual(editStart, -1);
  const editBody = appsScript.slice(editStart, appsScript.indexOf("function installStatusEditTrigger()", editStart));
  const healCallIdx = editBody.indexOf("healCumulativeOnEdit_(e, sheet)");
  const singleCellIdx = editBody.indexOf("getNumRows() !== 1");
  assert.notEqual(healCallIdx, -1, "onStatusEdit_가 healCumulativeOnEdit_를 호출해야 함");
  assert.ok(healCallIdx < singleCellIdx, "재충전 훅은 단일셀 제한보다 먼저(다중셀 붙여넣기도 감지)");
  // ② healCumulativeOnEdit_는 H열 미포함 편집이면 즉시 반환, 포함이면 refreshCumulativeViews 호출
  const healStart = appsScript.indexOf("function healCumulativeOnEdit_(");
  assert.notEqual(healStart, -1);
  const healBody = appsScript.slice(healStart, appsScript.indexOf("function refreshCumulativeViews()", healStart));
  assert.match(healBody, /getLastColumn\(\) < cumCol \|\| e\.range\.getColumn\(\) > cumCol\) return/);
  assert.match(healBody, /refreshCumulativeViews\(\)/);
  // ③ V4: 행별 수식(=IF(COUNT(...)=0,"",MAX(...))) — 스필 앵커·마커·clearContent 없음
  const refStart = appsScript.indexOf("function refreshCumulativeViews()");
  const refBody = appsScript.slice(refStart, appsScript.indexOf("function parseCreator_(", refStart));
  assert.match(refBody, /"=IF\(COUNT\(" \+ firstDate \+ r \+ ":" \+ lastDate \+ r \+ "\)=0,\\"\\",MAX\(/);
  assert.match(refBody, /const dateRe = \/\^\\s\*\(\?:\\d\{2,4\}/);
  assert.match(refBody, /"데이터 없음"과 "수식 파손"을 구분/);
  assert.doesNotMatch(refBody, /else \{ out\.push\(\[""\]\); \}/);
  assert.doesNotMatch(refBody, /AUTO_CUMULATIVE_BYROW/);
  assert.doesNotMatch(refBody, /clearContent\(\)/);
  // ④ 수동 입력 보존: 수식 아닌 값이고 자동 MAX와 다르면 그대로 유지
  assert.match(refBody, /!hasFormula && hasValue && Number\(cur\) !== rowMax/);
  // ⑤ 날짜 실측 없는 행의 기존 값(legacy·수기 트래킹)도 보존
  assert.match(refBody, /if \(!hasFormula && hasValue\) \{ out\.push\(\[cur\]\); manualKept\+\+; \}/);
});

test("exportStats leaves blank-result formulas in empty increment cells", () => {
  const start = appsScript.indexOf("function exportStats()");
  const body = appsScript.slice(start, appsScript.indexOf("function refreshCumulativeViews()", start));
  assert.notEqual(start, -1);
  assert.match(body, /const firstDateRef = colLetter_\(firstCol\) \+ rowNum/);
  assert.match(body, /const lastDateRef = colLetter_\(firstCol \+ width - 1\) \+ rowNum/);
  assert.match(body, /incFormulas\.push\(\[`=IF\(COUNT\(\$\{firstDateRef\}:\$\{lastDateRef\}\)=0,"",""\)`\]\)/);
  assert.doesNotMatch(body, /incFormulas\.push\(\[""\]\)/);
});

test("increment V2: row-range formulas replace cell-address lists (column-op & sort safe)", () => {
  const start = appsScript.indexOf("function exportStats()");
  const body = appsScript.slice(start, appsScript.indexOf("function refreshCumulativeViews()", start));
  // 행-범위 수식: 마지막 유효값 − 이전 최대 (범위 참조라 열 삽입/삭제·정렬에 안전)
  assert.match(body, /=IFERROR\(LET\(rng," \+ rngRef/);
  assert.match(body, /cols,SEQUENCE\(1,COLUMNS\(rng\),COLUMN\(" \+ firstCellRef \+ "\),1\)/);
  assert.match(body, /lastC,MAX\(FILTER\(cols,rng>0\)\)/);
  assert.match(body, /IFERROR\(MAX\(0,lastV-MAX\(prev\)\),lastV\)/);
  assert.doesNotMatch(body, /cols,COLUMN\(rng\)/);
  // 옛 셀주소 목록(MAX({CE743,...})) 생성 코드 금지 — 열 삭제 시 #REF! 전멸의 원인(2026-07-27 사고)
  assert.doesNotMatch(body, /MAX\(\{\$\{prevRefs/);
  assert.doesNotMatch(body, /prevRefs\.join/);
  // 백로그(게시 7일 초과 첫 측정)는 표시 빈칸이되 수식 유지
  assert.match(body, /incFormulas\.push\(\['=""'\]\)/);
});

test("exportStats preserves final DB metric in blank cumulative cells for ended posts", () => {
  const start = appsScript.indexOf("function exportStats()");
  const end = appsScript.indexOf("// ═══════════════════════════════════════════════════════════════\n// 일자별 조회수 입력", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /const finalMetricByKey = \{\}/);
  assert.match(body, /const today = todayStr_\(\)/);
  assert.match(body, /if \(measuredAt < today && \(!\(finalMetricByKey\[k\] > 0\) \|\| metric > finalMetricByKey\[k\]\)\)/);
  assert.match(body, /const cumulativeCol = findHeaderCol_\(sheet, \["누적 조회수", "누적조회수"\]\)/);
  assert.match(body, /if \(hasFormula \|\| hasValue\) continue/);
  assert.match(body, /cumOut\[i\]\[0\] = finalMetric/);
  assert.match(body, /트래킹 종료글 H열 빈칸/);
  assert.match(body, /DB 조회수\/도달수 이력이 없는 행/);
});

test("importStats client_version handshake stays paired with server expectation", () => {
  // 라이브 배포 드리프트 감시: .gs 버전 스탬프와 서버 기대값은 같은 커밋에서 함께 갱신돼야 한다.
  const gsVer = appsScript.match(/const IMPORTSTATS_CLIENT_VERSION = "([^"]+)"/);
  assert.ok(gsVer, ".gs에 IMPORTSTATS_CLIENT_VERSION 상수가 있어야 함");
  const route = readFileSync(
    new URL("../app/api/sponsored-posts/stats-import/route.ts", import.meta.url),
    "utf8",
  );
  const svVer = route.match(/const EXPECTED_IMPORTSTATS_CLIENT = "([^"]+)"/);
  assert.ok(svVer, "stats-import 라우트에 EXPECTED_IMPORTSTATS_CLIENT 상수가 있어야 함");
  assert.equal(gsVer![1], svVer![1], "클라이언트/서버 버전 스탬프는 항상 같은 값으로 갱신");
  // importStats가 실제로 버전을 전송
  assert.match(appsScript, /postStats_\(\{ posts: posts, stats: stats, client_version: IMPORTSTATS_CLIENT_VERSION \}\)/);
  // 서버는 불일치 시 경고만 하고 처리는 막지 않음(경고 후 return 없음)
  const warnIdx = route.indexOf("라이브 Apps Script 버전 불일치");
  assert.notEqual(warnIdx, -1);
  const afterWarn = route.slice(warnIdx, warnIdx + 400);
  assert.doesNotMatch(afterWarn, /status: 4\d\d/);
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

test("linked-sheet edit validation covers fixed fields and date-history paste rules", () => {
  const start = appsScript.indexOf("function validateLinkedSheetInputOnEdit_(");
  const end = appsScript.indexOf("function linkedValidationRule_(", start);
  assert.notEqual(start, -1, "입력 검증 함수가 있어야 함");
  const body = appsScript.slice(start, end);

  assert.match(body, /c === 1 && !isValidLinkedDateValue_/);
  assert.match(body, /c === 2 && !isValidLinkedUrlValue_/);
  assert.match(body, /c === 6 && !isValidLinkedProductValue_/);
  assert.match(body, /c === 7/);
  assert.match(body, /c === 10 \|\| c === 11/);
  assert.match(body, /const dateColumns = linkedDateColumns_\(sheet\)/);
  assert.match(body, /statDate < uploadDate/);
  assert.match(body, /statDate > today/);
  assert.match(body, /typeof value === "number" && isFinite\(value\)/);
  assert.doesNotMatch(body, /\.(?:clearContent|setValue|setValues)\(/);
  assert.match(body, /SpreadsheetApp\.getActive\(\)\.toast\(/);

  const editStart = appsScript.indexOf("function onStatusEdit_(e)");
  const editEnd = appsScript.indexOf("function installStatusEditTrigger()", editStart);
  const editBody = appsScript.slice(editStart, editEnd);
  assert.match(editBody, /validateLinkedSheetInputOnEdit_\(e, sheet\)/);
  assert.ok(
    editBody.indexOf("validateLinkedSheetInputOnEdit_(e, sheet)") < editBody.indexOf("getNumRows() !== 1"),
    "다중셀 붙여넣기도 단일셀 제한 전에 검증해야 함",
  );
});

test("linked-sheet data validation rejects invalid input without including registration status", () => {
  const start = appsScript.indexOf("function applyLinkedSheetInputValidation_()");
  const end = appsScript.indexOf("function installLinkedSheetInputValidation()", start);
  assert.notEqual(start, -1);
  const body = appsScript.slice(start, end);
  assert.match(body, /\[1, '=OR\(A2="",AND\(ISNUMBER\(A2\),A2>0\)\)'/);
  assert.match(body, /\[2, '=OR\(B2="",REGEXMATCH/);
  assert.match(body, /\[6, '=OR\(F2="",AND\(REGEXMATCH/);
  assert.match(body, /\[7, '=OR\(G2="",ISNUMBER\(G2\)\)'/);
  assert.match(body, /\[10, '=OR\(J2="",REGEXMATCH/);
  assert.match(body, /\[11, '=OR\(K2="",REGEXMATCH/);
  assert.match(body, /linkedDateColumns_\(sheet\)/);
  assert.match(appsScript, /setAllowInvalid\(false\)/);

  const dateColsStart = appsScript.indexOf("function linkedDateColumns_(sheet)");
  const dateColsEnd = appsScript.indexOf("function validateLinkedSheetInputOnEdit_", dateColsStart);
  const dateColsBody = appsScript.slice(dateColsStart, dateColsEnd);
  assert.match(dateColsBody, /CONFIG\.STATUS_HEADER/);
  assert.match(dateColsBody, /const endCol = statusCol > 0 \? statusCol - 1 : lastCol/);
});

test("new date columns receive real dates, display format, and input validation", () => {
  const start = appsScript.indexOf("function fillInsertedDateHeadersOnChange_(e)");
  const end = appsScript.indexOf("function fillInsertedDateHeadersOnChange(e)", start);
  assert.notEqual(start, -1);
  const body = appsScript.slice(start, end);
  assert.match(body, /e\.changeType !== "INSERT_COLUMN"/);
  assert.match(body, /new Date\(lastDate\.getTime\(\) \+ i \* 86400000\)/);
  assert.match(body, /setNumberFormat\(DATE_HEADER_FORMAT_\)/);
  assert.match(body, /applyDateInputValidation_\(sheet, lastDateCol \+ 1, insertedCount\)/);
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

test("refreshSheetDerivedFields fills existing channel metadata before pricing", () => {
  assert.match(
    appsScript,
    /\.addItem\("파생정보 전체 업데이트", "refreshSheetDerivedFields"\)/,
  );

  const fillStart = appsScript.indexOf("function fillExistingMetadataFromDB_()");
  const refreshStart = appsScript.indexOf("function refreshSheetDerivedFields()");
  const overwriteStart = appsScript.indexOf("function overwriteViralHandles_()");
  assert.notEqual(fillStart, -1, "기존 행 DB 메타데이터 보강 함수가 있어야 함");
  assert.notEqual(refreshStart, -1, "통합 업데이트 함수가 있어야 함");
  assert.ok(fillStart < overwriteStart, "DB 메타 보강은 핸들 정정 함수보다 앞에 둔다");

  const fillBody = appsScript.slice(fillStart, refreshStart);
  assert.match(fillBody, /const fillFields = \["account_name", "company_name", "cost"\]/);
  assert.match(fillBody, /const postByKey = \{\}/);
  assert.match(fillBody, /if \(hasFormula\) return/);
  assert.match(fillBody, /matched_rows: matchedRows/);
  assert.match(fillBody, /missing_post_rows: missingPostRows/);
  assert.match(fillBody, /blank_db_account_name: blankDbByField\.account_name/);
  assert.doesNotMatch(fillBody, /sheet\.getLastRow\(\) \+ 1/);
  assert.doesNotMatch(fillBody, /setValue\(p\.url\)/);

  const refreshBody = appsScript.slice(refreshStart);
  const metadataIdx = refreshBody.indexOf('["채널명/DB 메타", fillExistingMetadataFromDB_]');
  const pricingIdx = refreshBody.indexOf('["업체명/비용", syncPricing]');
  assert.notEqual(metadataIdx, -1);
  assert.notEqual(pricingIdx, -1);
  assert.ok(metadataIdx < pricingIdx, "채널명/DB 메타 보강 후 업체명/비용 계산을 실행해야 함");
  assert.match(refreshBody, /\["바이럴 채널명", overwriteViralHandles_\]/);
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

test("linked sheet H/I audit is available from Apps Script and GitHub Actions", () => {
  assert.match(appsScript, /function auditLinkedSheetFormulas_\(\)/);
  assert.match(appsScript, /cumulative_blank_no_formula/);
  assert.match(appsScript, /increment_ref_errors/);
  assert.match(appsScript, /linked_sheet_formula_audit/);

  const csvWorkflow = readFileSync(
    new URL("../../.github/workflows/sheet-formula-audit.yml", import.meta.url),
    "utf8",
  );
  const canonicalWorkflow = readFileSync(
    new URL("../../.github/workflows/formula-audit.yml", import.meta.url),
    "utf8",
  );
  const auditScript = readFileSync(
    new URL("../../scripts/audit_linked_sheet_formulas.py", import.meta.url),
    "utf8",
  );
  assert.match(canonicalWorkflow, /cron: "10 1 \* \* \*"/);
  assert.match(canonicalWorkflow, /\/api\/sponsored-posts\/formula-audit/);
  assert.match(csvWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(csvWorkflow, /\n\s*schedule:/);
  assert.match(csvWorkflow, /python scripts\/audit_linked_sheet_formulas\.py/);
  assert.match(auditScript, /#REF/);
  assert.match(auditScript, /increment column is fully blank/);
});

test("Apps Script clasp deploy path is staged and guarded", () => {
  const clasp = readFileSync(new URL("../../.clasp.json", import.meta.url), "utf8");
  const manifest = readFileSync(
    new URL("../../apps-script/appsscript.json", import.meta.url),
    "utf8",
  );
  const deploy = readFileSync(
    new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url),
    "utf8",
  );
  assert.match(clasp, /"rootDir": "dist\/apps-script"/);
  assert.match(clasp, /1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn/);
  assert.match(manifest, /"runtimeVersion": "V8"/);
  assert.match(deploy, /APPS_SCRIPT_ALLOW_PUSH/);
  assert.match(deploy, /APPS_SCRIPT_EXPECTED_SCRIPT_ID/);
  assert.match(deploy, /SEQUENCE\(1,COLUMNS\(rng\),COLUMN\(/);
  assert.match(deploy, /Refusing clasp push/);
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
  assert.match(appsScript, /AUTO_WRITE_TAIL_GUARD_MS = 90 \* 1000/);
  assert.match(appsScript, /function isAutoWriteActive_/);
  assert.match(appsScript, /function withAutoWriteGuard_/);
  assert.match(appsScript, /function skipEditDuringAutoWrite_/);
  assert.match(appsScript, /Date\.now\(\) \+ AUTO_WRITE_TAIL_GUARD_MS/);
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
  assert.match(writeGuard, /function buildUrlKeyIndex_\(/);
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

test("exportStats phase 2 writes date values by URL key and guards row-based formulas", () => {
  const start = appsScript.indexOf("function exportStats()");
  const end = appsScript.indexOf("function parseMonthDay_", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /const latestUrlsForDates = sheet\.getRange\(CONFIG\.DATA_START_ROW, fieldCols\.url, nRows, 1\)\.getValues\(\)/);
  assert.match(body, /const latestDateBlock = sheet\.getRange\(CONFIG\.DATA_START_ROW, firstCol, nRows, width\)\.getValues\(\)/);
  assert.match(body, /const latestRowByKey = \{\}, latestKeyCounts = \{\}/);
  assert.match(body, /const latestIndex = latestRowByKey\[key\]/);
  assert.match(body, /if \(current !== block\[i\]\[bi\]\)/);
  assert.match(body, /finalDateBlock\[latestIndex\]\[bi\] = newBlock\[i\]\[bi\]/);
  assert.match(body, /const preWriteUrls = sheet\.getRange\(CONFIG\.DATA_START_ROW, fieldCols\.url, nRows, 1\)\.getValues\(\)/);
  assert.match(body, /if \(preWriteOrderChanged\)[\s\S]*?return false/);
  assert.match(body, /const dateColGroups = \[\]/);
  assert.match(body, /sheet\.getRange\(CONFIG\.DATA_START_ROW, group\.start, nRows, groupWidth\)\.setValues\(values\)/);
  assert.match(body, /keyRowCounts\[key\] > 1 \|\| latestKeyCounts\[key\] > 1/);
  assert.doesNotMatch(body, /writeColumnRuns_\(sheet, dc\.col/);
  assert.match(body, /const formulaUrls = sheet\.getRange\(CONFIG\.DATA_START_ROW, fieldCols\.url, nRows, 1\)\.getValues\(\)/);
  assert.match(body, /const originalKey = rowKeys\[i\] \|\| ""/);
  assert.match(body, /if \(urlOrderChanged\)[\s\S]*?return false/);
});

test("asset_name is sent from the sheet and remains the canonical sheet-wins field", () => {
  assert.match(appsScript, /"소재명":\s*"asset_name"/);
  assert.match(appsScript, /p\.asset_name\s*=/);
  const statsRoute = readFileSync(
    new URL("../app/api/sponsored-posts/stats-import/route.ts", import.meta.url),
    "utf8",
  );
  const sponsoredWrite = readFileSync(
    new URL("../lib/sponsored-write.ts", import.meta.url),
    "utf8",
  );
  assert.match(statsRoute, /POST_FIELDS = \[[^\]]*"asset_name"/);
  assert.match(statsRoute, /SHEET_WINS = new Set\(\["asset_name"\]\)/);
  assert.match(sponsoredWrite, /SHEET_WINS = new Set\(\["asset_name", "planner", "creator"\]\)/);
});

test("writeColumnByKey_ follows the latest URL order and preserves nonblank manual cells", () => {
  const helpers = new Function(
    `${writeGuard}\nreturn { writeColumnByKey_: writeColumnByKey_, buildUrlKeyIndex_: buildUrlKeyIndex_ };`,
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
    buildUrlKeyIndex_: (
      values: unknown[][],
      keyFn: (url: string) => string,
    ) => {
      keysByIndex: string[];
      countsByKey: Record<string, number>;
      firstIndexByKey: Record<string, number>;
    };
  };
  const index = helpers.buildUrlKeyIndex_([["u2"], ["u1"], ["u2"]], url => url);
  assert.deepEqual(index.keysByIndex, ["u2", "u1", "u2"]);
  assert.deepEqual(index.countsByKey, { u2: 2, u1: 1 });
  assert.deepEqual(index.firstIndexByKey, { u2: 0, u1: 1 });
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

test("menu exposes two primary actions and four focused submenus", () => {
  const start = appsScript.indexOf("function onOpen()");
  const end = appsScript.indexOf("function syncAllWithConfirm()", start);
  assert.notEqual(start, -1);
  const body = appsScript.slice(start, end);
  assert.match(body, /addItem\("신규 전송 미리보기", "previewNew"\)/);
  assert.match(body, /addItem\("신규 광고 추가", "syncNew"\)/);
  assert.match(body, /createMenu\("📊 조회수"\)/);
  assert.match(body, /createMenu\("🔄 메타데이터 · 복구"\)/);
  assert.match(body, /createMenu\("🔎 점검 · 정리"\)/);
  assert.match(body, /createMenu\(automationMenuLabel_\(\)\)/);
  assert.match(body, /addItem\("시트 변경사항 DB 반영", "syncAllWithConfirm"\)/);
  assert.doesNotMatch(body, /바이럴 채널명.*핸들 정정/);
  assert.doesNotMatch(body, /전체 다시 추가/);
});

test("automation menu reports trigger state while status view remains read-only", () => {
  const labelStart = appsScript.indexOf("function automationMenuLabel_()");
  const labelEnd = appsScript.indexOf("function onOpen()", labelStart);
  const labelBody = appsScript.slice(labelStart, labelEnd);
  assert.doesNotMatch(labelBody, /getProjectTriggers/);
  assert.match(labelBody, /DAILY_AUTO_LAST_FINISHED_AT/);
  assert.match(labelBody, /자동화 ✅ 켜짐/);
  assert.match(labelBody, /자동화 ⏹ 꺼짐/);

  const setupStart = appsScript.indexOf("function checkSetup()");
  const setupEnd = appsScript.indexOf("function checkDuplicates()", setupStart);
  const setupBody = appsScript.slice(setupStart, setupEnd);
  assert.match(setupBody, /자동 동기화 상태:/);
  assert.doesNotMatch(setupBody, /(?:newTrigger|deleteTrigger|setProperty)\(/);

  const installStart = appsScript.indexOf("function installDailyTrigger()");
  const removeStart = appsScript.indexOf("function removeDailyTrigger()", installStart);
  const installBody = appsScript.slice(installStart, removeStart);
  const removeBody = appsScript.slice(removeStart, appsScript.indexOf("function summarizeByCompany()", removeStart));
  assert.match(installBody, /setProperty\("AUTO_SYNC_ENABLED", "true"\)/);
  assert.match(removeBody, /setProperty\("AUTO_SYNC_ENABLED", "false"\)/);

  const dailyStart = appsScript.indexOf("function dailyAuto()");
  const dailyEnd = appsScript.indexOf("function fetchCollectedStats_", dailyStart);
  assert.match(appsScript.slice(dailyStart, dailyEnd), /AUTO_SYNC_ENABLED: "true"/);
});

test("sheet-to-DB confirmation and result report diff-only server outcome", () => {
  const confirmStart = appsScript.indexOf("function syncAllWithConfirm()");
  const confirmEnd = appsScript.indexOf("// ═", confirmStart);
  const confirmBody = appsScript.slice(confirmStart, confirmEnd);
  assert.match(confirmBody, /시트 변경사항 DB 반영/);
  assert.match(confirmBody, /URL 기준으로 비교/);
  assert.match(confirmBody, /시트 빈칸으로 기존 DB 값을 지우지 않습니다/);
  assert.match(confirmBody, /의도적인 빈칸은 '-'로 표시/);

  const postStart = appsScript.indexOf("function postRows_(rows)");
  const postEnd = appsScript.indexOf("function markRegistered_", postStart);
  assert.match(appsScript.slice(postStart, postEnd), /created: data\.created \|\| 0/);

  const runStart = appsScript.indexOf("function runSync_(onlyNew)");
  const runEnd = appsScript.indexOf("function syncNew()", runStart);
  const runBody = appsScript.slice(runStart, runEnd);
  assert.match(runBody, /비교한 행: \$\{count\}건/);
  assert.match(runBody, /새로 추가: \$\{created\}건/);
  assert.match(runBody, /값이 달라 수정: \$\{filled\}건/);
});
