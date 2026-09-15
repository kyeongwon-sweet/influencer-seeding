// H uses the existing generator. Only changed formulas are written; manual values are never written.
function writeCumulativeFormulaChanges_(sheet, range, values, formulas, expected, lastRow) {
  return withDocLock_(function() {
    const startRow = range.getRow();
    const col = range.getColumn();
    const edits = [];
    for (let i = 0; i < expected.length; i++) {
      const next = expected[i][0];
      const current = formulas[i][0];
      const standard = standardCumulativeFormulaParts_(current, startRow + i);
      const empty = !current && (values[i][0] === "" || values[i][0] == null);
      if ((standard || empty) && typeof next === "string" && next.charAt(0) === "=" && current !== next) {
        edits.push({ row: startRow + i, value: next });
      }
    }
    const result = { written: 0, verified: 0, manual_preserved: 0, filter_restored: false };
    if (!edits.length) return result;

    assertRowCountStable_(sheet, lastRow, "cumulative formula baseline");
    const currentValues = range.getValues();
    const currentFormulas = range.getFormulas();
    if (JSON.stringify(currentFormulas) !== JSON.stringify(formulas)) {
      throw new Error("H_FORMULAS_CHANGED: cumulative baseline changed before writing");
    }
    for (let i = 0; i < values.length; i++) {
      if (!formulas[i][0] && currentValues[i][0] !== values[i][0]) {
        throw new Error("H_MANUAL_CHANGED: manual value changed before writing");
      }
    }
    const filter = sheet.getFilter();
    let filterState = null;
    if (filter) {
      const filterRange = filter.getRange();
      const criteria = [];
      for (let c = filterRange.getColumn(); c <= filterRange.getLastColumn(); c++) {
        const criterion = filter.getColumnFilterCriteria(c);
        if (criterion) criteria.push({ col: c, criterion: criterion });
      }
      filterState = { range: filterRange.getA1Notation(), criteria: criteria };
      filter.remove();
      SpreadsheetApp.flush();
    }
    try {
      result.written = setCumulativeFormulaBatches_(sheet, col, edits, lastRow);
      SpreadsheetApp.flush();
    } finally {
      if (filterState) {
        const unexpected = sheet.getFilter();
        if (unexpected) unexpected.remove();
        const restored = sheet.getRange(filterState.range).createFilter();
        filterState.criteria.forEach(function(item) {
          restored.setColumnFilterCriteria(item.col, item.criterion);
        });
        SpreadsheetApp.flush();
        result.filter_restored = true;
      }
    }
    assertRowCountStable_(sheet, lastRow, "cumulative formula verification");
    const actualFormulas = range.getFormulas();
    const actualValues = range.getValues();
    const byRow = {};
    edits.forEach(function(edit) { byRow[edit.row] = edit.value; });
    for (let i = 0; i < formulas.length; i++) {
      const target = byRow[startRow + i] || formulas[i][0];
      if (actualFormulas[i][0] !== target) {
        throw new Error("H_FORMULA_WRITE_FAILED: row " + (startRow + i));
      }
      if (!target) {
        if (actualValues[i][0] !== values[i][0]) {
          throw new Error("H_MANUAL_WRITE_FAILED: row " + (startRow + i));
        }
        result.manual_preserved++;
      }
    }
    result.verified = edits.length;
    return result;
  });
}

function setCumulativeFormulaBatches_(sheet, col, edits, lastRow) {
  const groups = {};
  edits.forEach(function(edit) {
    const parts = standardCumulativeFormulaParts_(edit.value, edit.row);
    if (!parts) throw new Error("H_BATCH_FORMULA_NOT_STANDARD: row " + edit.row);
    const left = "RC[" + (metricColumnNumber_(parts.firstLetter) - col) + "]";
    const right = "RC[" + (metricColumnNumber_(parts.endLetter) - col) + "]";
    const formula = '=IF(COUNT(' + left + ':' + right + ')=0,"",MAX(' + left + ':' + right + '))';
    if (!groups[formula]) groups[formula] = [];
    groups[formula].push(colLetter_(col) + edit.row);
  });
  Object.keys(groups).forEach(function(formula) {
    const addresses = groups[formula];
    for (let start = 0; start < addresses.length; start += 500) {
      assertRowCountStable_(sheet, lastRow, "cumulative formula batch");
      sheet.getRangeList(addresses.slice(start, start + 500)).setFormulaR1C1(formula);
    }
  });
  return edits.length;
}

