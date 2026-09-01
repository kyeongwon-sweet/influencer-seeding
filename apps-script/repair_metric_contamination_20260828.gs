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
const METRIC_REPAIR_20260828_BACKUP_SHEET_ = "_codex_metric_0901_backup_20260901";
const DAILY_METRIC_SYNC_BACKUP_PREFIX_ = "_codex_daily_sync_backup_20260901";
const METRIC_REPAIR_20260828_DB_CONFIRM_ = "repair-2026-08-27-metric-contamination";
const METRIC_REPAIR_20260901_DELETE_COUNT_ = 19;
const METRIC_REPAIR_20260901_SHEET_CLEAR_COUNT_ = 7;
const METRIC_REPAIR_20260828_EXPLICIT_ = {
  "tt:7677553177486478599": {
    "2026-08-26": [466637],
    "2026-08-27": [633000, 633374],
  },
  "tt:7677969398061141255": {
    "2026-08-26": [116853], "2026-08-27": [116853], "2026-08-28": [116853],
    "2026-08-29": [116853], "2026-08-30": [116853], "2026-08-31": [116853],
  },
  "tt:7669021425163881746": {
    "2026-08-26": [97643], "2026-08-27": [97643], "2026-08-28": [97643],
    "2026-08-29": [97643], "2026-08-30": [97643], "2026-08-31": [97643],
  },
  "yt:GBWxY0RlRqA": {
    "2026-08-26": [97643],
    "2026-08-27": [149000], "2026-08-28": [149000], "2026-08-29": [149000],
    "2026-08-30": [149000], "2026-08-31": [149000],
  },
  "ig:Db5iVQYhJT5": {
    "2026-08-26": [466637],
    "2026-08-27": [633000, 633374],
  },
  "ig:Db5fNo6k6bI": {
    "2026-08-26": [466637],
    "2026-08-27": [633000, 633374],
    "2026-08-28": [633000, 633374],
    "2026-08-29": [633000, 633374],
    "2026-08-30": [633000, 633374],
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

function dailyMetricSyncDecision20260901_(sheetValue, expectedValue, expectedManual,
    previousSheetValue, previousExpectedValue, previousExpectedManual, previousWasProvenCarry) {
  const current = metricRepairNumber_(sheetValue);
  const expected = metricRepairNumber_(expectedValue);
  if (expected > 0) {
    if (current == null) return { action: "set_db", reason: "db_fill" };
    if (current === expected) return { action: "none", reason: "same" };
    if (expectedManual === true) return { action: "none", reason: "manual_preserved" };
    return { action: "set_db", reason: "auto_mismatch" };
  }

  const previousSheet = metricRepairNumber_(previousSheetValue);
  const previousExpected = metricRepairNumber_(previousExpectedValue);
  const continuesAutomaticChain = previousExpected === current && previousExpectedManual === false;
  if (current > 0 && previousSheet === current && (continuesAutomaticChain || previousWasProvenCarry === true)) {
    return { action: "clear", reason: "proven_carry" };
  }
  return current > 0
    ? { action: "none", reason: "sheet_only_unproven" }
    : { action: "none", reason: "blank" };
}

function isDeleteTarget20260901_(key, date) {
  if (key === "tt:7677553177486478599") return date === "2026-08-26";
  if (key === "tt:7677969398061141255" || key === "tt:7669021425163881746") {
    return date >= "2026-08-26" && date <= "2026-08-31";
  }
  if (key === "yt:GBWxY0RlRqA") return date >= "2026-08-26" && date <= "2026-08-31";
  return false;
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
  const dateByName = {};
  dates.forEach(function(item) { dateByName[item.date] = item; });
  const explicitDates = {};
  Object.keys(METRIC_REPAIR_20260828_EXPLICIT_).forEach(function(key) {
    Object.keys(METRIC_REPAIR_20260828_EXPLICIT_[key]).forEach(function(date) { explicitDates[date] = true; });
  });
  const explicitValues = {};
  Object.keys(explicitDates).forEach(function(date) {
    const item = dateByName[date];
    if (!item) throw new Error(date + " 날짜 열을 찾지 못했습니다.");
    explicitValues[date] = {
      col: item.col,
      values: sheet.getRange(CONFIG.DATA_START_ROW, item.col, rowCount, 1).getValues(),
    };
  });
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
    Object.keys(explicitValues).forEach(function(date) {
      const item = explicitValues[date];
      const value = item.values[i][0];
      if (!shouldClear20260828Explicit_(key, date, value)) return;
      add(row, item.col, date, key, url, value,
        "known_cross_post_contamination", expected[date]);
    });
  }

  return {
    sheet: sheet,
    lastRow: lastRow,
    previousCol: previousCol.col,
    targetCol: targetCol.col,
    edits: Object.keys(editsByA1).sort().map(function(a1) { return editsByA1[a1]; }),
  };
}

function metricRepair20260828Backup_(sheet, edits, dbRows) {
  const ss = sheet.getParent();
  let backupName = METRIC_REPAIR_20260828_BACKUP_SHEET_;
  let suffix = 2;
  while (ss.getSheetByName(backupName)) {
    backupName = METRIC_REPAIR_20260828_BACKUP_SHEET_ + "_" + suffix;
    suffix++;
  }
  const backup = ss.insertSheet(backupName);
  const dbByTarget = {};
  (dbRows || []).forEach(function(item) {
    dbByTarget[[item.normalizedKey, item.measuredAt, item.field].join("|")] = item.statSnapshot || null;
  });
  const rows = [["backed_up_at", "row", "a1", "date", "url", "key", "old", "db_expected", "reason", "db_stat_snapshot"]];
  const now = new Date().toISOString();
  edits.forEach(function(edit) {
    const snapshot = dbByTarget[[edit.key, edit.date, "play_count"].join("|")]
      || dbByTarget[[edit.key, edit.date, "reach_count"].join("|")]
      || null;
    rows.push([now, edit.row, edit.a1, edit.date, edit.url, edit.key, edit.old, edit.expected, edit.reason,
      snapshot ? JSON.stringify(snapshot) : ""]);
  });
  backup.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  backup.hideSheet();
  SpreadsheetApp.flush();
  return backup.getName();
}

function metricContaminationDbRepairUrl20260828_() {
  const url = String(CONFIG.STATS_EXPORT_API_URL || "")
    .replace(/\/api\/sponsored-posts\/stats-for-sheet(?:\?.*)?$/, "/api/ops/repair-metric-contamination");
  if (!/\/api\/ops\/repair-metric-contamination$/.test(url)) {
    throw new Error("DB 오염 복구 API URL을 만들지 못했습니다.");
  }
  return url;
}

function requestMetricContaminationDbRepair20260828_(apply) {
  const options = {
    method: apply ? "post" : "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  };
  if (apply) {
    options.contentType = "application/json";
    options.payload = JSON.stringify({ confirm: METRIC_REPAIR_20260828_DB_CONFIRM_ });
  }
  const response = UrlFetchApp.fetch(metricContaminationDbRepairUrl20260828_(), options);
  const code = response.getResponseCode();
  const body = JSON.parse(response.getContentText() || "{}");
  if (code !== 200 || (apply && body.ok !== true)) {
    throw new Error("DB 오염 복구 실패 API " + code + ": " + JSON.stringify(body));
  }
  return body;
}

function auditMetricContaminationDb20260828() {
  const result = requestMetricContaminationDbRepair20260828_(false);
  const repairable = (result.rows || []).filter(function(row) { return row.status === "repairable"; });
  Logger.log("metric_contamination_db_audit " + JSON.stringify({
    total_targets: (result.rows || []).length,
    repairable: repairable.length,
    delete_rows: repairable.filter(function(row) { return row.action === "delete_row"; }).length,
    manual_true: repairable.filter(function(row) { return row.manual === true; }).length,
    rows: repairable.map(function(row) {
      return { key: row.normalizedKey, date: row.measuredAt, value: row.value, manual: row.manual, action: row.action };
    }),
  }));
  return result;
}

function repairMetricContaminationDb20260828_() {
  return requestMetricContaminationDbRepair20260828_(true);
}

function runMetricRepair20260828_(apply) {
  const scan = metricRepair20260828Candidates_();
  const explicit = scan.edits.filter(function(edit) { return edit.reason === "known_cross_post_contamination"; });
  const deleteEdits = explicit.filter(function(edit) { return isDeleteTarget20260901_(edit.key, edit.date); });
  const result = {
    dry_run: !apply,
    candidates: scan.edits.length,
    carry_forward: scan.edits.length - explicit.length,
    explicit: explicit.length,
    delete_rows: deleteEdits.length,
    explicit_keys: explicit.map(function(edit) { return edit.key + "@" + edit.date; }),
    sample: scan.edits.slice(0, 20),
  };
  Logger.log("metric_repair_20260828_scan " + JSON.stringify(result));
  if (!apply || !scan.edits.length) return result;

  if (deleteEdits.length !== METRIC_REPAIR_20260901_SHEET_CLEAR_COUNT_) {
    throw new Error("삭제 대상 시트 셀 수 불일치: expected=" + METRIC_REPAIR_20260901_SHEET_CLEAR_COUNT_
      + " actual=" + deleteEdits.length);
  }

  assertRowCountStable_(scan.sheet, scan.lastRow);
  const dbBefore = requestMetricContaminationDbRepair20260828_(false);
  result.db_before = {
    repairable: (dbBefore.rows || []).filter(function(row) { return row.status === "repairable"; }).length,
    delete_rows: (dbBefore.rows || []).filter(function(row) {
      return row.status === "repairable" && row.action === "delete_row";
    }).length,
  };
  if (result.db_before.delete_rows !== METRIC_REPAIR_20260901_DELETE_COUNT_) {
    throw new Error("삭제 대상 DB 행 수 불일치: expected=" + METRIC_REPAIR_20260901_DELETE_COUNT_
      + " actual=" + result.db_before.delete_rows);
  }
  result.backup_sheet = metricRepair20260828Backup_(scan.sheet, scan.edits, dbBefore.rows || []);
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

  result.db_repair = repairMetricContaminationDb20260828_();
  const refreshedExpected = metricRepair20260828ExpectedByKey_();
  scan.edits.forEach(function(edit) {
    const byDate = refreshedExpected[edit.key] || {};
    edit.expected = byDate[edit.date] == null ? "" : byDate[edit.date];
  });

  const exported = exportStatsWithOptions_({ skipFormulaRefresh: true });
  if (exported === false) throw new Error("exportStats returned false");
  SpreadsheetApp.flush();

  // Once the repair date is historical, exportStats may legitimately carry a
  // prior metric into a DB-empty gap. These repair targets must remain empty so
  // a later sheet-to-DB sync cannot re-import the contaminated value.
  const blankExpected = scan.edits.filter(function(edit) {
    return metricRepairNumber_(edit.expected) == null;
  });
  if (blankExpected.length) {
    const blankByCol = {};
    blankExpected.forEach(function(edit) {
      (blankByCol[edit.col] || (blankByCol[edit.col] = [])).push({ row: edit.row, value: "" });
    });
    Object.keys(blankByCol).forEach(function(col) {
      writeColumnRuns_(scan.sheet, Number(col), blankByCol[col], scan.lastRow);
    });
    SpreadsheetApp.flush();
  }

  const mismatches = scan.edits.filter(function(edit) {
    const actualValue = scan.sheet.getRange(edit.a1).getValue();
    const expectedValue = metricRepairNumber_(edit.expected);
    if (expectedValue == null) return actualValue !== "";
    return metricRepairNumber_(actualValue) !== expectedValue;
  });
  if (mismatches.length) {
    throw new Error("재역채움 검증 실패: " + mismatches.slice(0, 5).map(function(edit) {
      return edit.a1 + " expected=" + edit.expected + " actual=" + scan.sheet.getRange(edit.a1).getValue();
    }).join(","));
  }
  result.exported = true;
  result.post_export_blank_preserved = blankExpected.length;
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

function dailyMetricSyncExpected20260901_() {
  const out = {};
  fetchCollectedStats_().forEach(function(post) {
    const key = String(post.key || linkKey_(post.url) || "");
    if (!key) return;
    const item = out[key] || (out[key] = {
      ended_at: post.ended_at ? String(post.ended_at).slice(0, 10) : "",
      dates: {},
    });
    (post.stats || []).forEach(function(stat) {
      if (!stat || stat.length < 2) return;
      const date = String(stat[0] || "").slice(0, 10);
      const value = metricRepairNumber_(stat[1]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(value > 0)) return;
      const manual = stat.length >= 3 ? stat[2] === true : true;
      const previous = item.dates[date];
      if (!previous || value > previous.value) {
        item.dates[date] = { value: value, manual: manual || !!(previous && previous.manual) };
      } else if (manual) {
        previous.manual = true;
      }
    });
  });
  return out;
}

function dailyMetricSyncScan20260901_() {
  const sheet = getSheet_();
  const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
  const postedCol = findHeaderCol_(sheet, ["업로드일", "게시일"]);
  if (!urlCol) throw new Error("게시물 URL 열을 찾지 못했습니다.");
  const dates = metricDateColumns_(sheet).sort(function(a, b) { return a.date.localeCompare(b.date); });
  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  if (!rowCount || !dates.length) {
    return { sheet: sheet, lastRow: lastRow, edits: [], manual: [], unproven: [], ambiguous: 0 };
  }

  const urls = sheet.getRange(CONFIG.DATA_START_ROW, urlCol, rowCount, 1).getValues();
  const posted = postedCol
    ? sheet.getRange(CONFIG.DATA_START_ROW, postedCol, rowCount, 1).getValues()
    : Array(rowCount).fill([""]);
  const firstCol = dates[0].col;
  const lastCol = dates[dates.length - 1].col;
  const block = sheet.getRange(CONFIG.DATA_START_ROW, firstCol, rowCount, lastCol - firstCol + 1).getValues();
  const expected = dailyMetricSyncExpected20260901_();
  const today = todayStr_();
  const keyCounts = {};
  const keys = urls.map(function(row) {
    const key = String(linkKey_(String(row[0] || "").trim()) || "");
    if (key) keyCounts[key] = (keyCounts[key] || 0) + 1;
    return key;
  });
  const edits = [], manual = [], unproven = [];
  let ambiguous = 0;

  function record(target, row, item, date, key, url, oldValue, expectedItem, decision) {
    target.push({
      row: row,
      col: item.col,
      a1: sheet.getRange(row, item.col).getA1Notation(),
      date: date,
      key: key,
      url: url,
      old: oldValue,
      expected: expectedItem ? expectedItem.value : "",
      manual: expectedItem ? expectedItem.manual === true : null,
      action: decision.action,
      reason: decision.reason,
    });
  }

  for (let i = 0; i < rowCount; i++) {
    const key = keys[i];
    if (!key) continue;
    if (keyCounts[key] !== 1) { ambiguous++; continue; }
    const post = expected[key] || { ended_at: "", dates: {} };
    const postedAt = toDateStr_(posted[i][0]);
    const url = String(urls[i][0] || "").trim();
    let previousWasProvenCarry = false;
    for (let j = 0; j < dates.length; j++) {
      const item = dates[j];
      const date = item.date;
      // Do not skip dates after ended_at. A historical export bug copied the
      // last automatic value beyond the end date, and those cells must remain
      // visible to the conservative proven-carry detector below. With no DB
      // value they are still left untouched unless they exactly continue a
      // chain that started from an automatic DB value.
      if (date >= today || isBeforePostedDate_(date, postedAt)) continue;
      const bi = item.col - firstCol;
      const current = block[i][bi];
      const afterTrackingEnd = !!(post.ended_at && date > post.ended_at);
      // Stats written after ended_at are not sheet truth: the normal exporter
      // intentionally blanks that range. Ignore those DB rows here, while still
      // scanning the sheet so a proven automatic carry chain can be removed.
      const expectedItem = afterTrackingEnd ? null : (post.dates[date] || null);
      const previousDate = j > 0 ? dates[j - 1].date : "";
      const previousAfterTrackingEnd = !!(post.ended_at && previousDate > post.ended_at);
      const previousItem = previousDate && !previousAfterTrackingEnd
        ? (post.dates[previousDate] || null)
        : null;
      const previousValue = j > 0 ? block[i][dates[j - 1].col - firstCol] : null;
      const decision = dailyMetricSyncDecision20260901_(
        current,
        expectedItem && expectedItem.value,
        expectedItem && expectedItem.manual,
        previousValue,
        previousItem && previousItem.value,
        previousItem && previousItem.manual,
        previousWasProvenCarry
      );
      const row = CONFIG.DATA_START_ROW + i;
      if (decision.action !== "none") record(edits, row, item, date, key, url, current, expectedItem, decision);
      else if (decision.reason === "manual_preserved") record(manual, row, item, date, key, url, current, expectedItem, decision);
      else if (decision.reason === "sheet_only_unproven") record(unproven, row, item, date, key, url, current, expectedItem, decision);
      previousWasProvenCarry = decision.reason === "proven_carry";
    }
  }
  return { sheet: sheet, lastRow: lastRow, edits: edits, manual: manual, unproven: unproven, ambiguous: ambiguous };
}

function dailyMetricSyncBackup20260901_(sheet, edits) {
  const ss = sheet.getParent();
  let name = DAILY_METRIC_SYNC_BACKUP_PREFIX_;
  let suffix = 2;
  while (ss.getSheetByName(name)) { name = DAILY_METRIC_SYNC_BACKUP_PREFIX_ + "_" + suffix; suffix++; }
  const backup = ss.insertSheet(name);
  const now = new Date().toISOString();
  const rows = [["backed_up_at", "row", "a1", "date", "url", "key", "old", "new", "manual", "reason"]];
  edits.forEach(function(edit) {
    rows.push([now, edit.row, edit.a1, edit.date, edit.url, edit.key, edit.old,
      edit.action === "clear" ? "" : edit.expected, edit.manual, edit.reason]);
  });
  backup.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  backup.hideSheet();
  SpreadsheetApp.flush();
  return backup.getName();
}

function runDailyMetricSync20260901_(apply) {
  const lock = LockService.getDocumentLock();
  if (apply) lock.waitLock(30000);
  try {
    const scan = dailyMetricSyncScan20260901_();
    const counts = {};
    scan.edits.forEach(function(edit) { counts[edit.reason] = (counts[edit.reason] || 0) + 1; });
    const result = {
      dry_run: !apply,
      candidates: scan.edits.length,
      reasons: counts,
      manual_preserved: scan.manual.length,
      sheet_only_unproven: scan.unproven.length,
      duplicate_key_rows_skipped: scan.ambiguous,
      sample: scan.edits.slice(0, 20),
      manual_sample: scan.manual.slice(0, 10),
      unproven_sample: scan.unproven.slice(0, 10),
    };
    Logger.log("daily_metric_sync_20260901_scan " + JSON.stringify(result));
    if (!apply || !scan.edits.length) return result;

    assertRowCountStable_(scan.sheet, scan.lastRow, "dailyMetricSync20260901");
    const urlCol = findHeaderCol_(scan.sheet, ["게시물URL", "게시물 URL", "URL"]);
    scan.edits.forEach(function(edit) {
      const currentKey = String(linkKey_(String(scan.sheet.getRange(edit.row, urlCol).getValue() || "").trim()) || "");
      const currentValue = scan.sheet.getRange(edit.a1).getValue();
      if (currentKey !== edit.key || metricRepairNumber_(currentValue) !== metricRepairNumber_(edit.old)) {
        throw new Error("쓰기 직전 셀 변경 감지: " + edit.a1);
      }
    });

    result.backup_sheet = dailyMetricSyncBackup20260901_(scan.sheet, scan.edits);
    const byCol = {};
    scan.edits.forEach(function(edit) {
      (byCol[edit.col] || (byCol[edit.col] = [])).push({
        row: edit.row,
        value: edit.action === "clear" ? "" : edit.expected,
      });
    });
    let written = 0;
    Object.keys(byCol).forEach(function(col) {
      written += writeColumnRuns_(scan.sheet, Number(col), byCol[col], scan.lastRow);
    });
    SpreadsheetApp.flush();

    const after = dailyMetricSyncScan20260901_();
    if (after.edits.length) {
      throw new Error("일별 동기화 사후검증 실패: " + after.edits.slice(0, 5).map(function(edit) { return edit.a1; }).join(","));
    }
    result.written = written;
    result.after_candidates = after.edits.length;
    result.after_manual_preserved = after.manual.length;
    result.after_sheet_only_unproven = after.unproven.length;
    Logger.log("daily_metric_sync_20260901_result " + JSON.stringify(result));
    return result;
  } finally {
    if (apply) lock.releaseLock();
  }
}

function auditDailyMetricSync20260901() {
  return runDailyMetricSync20260901_(false);
}

function repairDailyMetricSync20260901() {
  return runDailyMetricSync20260901_(true);
}
