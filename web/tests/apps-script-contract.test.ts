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
const cpvValidationRepair = readFileSync(
  new URL("../../apps-script/rebuild_cpv_validation_20260806.gs", import.meta.url),
  "utf8",
);
const assetPollutionRepair = readFileSync(
  new URL("../../apps-script/repair_asset_name_pollution_20260813.gs", import.meta.url),
  "utf8",
);

test("Apps Script mirror keeps live metadata and URL guards", () => {
  assert.match(appsScript, /"DB → 시트 조회수·누적·증분 반영",\s*"exportStats"/);
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

test("asset-name repair is URL-keyed, backed up and guarded on edit", () => {
  assert.match(appsScript, /sanitizeAssetNameOnEdit_\(e, sheet\)/);
  assert.match(assetPollutionRepair, /ASSET_POLLUTION_RE_/);
  assert.match(assetPollutionRepair, /buildUrlKeyIndex_\(urls, linkKey_\)/);
  assert.match(assetPollutionRepair, /_codex_asset_pollution_backup_/);
  assert.match(assetPollutionRepair, /currentAsset !== item\.asset_before/);
  assert.match(assetPollutionRepair, /function repairAssetNamePollutionPilot\(\)/);
  assert.match(assetPollutionRepair, /function repairAssetNamePollutionAll\(\)/);
});

test("company pollution repair is limited to 313 URL-keyed cells in company column N", () => {
  const start = appsScript.indexOf("function companyPollutionSource20260818_()");
  const end = appsScript.indexOf("// DB → 시트 반영", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /company-pollution-2026-08-18/);
  assert.match(body, /APPROVED_KEY_HASHES/);
  assert.match(body, /ignored_candidates/);
  assert.match(body, /COMPANY_REPAIR_DIAGNOSTIC/);
  assert.match(body, /duplicate_approved_keys/);
  assert.match(body, /approved_unique_keys/);
  assert.match(body, /missing_approved_hashes/);
  assert.match(body, /approvedHashes\.length !== EXPECTED_COUNT/);
  assert.doesNotMatch(body, /EXPECTED_KEYS_SHA256/);
  assert.match(body, /EXPECTED_COUNT = 313/);
  assert.match(body, /EXPECTED_COMPANY_COL = 14/);
  assert.match(body, /companyPollutionRepairKey20260818_/);
  assert.match(appsScript, /accountKey === "timeholy"/);
  assert.match(body, /approvedCandidatesByKey\[key\]\.length > 1/);
  assert.match(body, /matches\.find\(match => match\.row === item\.row\)/);
  assert.match(body, /_codex_company_backup_20260818/);
  assert.match(body, /function repairCompanyPollution20260818DryRun\(\)/);
  assert.match(body, /function repairCompanyPollution20260818Apply\(\)/);
  assert.match(body, /function syncCompanyPollutionBackupToDb20260818\(\)/);
  assert.match(body, /function auditCompanyPollutionDb20260818\(\)/);
  assert.match(body, /COMPANY_REPAIR_DB_SYNC/);
  assert.match(body, /COMPANY_REPAIR_DB_AUDIT/);
  assert.match(body, /실행 중 행 순서가 바뀌어 중단했습니다/);
  assert.match(body, /writeColumnRuns_\(sheet, EXPECTED_COMPANY_COL, edits, lastRow\)/);
  assert.doesNotMatch(body, /deleteRow|deleteRows|insertRows|clearContent/);
});

test("magazine carousel banner repair is four-post, URL-keyed, and preserves H/I", () => {
  const start = appsScript.indexOf("function repairMagazineCarouselBanner20260825(payload)");
  const body = appsScript.slice(start);
  assert.notEqual(start, -1);
  assert.match(body, /magazine-carousel-banner-2026-08-25/);
  assert.match(body, /const TARGETS = \[/);
  assert.match(body, /TARGETS\.length/);
  assert.match(body, /linkKey_\(row\[fieldCols\.url - 1\]\)/);
  assert.match(body, /_codex_magazine_banner_backup_20260825/);
  assert.match(body, /banner_reach_inserted !== TARGETS\.length/);
  assert.match(body, /h_formula:\s*found\.formulas\[hCol - 1\]/);
  assert.match(body, /i_formula:\s*found\.formulas\[iCol - 1\]/);
  assert.match(body, /조회수·누적·증분 셀이 바뀌어 중단했습니다/);
  assert.match(body, /function repairMagazineCarouselBanner20260825DryRun\(\)/);
  assert.match(body, /function repairMagazineCarouselBanner20260825Apply\(\)/);
  assert.doesNotMatch(body, /deleteRow|deleteRows|insertRows|clearContent/);
});

test("Apps Script morning audit fallback covers formula and creator audits at 09:40", () => {
  assert.match(appsScript, /ENSURE_DAILY_AUDITS_URL:\s*"https:\/\/influencer-seeding-mu\.vercel\.app\/api\/ops\/ensure-daily-audits"/);
  assert.match(appsScript, /function ensureDailyAudits\(\)/);
  assert.match(
    appsScript,
    /newTrigger\("ensureDailyAudits"\)[\s\S]*?\.atHour\(9\)[\s\S]*?\.nearMinute\(40\)[\s\S]*?\.everyDays\(1\)/,
  );
  assert.match(
    appsScript,
    /\["auditFallback", "ensureDailyAudits"\][\s\S]*?ScriptApp\.deleteTrigger/,
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

test("exportStats calculates increments from the sheet range when DB refs are absent", () => {
  const start = appsScript.indexOf("function exportStats()");
  const body = appsScript.slice(start, appsScript.indexOf("function refreshCumulativeViews()", start));
  assert.notEqual(start, -1);
  const noRefs = body.slice(body.indexOf("if (refs.length === 0)"), body.indexOf("// 백로그 첫 측정", body.indexOf("if (refs.length === 0)")));
  assert.match(noRefs, /const rngRef = "\$" \+ colLetter_\(firstCol\) \+ rowNum/);
  assert.match(noRefs, /cols,SEQUENCE\(1,COLUMNS\(rng\),COLUMN\(" \+ firstCellRef \+ "\),1\)/);
  assert.match(noRefs, /IFERROR\(MAX\(0,lastV-MAX\(prev\)\),lastV\)/);
  assert.doesNotMatch(noRefs, /IF\(COUNT\(/);
  assert.doesNotMatch(body, /incFormulas\.push\(\[""\]\)/);
});

test("Apps Script linkKey_ maps TikTok video and photo URLs to the same tt identity form", () => {
  const start = appsScript.indexOf("function linkKey_(u)");
  const end = appsScript.indexOf("function removeDuplicateLinks()", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /\(\?:video\|photo\)/);
  assert.match(body, /isValidTikTokSnowflake_\(tt\[1\]\) \? "tt:" \+ tt\[1\] : ""/);
  assert.match(appsScript, /const MAX_TIKTOK_SNOWFLAKE_ = "18446744073709551615"/);
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

test("new DB-appended rows immediately receive H/I formulas and numeric date headers are supported", () => {
  const pullStart = appsScript.indexOf("function pullFromDB()");
  const pullEnd = appsScript.indexOf("function dailyAuto()", pullStart);
  const pullBody = appsScript.slice(pullStart, pullEnd);
  assert.match(pullBody, /appendRange\.setValues\(pendingRows\.map\(x => x\.values\)\)/);
  assert.match(pullBody, /assertRowCountStable_\(sheet, lastRow, "pullFromDB append"\)/);
  assert.match(pullBody, /writtenUrls/);
  assert.match(pullBody, /appendRange\.clearContent\(\)/);
  assert.match(pullBody, /ensureNewRowsMetricFormulas_\(sheet, startRow, startRow \+ added - 1\)/);

  const helperStart = appsScript.indexOf("function ensureNewRowsMetricFormulas_(");
  const helperEnd = appsScript.indexOf("function pullFromDB()", helperStart);
  const helperBody = appsScript.slice(helperStart, helperEnd);
  assert.match(helperBody, /!cell\.getFormula\(\).*trim\(\) === ""/s);
  assert.match(helperBody, /=IF\(COUNT\(/);
  assert.match(helperBody, /IFERROR\(MAX\(0,lastV-MAX\(prev\)\),lastV\)/);

  const parserStart = appsScript.indexOf("function parseMonthDay_(label)");
  const parserEnd = appsScript.indexOf("function onEdit", parserStart);
  const parserBody = appsScript.slice(parserStart, parserEnd);
  assert.match(parserBody, /typeof label === "number" && label >= 44000 && label <= 48000/);
  assert.match(parserBody, /Date\.UTC\(1899, 11, 30\)/);
});

test("syncNew fills missing H/I formulas before marking rows registered", () => {
  const collectStart = appsScript.indexOf("function collectRows_(onlyNew)");
  const collectEnd = appsScript.indexOf("function urlKey_(u)", collectStart);
  const collectBody = appsScript.slice(collectStart, collectEnd);
  assert.match(collectBody, /rowRefs\.push\(\{ row: rowNum, key: key \}\)/);
  assert.match(collectBody, /return \{ rows, rowNums, rowRefs, statusCol, skipped, dupCount, future, lastRow \}/);

  const helperStart = appsScript.indexOf("function assertSyncRowsStable_(sheet, rowRefs, expectedLastRow)");
  const helperEnd = appsScript.indexOf("// ═", helperStart);
  const helperBody = appsScript.slice(helperStart, helperEnd);
  assert.match(helperBody, /assertRowCountStable_\(sheet, expectedLastRow, "syncNew formula fill"\)/);
  assert.match(helperBody, /urlKey_\(sheet\.getRange\(ref\.row, urlCol\)\.getValue\(\)\)/);
  assert.match(helperBody, /ensureNewRowsMetricFormulas_\(sheet, start, end\)/);

  const runStart = appsScript.indexOf("function runSync_(onlyNew)");
  const runEnd = appsScript.indexOf("function syncNew()", runStart);
  const runBody = appsScript.slice(runStart, runEnd);
  const fillAt = runBody.indexOf("ensureMetricFormulasForRows_(sheet, rowRefs, lastRow)");
  const markAt = runBody.indexOf("markRegistered_(sheet, statusCol, rowNums)");
  assert.ok(fillAt >= 0, "syncNew formula fill call missing");
  assert.ok(markAt > fillAt, "registration status must be written only after formula fill succeeds");
  assert.match(runBody, /H\/I 수식 보강/);

  assert.match(appsScript, /function syncNew\(\)\s*\{ return withDocLock_\(function\(\) \{ return runSync_\(true\); \}\); \}/);
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
  assert.match(appsScript, /client_version: IMPORTSTATS_CLIENT_VERSION,[\s\S]*?source: importSource/);
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
  assert.match(body, /const fieldCols = buildFieldCols_\(sheet\)/);
  assert.match(body, /personCols\[c\]/);
  assert.doesNotMatch(body, /c === 10 \|\| c === 11/);
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
  assert.match(body, /\[6, '=OR\(F2="",F2="-",AND\(REGEXMATCH/);
  assert.match(body, /\[7, '=OR\(G2="",ISNUMBER\(G2\)\)'/);
  assert.match(body, /const fieldCols = buildFieldCols_\(sheet\)/);
  assert.match(body, /const cpvCol = findHeaderCol_\(sheet, \["CPV", "cpv"\]\)/);
  assert.match(body, /rules\.push\(\[cpvCol, '=OR\('/);
  assert.match(body, /cpvCell \+ '="\?",ISNUMBER/);
  assert.match(body, /\[fieldCols\.planner, fieldCols\.creator\]\.forEach/);
  assert.match(body, /rules\.push\(\[col, '=OR\('/);
  assert.doesNotMatch(body, /\[10, '=OR\(J2="",REGEXMATCH/);
  assert.doesNotMatch(body, /\[11, '=OR\(K2="",REGEXMATCH/);
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
  assert.match(body, /repairStaleMetricFormulaRanges_\(sheet\)/);
});

test("stale metric formula ranges extend without overwriting manual or custom cells", () => {
  const start = appsScript.indexOf("function repairStaleMetricFormulaRanges_(sheet)");
  const end = appsScript.indexOf("function ensureNewRowsMetricFormulas_", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /getFormulas\(\)/);
  assert.match(body, /standardCumulativeFormulaEnd_\(formulas\[i\]\[0\], row, firstLetter\)/);
  assert.match(body, /standardIncrementFormulaEnd_\(formulas\[i\]\[0\], row, firstLetter\)/);
  assert.match(body, /metricColumnNumber_\(currentEnd\) < lastCol/);
  assert.match(body, /writeColumnRuns_\(targetSheet, cumulativeCol, cumulativeEdits, lastRow\)/);
  assert.match(body, /writeColumnRuns_\(targetSheet, incrementCol, incrementEdits, lastRow\)/);
  assert.doesNotMatch(body, /clearContent\(/);
  assert.doesNotMatch(body, /setValues\(out\)/);

  const defsStart = appsScript.indexOf("function dailyAutoStageDefs_()");
  const defsEnd = appsScript.indexOf("function runDailyAutoStage_", defsStart);
  const defsBody = appsScript.slice(defsStart, defsEnd);
  const refreshIdx = defsBody.indexOf('["refreshCumulativeViews", refreshCumulativeViews]');
  const repairIdx = defsBody.indexOf('["repairMetricFormulaRanges"');
  assert.notEqual(refreshIdx, -1);
  assert.notEqual(repairIdx, -1);
  assert.ok(refreshIdx < repairIdx, "H 수동값 보존 갱신 뒤 표준 H/I 끝열만 확장해야 함");

  const helperStart = appsScript.indexOf("function metricCumulativeFormula_(");
  const helperEnd = appsScript.indexOf("function repairStaleMetricFormulaRanges_", helperStart);
  const helperSource = appsScript.slice(helperStart, helperEnd);
  const helpers = Function(
    helperSource
      + "; return { metricCumulativeFormula_, metricIncrementFormula_, metricColumnNumber_,"
      + " standardCumulativeFormulaEnd_, standardIncrementFormulaEnd_ };",
  )();
  const hDh = helpers.metricCumulativeFormula_(2764, "P", "DH");
  const iDh = helpers.metricIncrementFormula_(2764, "P", "DH");
  assert.equal(helpers.standardCumulativeFormulaEnd_(hDh, 2764, "P"), "DH");
  assert.equal(helpers.standardIncrementFormulaEnd_(iDh, 2764, "P"), "DH");
  assert.ok(helpers.metricColumnNumber_("DH") < helpers.metricColumnNumber_("DK"));
  assert.equal(helpers.standardCumulativeFormulaEnd_("=MAX(P346:DH346)", 346, "P"), "");
  assert.equal(helpers.standardIncrementFormulaEnd_('=""', 346, "P"), "");
  assert.equal(helpers.standardIncrementFormulaEnd_("=IF($A346=\"x\",1,0)", 346, "P"), "");
});

test("overwriteViralHandles_ only touches viral account_name and self-heals daily via dailyAuto", () => {
  const start = appsScript.indexOf("function overwriteViralHandles_(");
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
  assert.match(
    appsScript,
    /\["overwriteViralHandles", function\(\) \{ return overwriteViralHandles_\(true\); \}\]/,
  );
  assert.match(body, /if \(!silent\) \{\s*safeAlert_/);
});

test("refreshSheetDerivedFields fills existing channel metadata before pricing", () => {
  assert.match(
    appsScript,
    /\.addItem\("파생정보 전체 업데이트", "refreshSheetDerivedFields"\)/,
  );

  const fillStart = appsScript.indexOf("function fillExistingMetadataFromDB_(");
  const refreshStart = appsScript.indexOf("function refreshSheetDerivedFields()");
  const overwriteStart = appsScript.indexOf("function overwriteViralHandles_(");
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
  const metadataIdx = refreshBody.indexOf(
    '["채널명/DB 메타", function() { return fillExistingMetadataFromDB_(true); }]',
  );
  const pricingIdx = refreshBody.indexOf('["업체명/비용", syncPricing]');
  assert.notEqual(metadataIdx, -1);
  assert.notEqual(pricingIdx, -1);
  assert.ok(metadataIdx < pricingIdx, "채널명/DB 메타 보강 후 업체명/비용 계산을 실행해야 함");
  assert.match(
    refreshBody,
    /\["바이럴 채널명", function\(\) \{ return overwriteViralHandles_\(true\); \}\]/,
  );
  assert.match(
    refreshBody,
    /\["채널명\/DB 메타", function\(\) \{ return fillExistingMetadataFromDB_\(true\); \}\]/,
  );
  assert.match(fillBody, /if \(!silent\) safeAlert_/);
  assert.match(refreshBody, /refreshSheetDerivedFields_step_start/);
  assert.match(refreshBody, /refreshSheetDerivedFields_step_end/);
});

test("dailyAuto prices sheet rows before importing stats and then exports DB stats", () => {
  const defsStart = appsScript.indexOf("function dailyAutoStageDefs_()");
  const dailyStart = appsScript.indexOf("function dailyAuto()");
  const defsBody = appsScript.slice(defsStart, dailyStart);
  const pricingIdx = appsScript.indexOf('["syncPricing", syncPricing]', defsStart);
  const importIdx = appsScript.indexOf('["importStats", function() { return importStats("daily_auto"); }]', defsStart);
  const exportIdx = appsScript.indexOf('["exportStats", exportStats]', defsStart);
  assert.notEqual(defsStart, -1);
  assert.notEqual(dailyStart, -1);
  assert.notEqual(pricingIdx, -1);
  assert.notEqual(importIdx, -1);
  assert.notEqual(exportIdx, -1);
  assert.ok(pricingIdx < importIdx);
  assert.ok(importIdx < exportIdx);
  assert.doesNotMatch(defsBody, /\["pullFromDB"/);
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
  // ⚠️ 시각을 하드코딩하지 않는다(2026-08-06 아침 배치를 1시간 앞당길 때 이 테스트가 깨졌다).
  //    지켜야 할 것은 시각 자체가 아니라 **순서**다: 수식감사는 시트 동기화(dailyAuto, 08:30 KST)
  //    **이후**에 돌아야 한다. 앞서 돌면 동기화 전 시트를 감사해 오진한다.
  const cronMatch = canonicalWorkflow.match(/cron: "(\d+) (\d+) \* \* \*"/);
  assert.ok(cronMatch, "formula-audit.yml 에 일 1회 cron 이 있어야 한다");
  const [, minStr, hourStr] = cronMatch!;
  const kstMinutes = (((Number(hourStr) + 9) % 24) * 60) + Number(minStr);
  const DAILY_AUTO_KST = 8 * 60 + 30;    // dailyAuto = 08:30 KST (Apps Script 시간 트리거)
  // 자가치유 폴백(auditFallback). 2026-08-07 기준 11:00 → **09:40 이전(移)** 진행 중:
  // GitHub cron이 상시 3시간 지연 + 이틀 완전 누락한 실측 때문에 폴백을 아침으로 당긴다.
  // 이 상수는 "수식감사 cron이 폴백보다 앞서야 한다"는 순서만 지킨다 —
  // 폴백을 09:40으로 옮겨도 09:10 < 09:40 이라 그대로 성립한다.
  const FALLBACK_KST = 9 * 60 + 40;
  assert.ok(
    kstMinutes > DAILY_AUTO_KST && kstMinutes < FALLBACK_KST,
    `수식감사는 dailyAuto(08:30) 이후 · 자가치유 폴백(09:40) 이전이어야 한다. 현재 KST ${Math.floor(kstMinutes / 60)}:${String(kstMinutes % 60).padStart(2, "0")}`,
  );
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
  assert.match(deploy, /function flattenPulledProject\(\)/);
  assert.match(deploy, /duplicate basename/);
  assert.match(deploy, /runClasp\(\["pull"\], distDir\)/);
  assert.match(deploy, /runClasp\(\["push", "--force"\], distDir\)/);
  assert.match(deploy, /verifyDistMatchesSource\("live pull"\)/);
  assert.match(deploy, /AI [^"]+\.js/);
  assert.match(deploy, /_WriteGuard\.js/);
  assert.doesNotMatch(deploy, /"Code\.gs"/);
  assert.doesNotMatch(deploy, /rollback_backfill86_sheet_temp/);
});

test("dailyAuto retries only import/export once after seven minutes", () => {
  const retryStart = appsScript.indexOf("function dailyAutoRetry_()");
  const dailyStart = appsScript.indexOf("function dailyAuto()", retryStart);
  assert.notEqual(retryStart, -1);
  assert.match(
    appsScript,
    /DAILY_AUTO_RETRYABLE_STAGES_ = \["importStats", "exportStats"\]/,
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

test("DB to sheet sync runs independently every three hours with retry, watchdog, and alerts", () => {
  const start = appsScript.indexOf("const DB_PULL_SYNC_INTERVAL_HOURS_");
  const end = appsScript.indexOf("function fetchCollectedStats_()", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = appsScript.slice(start, end);

  assert.match(body, /DB_PULL_SYNC_INTERVAL_HOURS_ = 3/);
  assert.match(body, /DB_PULL_SYNC_RETRY_DELAY_MS_ = 7 \* 60 \* 1000/);
  assert.match(body, /DB_PULL_SYNC_WATCHDOG_DELAY_MS_ = 20 \* 60 \* 1000/);
  assert.match(body, /DB_PULL_SYNC_TIMEOUT_RETRY_DELAY_MS_ = 15 \* 60 \* 1000/);
  assert.match(body, /function runDbPullSyncAttempt_\(source, attempt\)/);
  assert.match(body, /return withAutoWriteGuard_\(function\(\) \{[\s\S]*?return withDocLock_\(function\(\)/);
  assert.match(body, /newTrigger\("dbPullSyncWatchdog_"\)/);
  assert.match(body, /DB_PULL_SYNC_LAST_STATUS/);
  assert.match(body, /DB_PULL_SYNC_PENDING_JSON/);
  assert.match(body, /notifyDbPullSyncFailure_/);
  assert.match(body, /const willRetry = attempt < 1/);
  assert.match(body, /function scheduledDbPullSync_\(\)/);
  assert.match(
    body,
    /newTrigger\("scheduledDbPullSync_"\)[\s\S]*?\.everyHours\(DB_PULL_SYNC_INTERVAL_HOURS_\)/,
  );
  assert.match(body, /function dbPullSyncRetry_\(\)/);
  assert.match(body, /function dbPullSyncWatchdog_\(\)/);
  assert.match(appsScript, /DB_SHEET_SYNC_ALERT_URL/);
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
  // ⚠️ 2026-08-21: 캐션 세그먼트 추출은 captionFromAssetName_로 분리됐다(배너 인덱스 어긋남 수정).
  //    고정 인덱스 [8]은 그 헬퍼 안에 '날짜 앵커 실패 시 폴백'으로만 남아 있다.
  assert.match(body, /captionFromAssetName_\(assets\[i\]\[0\], channelType\)/);
  assert.match(appsScript, /function captionFromAssetName_\(/);
});

test("fillCaptionFromAsset_ replaces scraped hashtag captions only on viral rows", () => {
  const start = appsScript.indexOf("function fillCaptionFromAsset_()");
  const end = appsScript.indexOf("function dailyAuto()", start);
  const body = appsScript.slice(start, end);
  assert.match(body, /findHeaderCol_\(sheet, \["채널분류"\]\)/);
  assert.match(body, /const types = sheet\.getRange\(CONFIG\.DATA_START_ROW, typeCol, n, 1\)\.getValues\(\)/);
  assert.match(body, /const channelType = String\(types\[i\]\[0\] \|\| ""\)/);
  assert.match(body, /const isViral = channelType\.indexOf\("바이럴"\) >= 0/);
  assert.match(body, /const desiredCaption = captionFromAssetName_\(assets\[i\]\[0\], channelType\)/);
  assert.match(body, /currentCaption\.indexOf\("#"\) >= 0/);
  assert.match(body, /if \(mayDerive && desiredCaption && desiredCaption !== currentCaption\)/);
  assert.match(body, /edits\.push\(\{ row: CONFIG\.DATA_START_ROW \+ i, value: desiredCaption \}\)/);
  // 바이럴의 해시태그 없는 기존 캡션은 이 분기에서 그대로 보존된다.
  assert.match(body, /if \(isViral\)[\s\S]*continue;/);
  assert.match(body, /writeColumnRuns_\(sheet, capCol, edits, lastRow\)/);
  assert.match(body, /const normalizedCaption = currentCaption/);
});

test("syncCreators fills planner/creator only from the same row asset name", () => {
  const start = appsScript.indexOf("function syncCreators()");
  const end = appsScript.indexOf("function getPricingSheet_()", start);
  const body = appsScript.slice(start, end);
  assert.match(appsScript, /function creatorSourceText_\(/);
  assert.match(appsScript, /replace\(\/\^\[⠿●■◆◇★☆⭐\\s\]\+\//);
  assert.match(appsScript, /function isCreatorParseSource_\(/);
  assert.match(appsScript, /function auditCreatorAssetIntegrity_\(/);
  assert.match(appsScript, /function auditCreatorAssetIntegrity\(\)/);
  assert.match(appsScript, /missing_planner_count: missingPlanners\.length/);
  assert.match(appsScript, /missing_creator_count: missingCreators\.length/);
  assert.match(body, /if \(!isCreatorParseSource_\(asset\)\)/);
  assert.match(body, /plannerEdits\.push\(\{ row: CONFIG\.DATA_START_ROW \+ i, value: parsed\.mk \}\)/);
  assert.match(body, /makerEdits\.push\(\{ row: CONFIG\.DATA_START_ROW \+ i, value: parsed\.pd \}\)/);
  assert.match(body, /writeColumnRuns_\(sheet, plannerCol, plannerEdits, expectedLastRow\)/);
  assert.match(body, /writeColumnRuns_\(sheet, makerCol, makerEdits, expectedLastRow\)/);
  assert.match(body, /auditCreatorAssetIntegrity_\(\)/);
  assert.doesNotMatch(body, /plannerByKey|makerByKey/);
  assert.doesNotMatch(body, /writeColumnByKey_\(/);
  assert.doesNotMatch(body, /linkKey_\(/);
  assert.match(body, /isValidLinkedPersonName_\(parsed\.mk\)/);
  assert.match(body, /isValidLinkedPersonName_\(parsed\.pd\)/);
  assert.match(body, /invalid_planner_skipped: invalidPlannerSkipped/);
  assert.match(body, /invalid_maker_skipped: invalidMakerSkipped/);
  assert.match(body, /non_file_name_skipped: nonFileNameSkipped/);
  assert.match(body, /SpreadsheetApp\.flush\(\)/);
  assert.match(body, /audit: audit/);
  assert.doesNotMatch(body, /setValues\(planners\)|setValues\(makers\)/);
});

test("creator parser anchors planner to the unique YYMMDD token", () => {
  const start = appsScript.indexOf("function creatorSourceText_(");
  const end = appsScript.indexOf("function isCreatorParseSource_(", start);
  const source = appsScript.slice(start, end);
  const parseCreator = new Function(source + "; return parseCreator_;")() as (value: string) => { mk: string; pd: string };

  const hong = "[26.08]F_I_JD멜_인지_상시__바이럴형_떵개연결.콘T기획_.릴스_공무도.캐릭터성.__홍정민_260814_빙과_홍정민";
  assert.deepEqual(parseCreator(hong), { mk: "홍정민", pd: "홍정민" });

  const splitRoles = "[26.08]F_I_JD멜_인지_상시__바이럴형_초딩유행템.마T기획_.배너_초딩다발.__김바다_260810_빙과_오형선.mp4";
  assert.deepEqual(parseCreator(splitRoles), { mk: "김바다", pd: "오형선" });

  const singleUnderscore = "[26.08]F_I_JD멜_인지_상시_바이럴형_테스트_.릴스_포맷_설명_김바다_260810_빙과_오형선";
  assert.deepEqual(parseCreator(singleUnderscore), { mk: "김바다", pd: "오형선" });

  const noDate = "[26.08]F_I_JD멜_인지_상시__바이럴형_테스트_.릴스_테스트__김바다_빙과_오형선";
  assert.equal(parseCreator(noDate).mk, "");

  const shortLegacy = "[24.04]F_V_C혼_바이럴_술자리해장템_추가검증(릴스형)_마케팅_240408_숏_조의진";
  assert.equal(parseCreator(shortLegacy).mk, "");

  const ambiguous = "[26.08]F_I_JD멜_인지_상시__바이럴형_260801_.릴스_테스트__김바다_260810_빙과_오형선";
  assert.equal(parseCreator(ambiguous).mk, "");
  assert.equal(parseCreator(ambiguous).pd, "오형선");
});

test("invalid creator repair backs up rows and clears creator only", () => {
  const start = appsScript.indexOf("function clearInvalidCreatorsWithBackup()");
  const end = appsScript.indexOf("function clearInvalidPlannersWithBackup()", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /_codex_invalid_creator_backup_/);
  assert.match(body, /backupRows = \[\["row", "url", "asset_name", "creator_before"\]\]/);
  assert.match(body, /if \(isCreatorParseSource_\(asset\)\) continue/);
  assert.match(body, /edits\.push\(\{ row: row, value: "" \}\)/);
  assert.match(body, /writeColumnRuns_\(sheet, makerCol, edits, expectedLastRow\)/);
  assert.match(body, /remaining_creator_issues/);
  assert.doesNotMatch(body, /plannerCol/);
  assert.doesNotMatch(body, /writeColumnRuns_\(sheet, planner/);
});

test("invalid planner repair backs up rows and clears planner only", () => {
  const start = appsScript.indexOf("function clearInvalidPlannersWithBackup()");
  const end = appsScript.indexOf("function syncCreators()", start);
  const body = appsScript.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(body, /_codex_invalid_planner_backup_/);
  assert.match(body, /backupRows = \[\["row", "url", "asset_name", "planner_before"\]\]/);
  assert.match(body, /if \(isCreatorParseSource_\(asset\)\) continue/);
  assert.match(body, /edits\.push\(\{ row: row, value: "" \}\)/);
  assert.match(body, /writeColumnRuns_\(sheet, plannerCol, edits, expectedLastRow\)/);
  assert.match(body, /remaining_planner_issues/);
  assert.doesNotMatch(body, /makerCol/);
  assert.doesNotMatch(body, /writeColumnRuns_\(sheet, maker/);
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
  const mainWriterStart = appsScript.indexOf("function writeColumnRuns_");
  const mainWriterEnd = appsScript.indexOf("function metricDateColumns_", mainWriterStart);
  const mainWriterBody = appsScript.slice(mainWriterStart, mainWriterEnd);
  assert.match(mainWriterBody, /expectedLastRow == null \? sheet\.getLastRow\(\) : expectedLastRow/);
  assert.doesNotMatch(mainWriterBody, /assertRowCountStable_\(sheet, expectedLastRow, "writeColumnRuns"\)/);
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

test("sheet-owned metadata remains canonical across both sheet sync paths", () => {
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
  assert.match(statsRoute, /SHEET_WINS = new Set\(\["asset_name", "content_summary", "cost"\]\)/);
  assert.match(sponsoredWrite, /SHEET_WINS = new Set\(\["asset_name", "content_summary", "cost", "planner", "creator"\]\)/);
  assert.match(statsRoute, /manual\.filter\(f => !assertedSheetWins\.has\(f\)\)/);
  assert.match(sponsoredWrite, /manualAfterRepair\.filter\(f => !assertedSheetWins\.has\(f\)\)/);
  assert.match(sponsoredWrite, /repairPollutedCompanyName\(rawCompany, account_name, channel_type\)/);
  assert.match(sponsoredWrite, /f === "company_name" && forceCompanyRepair/);
  assert.match(sponsoredWrite, /upd\.company_name = desired/);
});

test("sponsored sheet bulk create path is duplicate-safe", () => {
  const sponsoredWrite = readFileSync(
    new URL("../lib/sponsored-write.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    sponsoredWrite,
    /\.upsert\(createRows, \{ onConflict: "url", ignoreDuplicates: true \}\)/,
  );
  assert.doesNotMatch(
    sponsoredWrite,
    /supportsNormalizedKey[\s\S]*?\.insert\(createRows\)/,
  );
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

test("daily trigger installs and removes syncNew plus independent DB pull triggers", () => {
  assert.match(
    appsScript,
    /newTrigger\("syncNew"\)[\s\S]*?\.atHour\(0\)[\s\S]*?\.everyDays\(1\)/,
  );
  assert.match(
    appsScript,
    /function removeDailyTrigger\(\)[\s\S]*?\["syncNew", "dailyAuto", "dailyAutoRetry_", "scheduledDbPullSync_", "dbPullSyncRetry_", "dbPullSyncWatchdog_"\]/,
  );
  assert.match(appsScript, /function installDailyTrigger\(\)[\s\S]*?installDbPullSyncTrigger_\(\)/);
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
  assert.match(body, /addInsightInquiryMenu_\(\)/);
  assert.doesNotMatch(body, /createMenu\("💻배너 인사이트 요청"\)/);
});

test("insight inquiry replaces the legacy banner lookup menu", () => {
  const inquiryScript = readFileSync(
    new URL("../../apps-script/인사이트_문의_메시지_자동생성.gs", import.meta.url),
    "utf8",
  );
  assert.match(inquiryScript, /createMenu\("📮 인사이트문의"\)/);
  assert.match(inquiryScript, /function insightInquiryBuildToday\(\)/);
  assert.match(inquiryScript, /function insightInquiryBuildForDate\(\)/);
  assert.match(inquiryScript, /function insightInquiryDiagnose\(\)/);
  assert.match(inquiryScript, /function insightInquiryEnableDailyTrigger\(\)/);
  assert.match(inquiryScript, /function insightInquiryDisableDailyTrigger\(\)/);
  assert.match(inquiryScript, /업로드일/);
  assert.match(inquiryScript, /게시물URL/);
  assert.match(inquiryScript, /채널분류/);
  assert.match(inquiryScript, /업체명/);
  assert.doesNotMatch(inquiryScript, /^function onOpen\(\)/m);
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

test("B-column URL cleanup is rerunnable and fails closed on key drift", () => {
  const cleanupScript = readFileSync(
    new URL("../../apps-script/cleanup_url_params_20260730.gs", import.meta.url),
    "utf8",
  );
  assert.match(cleanupScript, /function cleanupUrlParamsBColumn20260730\(\)/);
  assert.match(cleanupScript, /if \(!targets\.length\)/);
  assert.match(cleanupScript, /Join key changed at row/);
  assert.match(cleanupScript, /_codex_url_param_backup_/);
  assert.match(cleanupScript, /remainingQuestionMarks/);
  assert.doesNotMatch(cleanupScript, /EXPECTED_TOTAL|EXPECTED_COUNTS/);
});

test("CPV validation survives row changes and includes filtered rows", () => {
  assert.match(cpvValidationRepair, /INDEX\(' \+ letter \+ ':\' \+ letter \+ ',ROW\(\)\)/);
  assert.doesNotMatch(cpvValidationRepair, /var tl = colLetter_\(cpvCol\)/);
  assert.match(cpvValidationRepair, /range\.getDataValidations\(\)/);
  assert.match(cpvValidationRepair, /backup\.hideSheet\(\)/);
  assert.match(cpvValidationRepair, /filter\.remove\(\)/);
  assert.match(cpvValidationRepair, /setColumnFilterCriteria\(item\.col, item\.criterion\)/);
  assert.match(cpvValidationRepair, /setAllowInvalid\(true\)/);
  assert.match(cpvValidationRepair, /ref_errors: refErrors/);
});

// 🚨 2026-08-21: 고정 인덱스 split("_")[8]이 바이럴 (배너)에서 어긋나 ".배너"가 캡션으로 잡혔다.
//   영상 ..._main.렉카_[8]캡션.디자인1.X_파인트P_이세진_260813_빙과_최재헌
//   배너 ..._마T기획_[8].배너_[9]캡션._(빈)_김바다_260810_빙과_오형선
//   소재명 끝이 항상 `_담당자_YYMMDD_빙과_이름`이라 6자리 날짜를 앵커로 삼는다(캡션 = 날짜-3).
//   실측 2,029건 중 1,585건 앵커 성공, 그중 1,345건은 기존 [8]과 같은 위치라 무회귀.
//   달라지는 240건은 전부 배너이며 ".배너" → 실제 캡션으로 교정된다.
test("captionFromAssetName_: 포맷 표식과 마지막 6자리 날짜 앵커 사이를 안전하게 추출", () => {
  const src = appsScript.slice(
    appsScript.indexOf("function captionFromAssetName_("),
    appsScript.indexOf("function fillCaptionFromAsset_()"),
  );
  assert.notEqual(src, "", "captionFromAssetName_ 함수가 있어야 한다");
  // 마지막 날짜 앵커와 영상/배너 포맷 표식을 모두 확인해야 한다.
  assert.ok(src.includes("/^\\d{6}$/"), "6자리 날짜 앵커 정규식이 있어야 한다");
  assert.match(src, /for \(var i = parts\.length - 1; i >= 0; i--\)/);
  assert.match(src, /\(\?:렉카\|릴스\|숏츠\|쇼츠\|영상\)/);
  assert.match(src, /배너/);
  assert.match(src, /parts\.slice\(markerIdx \+ 1, endExclusive\)/);
  // 바이럴은 포맷을 확정할 수 없으면 추측하지 않고, 비바이럴만 옛 [8] 호환을 유지한다.
  assert.match(src, /if \(!isViral\) return cleanAssetCaption_\(parts\[8\] \|\| ""\)/);
  assert.match(src, /if \(markerIdx < 0\) return ""/);
  // 파일명 버전표기 정리는 공용 클리너로 유지
  const cleaner = appsScript.slice(
    appsScript.indexOf("function cleanAssetCaption_("),
    appsScript.indexOf("function captionFromAssetName_("),
  );
  assert.match(cleaner, /디자인/);
  // fillCaptionFromAsset_는 이 헬퍼를 쓰고, 고정 인덱스를 직접 쓰지 않는다
  const filler = appsScript.slice(appsScript.indexOf("function fillCaptionFromAsset_()"));
  assert.match(filler, /captionFromAssetName_\(assets\[i\]\[0\], channelType\)/);
  assert.doesNotMatch(filler.slice(0, 2000), /split\("_"\)\[8\]/);
});
