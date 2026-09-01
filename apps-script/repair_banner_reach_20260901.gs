/**
 * 8282__humor 배너 도달수 1셀 복구.
 *
 * 사용자 확정 정본 31,186을 2026-08-30 날짜셀에만 기록한다. H(누적)는
 * 기존 MAX 수식의 계산 결과로만 갱신하며 이 스크립트가 H를 쓰지 않는다.
 */

const BANNER_REACH_REPAIR_20260901_ = Object.freeze({
  key: "ig:Dbx04ORkiHK",
  date: "2026-08-30",
  value: 31186,
  cumulativeCol: 8,
  backupPrefix: "_codex_banner_31186_backup_20260901",
});

function bannerReachRepairSnapshot20260901_() {
  const target = BANNER_REACH_REPAIR_20260901_;
  const sheet = getSheet_();
  const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
  if (!urlCol) throw new Error("게시물 URL 열을 찾지 못했습니다.");

  const dateColumn = metricDateColumns_(sheet).filter(function(item) {
    return item.date === target.date;
  });
  if (dateColumn.length !== 1) {
    throw new Error("대상 날짜열 수 불일치: " + dateColumn.length);
  }

  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  const urls = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, urlCol, rowCount, 1).getValues()
    : [];
  const rows = [];
  urls.forEach(function(item, index) {
    if (String(linkKey_(String(item[0] || "").trim()) || "") === target.key) {
      rows.push(CONFIG.DATA_START_ROW + index);
    }
  });
  if (rows.length !== 1) throw new Error("대상 URL-key 행 수 불일치: " + rows.length);

  const row = rows[0];
  const metricRange = sheet.getRange(row, dateColumn[0].col);
  const cumulativeRange = sheet.getRange(row, target.cumulativeCol);
  const cumulativeFormula = cumulativeRange.getFormula();
  if (!cumulativeFormula || cumulativeFormula.charAt(0) !== "=") {
    throw new Error("H 누적셀이 수식이 아닙니다: " + cumulativeRange.getA1Notation());
  }

  const dateColumns = metricDateColumns_(sheet);
  const dateValues = dateColumns.map(function(item) {
    const value = Number(sheet.getRange(row, item.col).getValue()) || null;
    return { col: item.col, value: value };
  });
  return {
    sheet: sheet,
    lastRow: lastRow,
    urlCol: urlCol,
    row: row,
    key: target.key,
    url: String(sheet.getRange(row, urlCol).getValue() || "").trim(),
    metricA1: metricRange.getA1Notation(),
    metricValue: metricRange.getValue(),
    metricCol: dateColumn[0].col,
    cumulativeA1: cumulativeRange.getA1Notation(),
    cumulativeValue: cumulativeRange.getValue(),
    cumulativeFormula: cumulativeFormula,
    legacy29133Cells: dateValues.filter(function(item) { return item.value === 29133; }).length,
    legacy35289Cells: dateValues.filter(function(item) { return item.value === 35289; }).length,
    aboveCanonicalCells: dateValues.filter(function(item) { return item.value > target.value; }).length,
    otherAboveCanonicalCells: dateValues.filter(function(item) {
      return item.col !== dateColumn[0].col && item.value > target.value;
    }).length,
  };
}

function bannerReachRepairBackup20260901_(snapshot) {
  const ss = snapshot.sheet.getParent();
  let name = BANNER_REACH_REPAIR_20260901_.backupPrefix;
  let suffix = 2;
  while (ss.getSheetByName(name)) {
    name = BANNER_REACH_REPAIR_20260901_.backupPrefix + "_" + suffix;
    suffix++;
  }
  const backup = ss.insertSheet(name);
  backup.getRange(1, 1, 2, 11).setValues([
    ["backed_up_at", "row", "url", "key", "date", "metric_a1", "old_metric", "new_metric", "h_a1", "h_value", "h_formula"],
    [new Date().toISOString(), snapshot.row, snapshot.url, snapshot.key,
      BANNER_REACH_REPAIR_20260901_.date, snapshot.metricA1, snapshot.metricValue,
      BANNER_REACH_REPAIR_20260901_.value, snapshot.cumulativeA1,
      snapshot.cumulativeValue, snapshot.cumulativeFormula],
  ]);
  backup.hideSheet();
  SpreadsheetApp.flush();
  return name;
}

