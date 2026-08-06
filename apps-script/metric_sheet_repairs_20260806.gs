/**
 * 2026-08-06 metric formula + approved sheet repairs.
 * Live use: graft this file only. Do not replace the live main file wholesale.
 */

function metricDateColumns_(sheet) {
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cols = [];
  let year = CONFIG.STATS_START_YEAR;
  let prevMonth = null;
  for (let col = CONFIG.STATS_FIRST_COL; col <= headers.length; col++) {
    const md = parseMonthDay_(headers[col - 1]);
    if (!md) continue;
    if (prevMonth !== null && md.mo < prevMonth) year++;
    prevMonth = md.mo;
    const date = year + "-" + ("0" + md.mo).slice(-2) + "-" + ("0" + md.da).slice(-2);
    cols.push({ col: col, date: date, day: new Date(date + "T00:00:00+09:00").getDay() });
  }
  return cols;
}

function ensureNewRowsMetricFormulas_(sheet, startRow, endRow) {
  if (!sheet || startRow > endRow) return { cumulative: 0, increment: 0 };
  const dateCols = metricDateColumns_(sheet);
  if (!dateCols.length) return { cumulative: 0, increment: 0 };
  const firstCol = Math.min.apply(null, dateCols.map(function(x) { return x.col; }));
  const lastCol = Math.max.apply(null, dateCols.map(function(x) { return x.col; }));
  const firstLetter = colLetter_(firstCol);
  const lastLetter = colLetter_(lastCol);
  const cumulativeCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  const incrementCol = getIncrementCol_(sheet);
  let cumulative = 0;
  let increment = 0;
  for (let row = startRow; row <= endRow; row++) {
    if (cumulativeCol) {
      const cell = sheet.getRange(row, cumulativeCol);
      if (!cell.getFormula() && String(cell.getValue() == null ? "" : cell.getValue()).trim() === "") {
        cell.setFormula("=IF(COUNT(" + firstLetter + row + ":" + lastLetter + row + ")=0,\"\",MAX(" + firstLetter + row + ":" + lastLetter + row + "))");
        cumulative++;
      }
    }
    if (incrementCol) {
      const cell = sheet.getRange(row, incrementCol);
      if (!cell.getFormula() && String(cell.getValue() == null ? "" : cell.getValue()).trim() === "") {
        const rangeRef = "$" + firstLetter + row + ":$" + lastLetter + row;
        const firstRef = "$" + firstLetter + row;
        cell.setFormula(
          "=IFERROR(LET(rng," + rangeRef +
          ",cols,SEQUENCE(1,COLUMNS(rng),COLUMN(" + firstRef + "),1)" +
          ",lastC,MAX(FILTER(cols,rng>0))" +
          ",lastV,INDEX(rng,1,lastC-COLUMN(" + firstRef + ")+1)" +
          ",prev,FILTER(rng,cols<lastC,rng>0)" +
          ",IFERROR(MAX(0,lastV-MAX(prev)),lastV)),\"\")"
        );
        increment++;
      }
    }
  }
  SpreadsheetApp.flush();
  const result = { start_row: startRow, end_row: endRow, cumulative: cumulative, increment: increment };
  Logger.log("new_row_metric_formulas " + JSON.stringify(result));
  return result;
}

function setFormulaWithFilterRestore_(sheet, row, col, formula) {
  const filter = sheet.getFilter();
  if (!filter) {
    sheet.getRange(row, col).setFormula(formula);
    SpreadsheetApp.flush();
    return { filter_removed: false, criteria_restored: 0 };
  }

  const filterRange = filter.getRange();
  const rangeA1 = filterRange.getA1Notation();
  const firstCol = filterRange.getColumn();
  const lastCol = filterRange.getLastColumn();
  const criteria = [];
  for (let filterCol = firstCol; filterCol <= lastCol; filterCol++) {
    const criterion = filter.getColumnFilterCriteria(filterCol);
    if (criterion) criteria.push({ col: filterCol, criterion: criterion });
  }

  filter.remove();
  try {
    sheet.getRange(row, col).setFormula(formula);
    SpreadsheetApp.flush();
  } finally {
    const restoredFilter = sheet.getRange(rangeA1).createFilter();
    criteria.forEach(function(item) {
      restoredFilter.setColumnFilterCriteria(item.col, item.criterion);
    });
    SpreadsheetApp.flush();
  }
  return { filter_removed: true, criteria_restored: criteria.length, filter_range: rangeA1 };
}

