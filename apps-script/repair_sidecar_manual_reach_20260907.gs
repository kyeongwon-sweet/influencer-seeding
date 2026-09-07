/**
 * 2026-09-07 골목대장 Sidecar 수기 도달수의 고아행 오입력을 URL 기준으로 복구한다.
 *
 * 배경:
 * - DB 정본은 ig:Dcz8HU6kRe7 / 2026-09-06 / reach=114525 / manual=true.
 * - 시트에서는 같은 값이 URL 없는 3990행에 들어가 formula-audit orphanRows=1을 만들었다.
 *
 * 안전장치:
 * - 대상 URL 1행, 날짜 헤더 1열, 고아행의 비URL/단일 날짜값을 모두 확인한 뒤에만 쓴다.
 * - 목표 셀은 공란 또는 같은 값일 때만 허용한다.
 * - 쓰기 전 두 행의 비어 있지 않은 셀/수식을 Script Properties에 백업한다.
 * - 성공 후 완료 마커를 남겨 이후 3시간 동기화·exportStats에서는 즉시 no-op 한다.
 */
const SIDECAR_REACH_REPAIR_20260907_ = {
  targetKey: "ig:Dcz8HU6kRe7",
  targetDate: "2026-09-06",
  value: 114525,
  orphanRow: 3990,
  backupProperty: "SIDECAR_REACH_REPAIR_20260907_BACKUP",
  doneProperty: "SIDECAR_REACH_REPAIR_20260907_DONE",
};

function compactNonemptyCells20260907_(values, formulas) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const formula = formulas[i];
    if ((value !== "" && value !== null) || formula) {
      out.push({ column: i + 1, value: value, formula: formula || "" });
    }
  }
  return out;
}

function dateColumnByIso20260907_(sheet, targetDate) {
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  let year = CONFIG.STATS_START_YEAR;
  let prevMonth = null;
  const hits = [];
  for (let c = CONFIG.STATS_FIRST_COL; c <= lastCol; c++) {
    const md = parseMonthDay_(header[c - 1]);
    if (!md) continue;
    if (prevMonth !== null && md.mo < prevMonth) year++;
    prevMonth = md.mo;
    const iso = `${year}-${("0" + md.mo).slice(-2)}-${("0" + md.da).slice(-2)}`;
    if (iso === targetDate) hits.push(c);
  }
  if (hits.length !== 1) throw new Error(`09-07 Sidecar 복구: 날짜열 ${targetDate} 매치 ${hits.length}건`);
  return hits[0];
}

function repairSidecarManualReachOrphan20260907_() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error("09-07 Sidecar 복구: 문서 잠금을 얻지 못했습니다.");
  try {
    return repairSidecarManualReachOrphanUnlocked20260907_();
  } finally {
    lock.releaseLock();
  }
}