function auditBannerReachRepair20260901() {
  const snapshot = bannerReachRepairSnapshot20260901_();
  const out = {
    dry_run: true,
    row: snapshot.row,
    url: snapshot.url,
    metric_a1: snapshot.metricA1,
    metric_value: snapshot.metricValue,
    h_a1: snapshot.cumulativeA1,
    h_value: snapshot.cumulativeValue,
    h_formula: snapshot.cumulativeFormula,
    legacy_29133_cells: snapshot.legacy29133Cells,
    legacy_35289_cells: snapshot.legacy35289Cells,
    above_canonical_cells: snapshot.aboveCanonicalCells,
    other_above_canonical_cells: snapshot.otherAboveCanonicalCells,
  };
  Logger.log("banner_reach_repair_20260901_audit " + JSON.stringify(out));
  return out;
}

function repairBannerReach20260901() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const target = BANNER_REACH_REPAIR_20260901_;
    const before = bannerReachRepairSnapshot20260901_();
    const oldMetric = before.metricValue === "" || before.metricValue === null
      ? null
      : Number(before.metricValue);
    const allowed = [null, 29133, 35289, target.value];
    if (allowed.indexOf(oldMetric) < 0) {
      throw new Error("허용되지 않은 기존값: " + before.metricValue);
    }
    if (before.otherAboveCanonicalCells !== 0) {
      throw new Error("대상 날짜 외 상향 잔재 감지: " + before.otherAboveCanonicalCells);
    }
    if (Number(before.metricValue) === target.value &&
        Number(before.cumulativeValue) === target.value &&
        before.aboveCanonicalCells === 0) {
      return { changed: false, already_correct: true, row: before.row, metric_a1: before.metricA1 };
    }

    assertRowCountStable_(before.sheet, before.lastRow, "repairBannerReach20260901");
    const currentKey = String(linkKey_(String(
      before.sheet.getRange(before.row, before.urlCol).getValue() || ""
    ).trim()) || "");
    if (currentKey !== target.key) throw new Error("쓰기 직전 URL-key 변경 감지");
    if (before.sheet.getRange(before.cumulativeA1).getFormula() !== before.cumulativeFormula) {
      throw new Error("쓰기 직전 H 수식 변경 감지");
    }

    const backupName = bannerReachRepairBackup20260901_(before);
    before.sheet.getRange(before.metricA1).setValue(target.value);
    SpreadsheetApp.flush();

    const after = bannerReachRepairSnapshot20260901_();
    if (Number(after.metricValue) !== target.value) throw new Error("날짜셀 사후검증 실패");
    if (after.cumulativeFormula !== before.cumulativeFormula) throw new Error("H 수식이 변경됐습니다");
    if (Number(after.cumulativeValue) !== target.value) throw new Error("H 계산값 사후검증 실패");
    if (after.aboveCanonicalCells !== 0 || after.legacy35289Cells !== 0) {
      throw new Error("상향 잔재가 남았습니다");
    }

    const out = {
      changed: true,
      backup_sheet: backupName,
      row: after.row,
      metric_a1: after.metricA1,
      metric_value: after.metricValue,
      h_a1: after.cumulativeA1,
      h_value: after.cumulativeValue,
      h_formula_preserved: after.cumulativeFormula === before.cumulativeFormula,
      legacy_29133_cells: after.legacy29133Cells,
      legacy_35289_cells: after.legacy35289Cells,
      above_canonical_cells: after.aboveCanonicalCells,
    };
    Logger.log("banner_reach_repair_20260901_result " + JSON.stringify(out));
    return out;
  } finally {
    lock.releaseLock();
  }
}
