/**
 * 2026-08-27 latest-date carry-forward and cross-post metric contamination repair.
 *
 * Approved scope:
 * - Clear only 2026-08-27 cells that equal 2026-08-26 while DB has a different
 *   value (or no value) for 2026-08-27.
 * - Also clear the known Meokrini-value contamination on three exact post keys
 *   for 2026-08-26/27.
 * - Rehydrate exclusively through exportStats(); never invent a metric.
 */

const METRIC_REPAIR_20260828_PREV_DATE_ = "2026-08-26";
const METRIC_REPAIR_20260828_TARGET_DATE_ = "2026-08-27";
const METRIC_REPAIR_20260828_BACKUP_SHEET_ = "_codex_metric_0827_backup_20260828";
const METRIC_REPAIR_20260828_EXPLICIT_ = {
  "tt:7677553177486478599": {
    "2026-08-26": [466637],
    "2026-08-27": [633000, 633374],
  },
  "ig:Db5iVQYhJT5": {
    "2026-08-26": [466637],
    "2026-08-27": [633000, 633374],
  },
  "ig:Db5fNo6k6bI": {
    "2026-08-26": [466637],
    "2026-08-27": [633000, 633374],
  },
};

function metricRepairNumber_(value) {
  if (typeof value === "number" && isFinite(value)) return value;
  const text = String(value == null ? "" : value).replace(/[,\s]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}

function shouldClear20260827Carry_(previousValue, targetValue, expectedValue) {
  const previous = metricRepairNumber_(previousValue);
  const target = metricRepairNumber_(targetValue);
  const expected = metricRepairNumber_(expectedValue);
  if (!(previous > 0) || !(target > 0) || target !== previous) return false;
  return !(expected > 0 && expected === target);
}

function shouldClear20260828Explicit_(key, date, value) {
  const byDate = METRIC_REPAIR_20260828_EXPLICIT_[String(key || "")];
  if (!byDate || !byDate[date]) return false;
  const number = metricRepairNumber_(value);
  return byDate[date].indexOf(number) >= 0;
}

function metricRepair20260828ExpectedByKey_() {
  const out = {};
  fetchCollectedStats_().forEach(function(post) {
    const key = String(post.key || linkKey_(post.url) || "");
    if (!key) return;
    const dates = {};
    (post.stats || []).forEach(function(stat) {
      if (!stat || stat.length < 2) return;
      const value = metricRepairNumber_(stat[1]);
      if (value != null) dates[String(stat[0])] = value;
    });
    out[key] = dates;
  });
  return out;
}

function metricRepair20260828Candidates_() {
  const sheet = getSheet_();
  const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
  if (!urlCol) throw new Error("게시물 URL 열을 찾지 못했습니다.");

  const dates = metricDateColumns_(sheet);
  const previousCol = dates.filter(function(item) {
    return item.date === METRIC_REPAIR_20260828_PREV_DATE_;
  })[0];
  const targetCol = dates.filter(function(item) {
    return item.date === METRIC_REPAIR_20260828_TARGET_DATE_;
  })[0];
  if (!previousCol || !targetCol) {
    throw new Error("2026-08-26/27 날짜 열을 찾지 못했습니다.");
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) {
    return { sheet: sheet, lastRow: lastRow, previousCol: previousCol.col, targetCol: targetCol.col, edits: [] };
  }
  const rowCount = lastRow - CONFIG.DATA_START_ROW + 1;
  const urls = sheet.getRange(CONFIG.DATA_START_ROW, urlCol, rowCount, 1).getValues();
  const previous = sheet.getRange(CONFIG.DATA_START_ROW, previousCol.col, rowCount, 1).getValues();
  const target = sheet.getRange(CONFIG.DATA_START_ROW, targetCol.col, rowCount, 1).getValues();
  const expectedByKey = metricRepair20260828ExpectedByKey_();
  const editsByA1 = {};

  function add(row, col, date, key, url, oldValue, reason, expected) {
    const a1 = sheet.getRange(row, col).getA1Notation();
    editsByA1[a1] = {
      row: row,
      col: col,
      a1: a1,
      date: date,
      key: key,
      url: url,
      old: oldValue,
      reason: reason,
      expected: expected == null ? "" : expected,
    };
  }

  for (let i = 0; i < rowCount; i++) {
    const row = CONFIG.DATA_START_ROW + i;
    const url = String(urls[i][0] || "").trim();
    const key = String(linkKey_(url) || "");
    if (!key) continue;
    const expected = expectedByKey[key] || {};
    const previousValue = previous[i][0];
    const targetValue = target[i][0];

    if (shouldClear20260827Carry_(previousValue, targetValue, expected[METRIC_REPAIR_20260828_TARGET_DATE_])) {
      add(row, targetCol.col, METRIC_REPAIR_20260828_TARGET_DATE_, key, url, targetValue,
        "carry_forward_differs_from_db", expected[METRIC_REPAIR_20260828_TARGET_DATE_]);
    }
    if (shouldClear20260828Explicit_(key, METRIC_REPAIR_20260828_PREV_DATE_, previousValue)) {
      add(row, previousCol.col, METRIC_REPAIR_20260828_PREV_DATE_, key, url, previousValue,
        "known_cross_post_contamination", expected[METRIC_REPAIR_20260828_PREV_DATE_]);
    }
    if (shouldClear20260828Explicit_(key, METRIC_REPAIR_20260828_TARGET_DATE_, targetValue)) {
      add(row, targetCol.col, METRIC_REPAIR_20260828_TARGET_DATE_, key, url, targetValue,
        "known_cross_post_contamination", expected[METRIC_REPAIR_20260828_TARGET_DATE_]);
    }
  }

  return {
    sheet: sheet,
    lastRow: lastRow,
    previousCol: previousCol.col,
    targetCol: targetCol.col,
    edits: Object.keys(editsByA1).sort().map(function(a1) { return editsByA1[a1]; }),
  };
}

function metricRepair20260828Backup_(sheet, edits) {
  const ss = sheet.getParent();
  if (ss.getSheetByName(METRIC_REPAIR_20260828_BACKUP_SHEET_)) {
    throw new Error("백업 시트가 이미 존재합니다: " + METRIC_REPAIR_20260828_BACKUP_SHEET_);
  }
  const backup = ss.insertSheet(METRIC_REPAIR_20260828_BACKUP_SHEET_);
  const rows = [["backed_up_at", "row", "a1", "date", "url", "key", "old", "db_expected", "reason"]];
  const now = new Date().toISOString();
  edits.forEach(function(edit) {
    rows.push([now, edit.row, edit.a1, edit.date, edit.url, edit.key, edit.old, edit.expected, edit.reason]);
  });
  backup.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  backup.hideSheet();
  SpreadsheetApp.flush();
  return backup.getName();
}

function runMetricRepair20260828_(apply) {
  const scan = metricRepair20260828Candidates_();
  const explicit = scan.edits.filter(function(edit) { return edit.reason === "known_cross_post_contamination"; });
  const result = {
    dry_run: !apply,
    candidates: scan.edits.length,
    carry_forward: scan.edits.length - explicit.length,
    explicit: explicit.length,
    explicit_keys: explicit.map(function(edit) { return edit.key + "@" + edit.date; }),
    sample: scan.edits.slice(0, 20),
  };
  Logger.log("metric_repair_20260828_scan " + JSON.stringify(result));
  if (!apply || !scan.edits.length) return result;

  assertRowCountStable_(scan.sheet, scan.lastRow);
  result.backup_sheet = metricRepair20260828Backup_(scan.sheet, scan.edits);
  const byCol = {};
  scan.edits.forEach(function(edit) {
    (byCol[edit.col] || (byCol[edit.col] = [])).push({ row: edit.row, value: "" });
  });
  Object.keys(byCol).forEach(function(col) {
    writeColumnRuns_(scan.sheet, Number(col), byCol[col], scan.lastRow);
  });
  SpreadsheetApp.flush();

  const remaining = scan.edits.filter(function(edit) {
    return scan.sheet.getRange(edit.a1).getValue() !== "";
  });
  if (remaining.length) throw new Error("오염칸 비우기 검증 실패: " + remaining.slice(0, 5).map(function(x) { return x.a1; }).join(","));

  const exported = exportStats();
  if (exported === false) throw new Error("exportStats returned false");
  SpreadsheetApp.flush();
  result.exported = true;
  result.post_values = explicit.map(function(edit) {
    return { key: edit.key, date: edit.date, a1: edit.a1, value: scan.sheet.getRange(edit.a1).getValue() };
  });
  Logger.log("metric_repair_20260828_result " + JSON.stringify(result));
  return result;
}

function auditMetricRepair20260828() {
  return runMetricRepair20260828_(false);
}

function repairMetricContamination20260828() {
  return runMetricRepair20260828_(true);
}