function cumulativeIntegritySnapshot_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const hCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  const iCol = getIncrementCol_(sheet);
  const fields = buildFieldCols_(sheet);
  if (!n || !hCol || !iCol || !fields.url) throw new Error("H_AUDIT_HEADERS_MISSING");
  const dateCols = metricDateColumns_(sheet);
  const latest = dateCols[dateCols.length - 1];
  if (!latest) throw new Error("H_AUDIT_DATES_MISSING");
  const dataRange = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol);
  const values = dataRange.getValues();
  const allFormulas = dataRange.getFormulas();
  const hFormulas = allFormulas.map(function(row) { return [row[hCol - 1]]; });
  const iFormulas = allFormulas.map(function(row) { return [row[iCol - 1]]; });
  const stale = [];
  for (let i = 0; i < n; i++) {
    const row = CONFIG.DATA_START_ROW + i;
    const parts = standardCumulativeFormulaParts_(hFormulas[i][0], row);
    if (parts && metricColumnNumber_(parts.endLetter) < latest.col) {
      stale.push({ row: row, key: linkKey_(values[i][fields.url - 1]), formula: hFormulas[i][0], value: values[i][hCol - 1] });
    }
  }
  return { sheet: sheet, lastRow: lastRow, latest: latest, stale: stale, values: values, allFormulas: allFormulas, hFormulas: hFormulas, iFormulas: iFormulas };
}

function verifyCumulativeSourceCells_(before, after, hCol) {
  if (after.lastRow !== before.lastRow || JSON.stringify(after.iFormulas) !== JSON.stringify(before.iFormulas)) {
    throw new Error("H_REFRESH_CANARY_FAILED: row count or I formulas changed");
  }
  for (let i = 0; i < before.values.length; i++) {
    for (let c = 0; c < before.values[i].length; c++) {
      const formula = before.allFormulas[i][c];
      if (c === hCol - 1) {
        if ((!formula && (after.allFormulas[i][c] || JSON.stringify(after.values[i][c]) !== JSON.stringify(before.values[i][c]))) ||
            (formula && !standardCumulativeFormulaParts_(formula, CONFIG.DATA_START_ROW + i) && after.allFormulas[i][c] !== formula)) {
          throw new Error("H_REFRESH_CANARY_FAILED: manual or custom H changed at row " + (CONFIG.DATA_START_ROW + i));
        }
        continue;
      }
      // CPV and other H-dependent outputs may recalculate, but their formulas must not change.
      if (after.allFormulas[i][c] !== formula ||
          (!formula && JSON.stringify(after.values[i][c]) !== JSON.stringify(before.values[i][c]))) {
        throw new Error("H_REFRESH_CANARY_FAILED: non-H cell changed at row " + (CONFIG.DATA_START_ROW + i) + " col " + (c + 1));
      }
    }
  }
}

function auditCumulativeFormulaIntegrity() {
  const snapshot = cumulativeIntegritySnapshot_();
  const props = PropertiesService.getScriptProperties();
  Logger.log("cumulative_integrity_audit " + JSON.stringify({
    rows: snapshot.values.length,
    latest: snapshot.latest,
    stale_count: snapshot.stale.length,
    stale_samples: snapshot.stale.slice(0, 3),
    filter_range: snapshot.sheet.getFilter() ? snapshot.sheet.getFilter().getRange().getA1Notation() : null,
    dailyAuto_status: props.getProperty("DAILY_AUTO_LAST_STATUS"),
  }));
}