function repairSidecarManualReachOrphanUnlocked20260907_() {
  const cfg = SIDECAR_REACH_REPAIR_20260907_;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(cfg.doneProperty)) return { status: "ALREADY_DONE" };

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < cfg.orphanRow) throw new Error(`09-07 Sidecar 복구: 고아행 ${cfg.orphanRow}이 lastRow ${lastRow} 밖입니다.`);

  const fieldCols = buildFieldCols_(sheet);
  const urlCol = fieldCols.url;
  const cumulativeCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  const incrementCol = getIncrementCol_(sheet);
  if (!urlCol || !cumulativeCol || !incrementCol) {
    throw new Error("09-07 Sidecar 복구: URL/H/I 헤더를 찾지 못했습니다.");
  }

  const urls = sheet.getRange(CONFIG.DATA_START_ROW, urlCol, lastRow - CONFIG.DATA_START_ROW + 1, 1)
    .getDisplayValues();
  const targetRows = [];
  for (let i = 0; i < urls.length; i++) {
    if (linkKey_(String(urls[i][0] || "")) === cfg.targetKey) targetRows.push(CONFIG.DATA_START_ROW + i);
  }
  if (targetRows.length !== 1) throw new Error(`09-07 Sidecar 복구: 대상 URL 매치 ${targetRows.length}건`);

  const targetRow = targetRows[0];
  if (targetRow === cfg.orphanRow) throw new Error("09-07 Sidecar 복구: 대상행과 고아행이 같습니다.");
  const dateCol = dateColumnByIso20260907_(sheet, cfg.targetDate);
  const targetMetric = sheet.getRange(targetRow, dateCol).getValue();
  const orphanUrl = String(sheet.getRange(cfg.orphanRow, urlCol).getDisplayValue() || "").trim();
  const orphanMetric = sheet.getRange(cfg.orphanRow, dateCol).getValue();

  const orphanRange = sheet.getRange(cfg.orphanRow, 1, 1, lastCol);
  const orphanValues = orphanRange.getValues()[0];
  const orphanFormulas = orphanRange.getFormulas()[0];
  const orphanNonempty = compactNonemptyCells20260907_(orphanValues, orphanFormulas);
  const allowedOrphanColumns = {};
  allowedOrphanColumns[cumulativeCol] = true;
  allowedOrphanColumns[incrementCol] = true;
  allowedOrphanColumns[dateCol] = true;
  const unexpectedOrphan = orphanNonempty.filter(function(cell) { return !allowedOrphanColumns[cell.column]; });

  if (orphanUrl) throw new Error(`09-07 Sidecar 복구: 고아행 URL이 비어 있지 않습니다: ${orphanUrl}`);
  if (Number(orphanMetric) !== cfg.value) {
    throw new Error(`09-07 Sidecar 복구: 고아행 ${cfg.targetDate} 값 ${orphanMetric} != ${cfg.value}`);
  }
  if (unexpectedOrphan.length) {
    throw new Error(`09-07 Sidecar 복구: 고아행 예상 밖 셀 ${JSON.stringify(unexpectedOrphan)}`);
  }
  if (!(targetMetric === "" || targetMetric === null || Number(targetMetric) === cfg.value)) {
    throw new Error(`09-07 Sidecar 복구: 목표 셀 기존값 ${targetMetric}은 덮을 수 없습니다.`);
  }

  const targetRange = sheet.getRange(targetRow, 1, 1, lastCol);
  const targetValues = targetRange.getValues()[0];
  const targetFormulas = targetRange.getFormulas()[0];
  props.setProperty(cfg.backupProperty, JSON.stringify({
    created_at: new Date().toISOString(),
    target_key: cfg.targetKey,
    target_date: cfg.targetDate,
    value: cfg.value,
    target_row: targetRow,
    orphan_row: cfg.orphanRow,
    date_column: dateCol,
    target_nonempty: compactNonemptyCells20260907_(targetValues, targetFormulas),
    orphan_nonempty: orphanNonempty,
  }));

  withAutoWriteGuard_(function() {
    sheet.getRange(targetRow, dateCol).setValue(cfg.value);
    orphanRange.clearContent();
  });
  SpreadsheetApp.flush();

  const finalTarget = sheet.getRange(targetRow, dateCol).getValue();
  const finalOrphan = orphanRange.getValues()[0];
  if (Number(finalTarget) !== cfg.value) throw new Error(`09-07 Sidecar 복구: 목표 셀 사후값 ${finalTarget}`);
  if (finalOrphan.some(function(value) { return value !== "" && value !== null; })) {
    throw new Error("09-07 Sidecar 복구: 고아행 clearContent 사후검증 실패");
  }

  const result = {
    status: "APPLIED",
    target_row: targetRow,
    orphan_row: cfg.orphanRow,
    date_column: dateCol,
    target_date: cfg.targetDate,
    value: cfg.value,
  };
  props.setProperty(cfg.doneProperty, JSON.stringify(Object.assign({ finished_at: new Date().toISOString() }, result)));
  Logger.log("sidecar_reach_repair_20260907 " + JSON.stringify(result));
  return result;
}

function runSidecarManualReachRepair20260907IfNeeded_() {
  try {
    return repairSidecarManualReachOrphan20260907_();
  } catch (error) {
    Logger.log("sidecar_reach_repair_20260907_skip " + dailyAutoErrorText_(error));
    return { status: "SKIPPED", error: dailyAutoErrorText_(error) };
  }
}