function bannerFriSatReverseCandidates_() {
  const sheet = getSheet_();
  const typeCol = findHeaderCol_(sheet, ["채널분류", "채널 분류"]);
  const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
  if (!typeCol || !urlCol) throw new Error("채널분류/게시물URL 열을 찾지 못했습니다.");
  const dateCols = metricDateColumns_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return { sheet: sheet, urlCol: urlCol, lastRow: lastRow, candidates: [] };
  const data = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
  const candidates = [];
  for (let i = 0; i < data.length; i++) {
    const type = String(data[i][typeCol - 1] || "");
    const url = String(data[i][urlCol - 1] || "").trim();
    if (type.indexOf("배너") < 0 || url.toLowerCase().indexOf("instagram.com") < 0) continue;
    let peak = 0;
    dateCols.forEach(function(dc) {
      const value = data[i][dc.col - 1];
      if (value === "" || value == null || typeof value !== "number") return;
      if ((dc.day === 5 || dc.day === 6) && value < peak) {
        const row = CONFIG.DATA_START_ROW + i;
        candidates.push({ row: row, col: dc.col, a1: sheet.getRange(row, dc.col).getA1Notation(), date: dc.date, url: url, old: value, peak: peak });
      } else if (value > peak) {
        peak = value;
      }
    });
  }
  return { sheet: sheet, urlCol: urlCol, lastRow: lastRow, candidates: candidates };
}

function auditBannerFriSatReverse() {
  const found = bannerFriSatReverseCandidates_();
  const result = { candidates: found.candidates.length, samples: found.candidates.slice(0, 30) };
  Logger.log("banner_fri_sat_audit " + JSON.stringify(result));
  return result;
}

function clearBannerFriSatReverse() {
  return withDocLock_(function() {
    const found = bannerFriSatReverseCandidates_();
    const sheet = found.sheet;
    const candidates = found.candidates;
    if (!candidates.length) {
      const none = { cleared: 0, remaining: 0 };
      Logger.log("banner_fri_sat_clear " + JSON.stringify(none));
      return none;
    }
    assertRowCountStable_(sheet, found.lastRow, "clearBannerFriSatReverse");
    candidates.forEach(function(x) {
      const latestUrl = String(sheet.getRange(x.row, found.urlCol).getValue() || "").trim();
      const latestValue = sheet.getRange(x.row, x.col).getValue();
      if (linkKey_(latestUrl) !== linkKey_(x.url) || latestValue !== x.old) {
        throw new Error("정리 직전 행/값이 바뀌어 중단했습니다: " + x.a1);
      }
    });
    const stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    const backupName = "_codex_banner_fri_sat_backup_" + stamp;
    const backup = SpreadsheetApp.getActive().insertSheet(backupName);
    const backupRows = [["row", "cell", "date", "url", "old", "previous_peak"]].concat(
      candidates.map(function(x) { return [x.row, x.a1, x.date, x.url, x.old, x.peak]; })
    );
    backup.getRange(1, 1, backupRows.length, backupRows[0].length).setValues(backupRows);
    backup.hideSheet();
    sheet.getRangeList(candidates.map(function(x) { return x.a1; })).clearContent();
    SpreadsheetApp.flush();
    let remaining = 0;
    candidates.forEach(function(x) {
      if (String(sheet.getRange(x.a1).getValue() == null ? "" : sheet.getRange(x.a1).getValue()).trim() !== "") remaining++;
    });
    const result = { cleared: candidates.length - remaining, remaining: remaining, backup_sheet: backupName };
    Logger.log("banner_fri_sat_clear " + JSON.stringify(result));
    return result;
  });
}