// Native formula conversion check in a new, tiny test file; never uses the linked sheet.
function testCumulativeFormulaBatchReference() {
  const file = SpreadsheetApp.create("C16_formula_reference_sandbox", 3, 137);
  const sheet = file.getSheets()[0];
  sheet.getRange("P2").setValue(10);
  sheet.getRange("EF2").setValue(12);
  sheet.getRange("P3").setValue(20);
  sheet.getRange("EG3").setValue(25);
  const edits = [
    { row: 2, value: metricCumulativeFormula_(2, "P", "EF") },
    { row: 3, value: metricCumulativeFormula_(3, "P", "EG") },
  ];
  setCumulativeFormulaBatches_(sheet, 8, edits, 3);
  SpreadsheetApp.flush();
  const formulas = sheet.getRange("H2:H3").getFormulas();
  const values = sheet.getRange("H2:H3").getValues();
  if (formulas[0][0] !== edits[0].value || formulas[1][0] !== edits[1].value || values[0][0] !== 12 || values[1][0] !== 25) {
    throw new Error("H_NATIVE_REFERENCE_TEST_FAILED");
  }
  Logger.log("cumulative_native_reference_test " + JSON.stringify({ status: "OK", fileId: file.getId(), tested_ranges: ["P:EF", "P:EG"] }));
}

// Operator-only H backup and guarded refresh. I and every non-H cell are verified unchanged.
function backupAndRefreshCumulativeFormulaIntegrity() {
  return withAutoWriteGuard_(function() { return withDocLock_(function() {
    const before = cumulativeIntegritySnapshot_();
    const hCol = findHeaderCol_(before.sheet, ["누적 조회수", "누적조회수"]);
    const stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    const fields = buildFieldCols_(before.sheet);
    const rows = [["source_row", "url", "H_value", "H_formula_text", "I_formula_text"]];
    before.values.forEach(function(row, i) {
      rows.push([CONFIG.DATA_START_ROW + i, row[fields.url - 1], row[hCol - 1],
        before.hFormulas[i][0] ? "'" + before.hFormulas[i][0] : "",
        before.iFormulas[i][0] ? "'" + before.iFormulas[i][0] : ""]);
    });
    // Separate file avoids the source spreadsheet cell cap and requires no additional Drive scope.
    const file = SpreadsheetApp.create("cumulative_H_backup_" + stamp, rows.length, rows[0].length);
    const backupRange = file.getSheets()[0].getRange(1, 1, rows.length, rows[0].length);
    backupRange.setValues(rows);
    SpreadsheetApp.flush();
    const saved = backupRange.getValues();
    for (let i = 1; i < saved.length; i++) {
      if (saved[i][0] !== rows[i][0] || saved[i][1] !== rows[i][1] || saved[i][2] !== rows[i][2] ||
          saved[i][3] !== before.hFormulas[i - 1][0] || saved[i][4] !== before.iFormulas[i - 1][0]) {
        throw new Error("H_BACKUP_VERIFY_FAILED: source row " + rows[i][0]);
      }
    }
    Logger.log("cumulative_integrity_backup " + JSON.stringify({ fileId: file.getId(), url: file.getUrl(), rows: before.values.length }));
    refreshCumulativeViews();
    SpreadsheetApp.flush();
    const after = cumulativeIntegritySnapshot_();
    verifyCumulativeSourceCells_(before, after, hCol);
    Logger.log("cumulative_integrity_refresh " + JSON.stringify({
      status: after.stale.length ? "STALE_REMAINS" : "OK", stale_before: before.stale.length,
      stale_after: after.stale.length, fileId: file.getId(), non_h_unchanged: true,
      manual_preserved: before.hFormulas.filter(function(row) { return !row[0]; }).length,
    }));
  }); });
}