function repairOharuCumulativePin() {
  return withDocLock_(function() {
    const sheet = getSheet_();
    const targetId = "7655695057189719304";
    const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
    const cumulativeCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
    if (!urlCol || !cumulativeCol) throw new Error("게시물URL/누적 조회수 열을 찾지 못했습니다.");
    const findTargetRows_ = function() {
      const lastRow = sheet.getLastRow();
      const urls = sheet.getRange(CONFIG.DATA_START_ROW, urlCol, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
      const rows = [];
      urls.forEach(function(r, i) {
        if (String(r[0] || "").indexOf(targetId) >= 0) rows.push(CONFIG.DATA_START_ROW + i);
      });
      return rows;
    };
    const dateCols = metricDateColumns_(sheet);
    const targetDate = dateCols.filter(function(x) { return x.date === "2026-07-28"; });
    if (targetDate.length !== 1) throw new Error("2026-07-28 날짜 열이 " + targetDate.length + "개라 중단했습니다.");
    const firstCol = Math.min.apply(null, dateCols.map(function(x) { return x.col; }));
    const lastCol = Math.max.apply(null, dateCols.map(function(x) { return x.col; }));

    // 백업 시트를 만든 뒤 URL로 행을 다시 찾는다. 사람이 정렬하는 동안 오래 기억한
    // 절대 행번호로 쓰면 바로 옆 게시물에 박힐 수 있으므로, 실제 쓰기 직전에 재확인한다.
    const stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    const backupName = "_codex_oharu_pin_backup_" + stamp;
    const backup = SpreadsheetApp.getActive().insertSheet(backupName);
    const rows = findTargetRows_();
    if (rows.length !== 1) throw new Error("오하루 대상 행이 " + rows.length + "건이라 중단했습니다.");
    const row = rows[0];
    const currentUrl = String(sheet.getRange(row, urlCol).getValue() || "");
    if (currentUrl.indexOf(targetId) < 0) throw new Error("쓰기 직전 오하루 URL 행이 이동해 중단했습니다.");
    const dailyValue = Number(sheet.getRange(row, targetDate[0].col).getValue());
    if (dailyValue !== 299600) throw new Error("오하루 2026-07-28 값이 299600이 아니라 " + dailyValue + "라 중단했습니다.");
    const cumulativeCell = sheet.getRange(row, cumulativeCol);
    const beforeValue = cumulativeCell.getValue();
    const beforeFormula = cumulativeCell.getFormula();
    if (beforeFormula && Number(beforeValue) === 299600) {
      const already = { row: row, before: beforeValue, after: beforeValue, formula: beforeFormula, already_repaired: true };
      Logger.log("oharu_cumulative_pin_repair " + JSON.stringify(already));
      SpreadsheetApp.getActive().deleteSheet(backup);
      return already;
    }
    backup.getRange(1, 1, 2, 6).setValues([
      ["row", "url", "cumulative_before", "formula_before", "2026-07-28", "target_formula"],
      [row, currentUrl, beforeValue, beforeFormula, dailyValue, "MAX(date range)"]
    ]);
    backup.hideSheet();
    const firstLetter = colLetter_(firstCol);
    const lastLetter = colLetter_(lastCol);
    const targetFormula = "=IF(COUNT(" + firstLetter + row + ":" + lastLetter + row + ")=0,\"\",MAX(" + firstLetter + row + ":" + lastLetter + row + "))";
    // 오하루 행은 기본 필터로 숨겨져 있어 Range 쓰기가 적용되지 않았다. 필터 기준을
    // 모두 보존해 잠깐 해제한 뒤 단일 셀을 쓰고 즉시 같은 기준으로 복원한다.
    const filterWrite = setFormulaWithFilterRestore_(sheet, row, cumulativeCol, targetFormula);
    SpreadsheetApp.flush();
    const urlAfter = String(sheet.getRange(row, urlCol).getValue() || "");
    const result = { row: row, url_after: urlAfter, before: beforeValue, after: cumulativeCell.getValue(), formula: cumulativeCell.getFormula(), filter_write: filterWrite, backup_sheet: backupName };
    if (urlAfter.indexOf(targetId) < 0 || Number(result.after) !== 299600 || !result.formula) throw new Error("오하루 누적 수식 검증 실패: " + JSON.stringify(result));
    Logger.log("oharu_cumulative_pin_repair " + JSON.stringify(result));
    return result;
  });
}

function auditOharuCumulativeState() {
  const sheet = getSheet_();
  const targetId = "7655695057189719304";
  const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
  const cumulativeCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  const lastRow = sheet.getLastRow();
  const urls = sheet.getRange(CONFIG.DATA_START_ROW, urlCol, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
  const rows = [];
  urls.forEach(function(r, i) { if (String(r[0] || "").indexOf(targetId) >= 0) rows.push(CONFIG.DATA_START_ROW + i); });
  const row = rows.length === 1 ? rows[0] : null;
  const dateCols = metricDateColumns_(sheet);
  const targetDate = dateCols.filter(function(x) { return x.date === "2026-07-28"; });
  const cell = row ? sheet.getRange(row, cumulativeCol) : null;
  const validation = cell ? cell.getDataValidation() : null;
  const result = {
    sheet_name: sheet.getName(),
    sheet_id: sheet.getSheetId(),
    rows: rows,
    cumulative_col: cumulativeCol,
    cumulative_header: cumulativeCol ? sheet.getRange(CONFIG.HEADER_ROW, cumulativeCol).getDisplayValue() : null,
    cumulative_a1: cell ? cell.getA1Notation() : null,
    cumulative_value: cell ? cell.getValue() : null,
    cumulative_display: cell ? cell.getDisplayValue() : null,
    cumulative_formula: cell ? cell.getFormula() : null,
    cumulative_merged: cell ? cell.isPartOfMerge() : null,
    cumulative_validation: validation ? String(validation.getCriteriaType()) : null,
    date_col_count: dateCols.length,
    first_date: dateCols.length ? dateCols[0] : null,
    last_date: dateCols.length ? dateCols[dateCols.length - 1] : null,
    target_date_col: targetDate.length === 1 ? targetDate[0].col : null,
    target_date_value: row && targetDate.length === 1 ? sheet.getRange(row, targetDate[0].col).getValue() : null
  };
  Logger.log("oharu_cumulative_state " + JSON.stringify(result));
  return result;
}
