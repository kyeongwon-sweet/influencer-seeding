/**
 * 2026-09-03 confirmed cross-post/view-read spike cleanup.
 *
 * DB rows for these exact key/date pairs were already cleared after an
 * independent scrape. This repair clears only the matching sheet cells so a
 * later sheet-to-DB import cannot restore the contaminated values.
 */

const METRIC_SPIKE_REPAIR_20260903_SIGNATURE_ = "metric-spikes-2026-09-03";
const METRIC_SPIKE_REPAIR_20260903_TARGETS_ = Object.freeze([
  { key: "ig:DcVKpb3BInV", date: "2026-08-26", dirty: 116853 },
  { key: "ig:DcVKpb3BInV", date: "2026-09-01", dirty: 198660 },
  { key: "ig:Db5dILHxraF", date: "2026-08-26", dirty: 469130 },
  { key: "tt:7670156284628307207", date: "2026-08-26", dirty: 469130 },
  { key: "ig:Dcf5OKEiZvJ", date: "2026-08-26", dirty: 116853 },
  { key: "ig:Dcf5OKEiZvJ", date: "2026-08-27", dirty: 116853 },
  { key: "ig:Dcf5OKEiZvJ", date: "2026-08-28", dirty: 116853 },
  { key: "ig:Dcf5OKEiZvJ", date: "2026-08-29", dirty: 116853 },
  { key: "ig:Dcf5OKEiZvJ", date: "2026-08-30", dirty: 116853 },
  { key: "ig:Dcf5OKEiZvJ", date: "2026-09-02", dirty: 198660 },
]);

function metricSpikeRepairNumber20260903_(value) {
  if (typeof value === "number" && isFinite(value)) return value;
  const text = String(value == null ? "" : value).replace(/[,\s]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : null;
}

function metricSpikeRepairDbValues20260903_() {
  const targetKeys = {};
  METRIC_SPIKE_REPAIR_20260903_TARGETS_.forEach(function(target) {
    targetKeys[target.key] = true;
  });
  const out = {};
  fetchCollectedStats_().forEach(function(post) {
    const key = String(post.key || linkKey_(post.url) || "");
    if (!targetKeys[key]) return;
    (post.stats || []).forEach(function(stat) {
      if (!stat || stat.length < 2) return;
      const date = String(stat[0] || "").slice(0, 10);
      const value = metricSpikeRepairNumber20260903_(stat[1]);
      if (value != null) out[key + "|" + date] = value;
    });
  });
  return out;
}

function metricSpikeDbRepairUrl20260903_() {
  const url = String(CONFIG.STATS_EXPORT_API_URL || "")
    .replace(/\/api\/sponsored-posts\/stats-for-sheet(?:\?.*)?$/, "/api/ops/repair-metric-spikes-20260903");
  if (!/\/api\/ops\/repair-metric-spikes-20260903$/.test(url)) {
    throw new Error("DB 스파이크 복구 API URL을 만들지 못했습니다.");
  }
  return url;
}

function requestMetricSpikeDbRepair20260903_(apply) {
  const options = {
    method: apply ? "post" : "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  };
  if (apply) {
    options.contentType = "application/json";
    options.payload = JSON.stringify({ confirm: "repair-2026-09-03-metric-spikes" });
  }
  const response = UrlFetchApp.fetch(metricSpikeDbRepairUrl20260903_(), options);
  const code = response.getResponseCode();
  const body = JSON.parse(response.getContentText() || "{}");
  if (code !== 200 || (apply && body.ok !== true)) {
    throw new Error("DB 스파이크 복구 실패 API " + code + ": " + JSON.stringify(body));
  }
  return body;
}

function metricSpikeRepairSnapshot20260903_() {
  const sheet = getSheet_();
  const urlCol = findHeaderCol_(sheet, ["게시물URL", "게시물 URL", "URL"]);
  if (!urlCol) throw new Error("게시물 URL 열을 찾지 못했습니다.");

  const dateByName = {};
  const dateColumns = metricDateColumns_(sheet);
  dateColumns.forEach(function(item) { dateByName[item.date] = item.col; });
  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  const urls = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, urlCol, rowCount, 1).getValues()
    : [];
  const urlIndex = buildUrlKeyIndex_(urls, linkKey_);
  const dbValues = metricSpikeRepairDbValues20260903_();
  const resolvedTargets = METRIC_SPIKE_REPAIR_20260903_TARGETS_;
  const targetDatesByKey = {};
  resolvedTargets.forEach(function(target) {
    (targetDatesByKey[target.key] || (targetDatesByKey[target.key] = {}))[target.date] = true;
  });

  const rowStateByKey = {};
  Object.keys(targetDatesByKey).forEach(function(key) {
    if ((urlIndex.countsByKey[key] || 0) !== 1) {
      throw new Error("대상 URL-key 행 수 불일치 " + key + ": " + (urlIndex.countsByKey[key] || 0));
    }
    const row = CONFIG.DATA_START_ROW + urlIndex.firstIndexByKey[key];
    const hRange = sheet.getRange(row, 8);
    const iRange = sheet.getRange(row, 9);
    const hFormula = hRange.getFormula();
    const iFormula = iRange.getFormula();
    if (!hFormula || hFormula.charAt(0) !== "=") throw new Error("H 누적셀이 수식이 아닙니다: " + hRange.getA1Notation());
    if (!iFormula || iFormula.charAt(0) !== "=") throw new Error("I 증분셀이 수식이 아닙니다: " + iRange.getA1Notation());

    const untouched = [];
    dateColumns.forEach(function(item) {
      if (targetDatesByKey[key][item.date]) return;
      untouched.push([item.date, sheet.getRange(row, item.col).getValue()]);
    });
    rowStateByKey[key] = {
      row: row,
      url: String(sheet.getRange(row, urlCol).getValue() || "").trim(),
      h_a1: hRange.getA1Notation(),
      h_value: hRange.getValue(),
      h_formula: hFormula,
      i_a1: iRange.getA1Notation(),
      i_value: iRange.getValue(),
      i_formula: iFormula,
      untouched_metrics: JSON.stringify(untouched),
    };
  });

  const targets = resolvedTargets.map(function(target) {
    const col = dateByName[target.date];
    if (!col) throw new Error("대상 날짜열을 찾지 못했습니다: " + target.date);
    const rowState = rowStateByKey[target.key];
    const range = sheet.getRange(rowState.row, col);
    const raw = range.getValue();
    const current = metricSpikeRepairNumber20260903_(raw);
    const dbValue = dbValues[target.key + "|" + target.date];
    const sheetState = raw === "" || raw == null
      ? "blank"
      : current === target.dirty ? "pending" : "drift";
    const state = dbValue != null ? "db-conflict" : sheetState;
    return {
      key: target.key,
      date: target.date,
      dirty: target.dirty,
      row: rowState.row,
      col: col,
      a1: range.getA1Notation(),
      current: raw,
      state: state,
      db_value: dbValue == null ? null : dbValue,
      sheet_state: sheetState,
      url: rowState.url,
    };
  });
  return {
    sheet: sheet,
    lastRow: lastRow,
    urlCol: urlCol,
    dateColumns: dateColumns,
    rowStateByKey: rowStateByKey,
    targets: targets,
  };
}

function metricSpikeRepairPublicResult20260903_(snapshot, changed) {
  return {
    ok: true,
    target_count: snapshot.targets.length,
    pending: snapshot.targets.filter(function(target) { return target.state === "pending"; }).length,
    blank: snapshot.targets.filter(function(target) { return target.state === "blank"; }).length,
    drift: snapshot.targets.filter(function(target) { return target.sheet_state === "drift"; }).length,
    db_conflicts: snapshot.targets.filter(function(target) { return target.state === "db-conflict"; }).length,
    changed: changed || 0,
    targets: snapshot.targets.map(function(target) {
      const rowState = snapshot.rowStateByKey[target.key];
      return {
        key: target.key,
        date: target.date,
        dirty: target.dirty,
        row: target.row,
        a1: target.a1,
        current: target.current,
        state: target.state,
        sheet_state: target.sheet_state,
        db_value: target.db_value,
        url: target.url,
        h_a1: rowState.h_a1,
        h_value: rowState.h_value,
        h_formula: rowState.h_formula,
        i_a1: rowState.i_a1,
        i_value: rowState.i_value,
        i_formula: rowState.i_formula,
      };
    }),
  };
}

function repairMetricSpikes20260903(signature, apply) {
  if (signature !== METRIC_SPIKE_REPAIR_20260903_SIGNATURE_) {
    throw new Error("복구 서명이 일치하지 않습니다.");
  }
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const before = metricSpikeRepairSnapshot20260903_();
    const dbConflicts = before.targets.filter(function(target) { return target.state === "db-conflict"; });
    if (apply === true && dbConflicts.length) {
      throw new Error("DB에 대상 날짜값이 남아 있어 적용 중단: " + dbConflicts.map(function(target) {
        return target.key + "@" + target.date + "=" + target.db_value;
      }).join(", "));
    }
    if (apply !== true || !before.targets.some(function(target) { return target.state === "pending"; })) {
      const dryResult = metricSpikeRepairPublicResult20260903_(before, 0);
      Logger.log("metric_spike_repair_20260903_dry " + JSON.stringify(dryResult));
      return dryResult;
    }

    assertRowCountStable_(before.sheet, before.lastRow, "repairMetricSpikes20260903");
    const currentUrls = before.sheet.getRange(
      CONFIG.DATA_START_ROW, before.urlCol, before.lastRow - CONFIG.DATA_START_ROW + 1, 1
    ).getValues();
    const currentIndex = buildUrlKeyIndex_(currentUrls, linkKey_);
    before.targets.forEach(function(target) {
      if ((currentIndex.countsByKey[target.key] || 0) !== 1 ||
          CONFIG.DATA_START_ROW + currentIndex.firstIndexByKey[target.key] !== target.row) {
        throw new Error("쓰기 직전 URL-key 행 변경 감지: " + target.key);
      }
      const current = before.sheet.getRange(target.a1).getValue();
      if (target.state === "pending") {
        if (metricSpikeRepairNumber20260903_(current) !== target.dirty) {
          throw new Error("쓰기 직전 대상값 변경 감지: " + target.a1);
        }
      } else if (String(current == null ? "" : current) !== String(target.current == null ? "" : target.current)) {
        throw new Error("쓰기 직전 보존값 변경 감지: " + target.a1);
      }
      const rowState = before.rowStateByKey[target.key];
      if (before.sheet.getRange(rowState.h_a1).getFormula() !== rowState.h_formula ||
          before.sheet.getRange(rowState.i_a1).getFormula() !== rowState.i_formula) {
        throw new Error("쓰기 직전 H/I 수식 변경 감지: " + target.key);
      }
    });

    const byCol = {};
    before.targets.filter(function(target) { return target.state === "pending"; }).forEach(function(target) {
      (byCol[target.col] || (byCol[target.col] = [])).push({ row: target.row, value: "" });
    });
    let changed = 0;
    Object.keys(byCol).forEach(function(col) {
      changed += writeColumnRuns_(before.sheet, Number(col), byCol[col], before.lastRow);
    });
    SpreadsheetApp.flush();

    const after = metricSpikeRepairSnapshot20260903_();
    const afterByKeyDate = {};
    after.targets.forEach(function(target) { afterByKeyDate[target.key + "|" + target.date] = target; });
    before.targets.forEach(function(target) {
      const next = afterByKeyDate[target.key + "|" + target.date];
      if (!next) throw new Error("대상 셀 사후검증 누락: " + target.key + "@" + target.date);
      if (target.state === "pending" && next.sheet_state !== "blank") {
        throw new Error("대상 셀 비우기 사후검증 실패: " + target.a1);
      }
      if (target.state === "blank" && next.sheet_state !== "blank") {
        throw new Error("기존 공백 셀이 변경됐습니다: " + target.a1);
      }
      if (target.sheet_state === "drift" &&
          String(next.current == null ? "" : next.current) !== String(target.current == null ? "" : target.current)) {
        throw new Error("드리프트 셀이 변경됐습니다: " + target.a1);
      }
    });
    const expectedChanged = before.targets.filter(function(target) { return target.state === "pending"; }).length;
    if (changed !== expectedChanged) {
      throw new Error("변경 셀 수 불일치: expected=" + expectedChanged + ", actual=" + changed);
    }
    Object.keys(before.rowStateByKey).forEach(function(key) {
      const oldState = before.rowStateByKey[key];
      const newState = after.rowStateByKey[key];
      if (oldState.h_formula !== newState.h_formula || oldState.i_formula !== newState.i_formula) {
        throw new Error("H/I 수식이 변경됐습니다: " + key);
      }
      if (oldState.untouched_metrics !== newState.untouched_metrics) {
        throw new Error("대상 외 날짜값이 변경됐습니다: " + key);
      }
    });

    const result = metricSpikeRepairPublicResult20260903_(after, changed);
    result.h_values_before = Object.keys(before.rowStateByKey).map(function(key) {
      return { key: key, value: before.rowStateByKey[key].h_value };
    });
    result.h_values_after = Object.keys(after.rowStateByKey).map(function(key) {
      return { key: key, value: after.rowStateByKey[key].h_value };
    });
    Logger.log("metric_spike_repair_20260903_result " + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function auditMetricSpikes20260903() {
  return repairMetricSpikes20260903(METRIC_SPIKE_REPAIR_20260903_SIGNATURE_, false);
}

function applyMetricSpikes20260903() {
  const before = requestMetricSpikeDbRepair20260903_(false);
  const allowed = { repairable: true, already_clean: true };
  if (!before.rows || before.rows.length !== 5 || before.rows.some(function(row) {
    return !allowed[row.status] || row.manual !== true;
  })) {
    throw new Error("DB 스파이크 적용 전 상태 불일치: " + JSON.stringify(before));
  }
  const db = requestMetricSpikeDbRepair20260903_(true);
  const sheet = repairMetricSpikes20260903(METRIC_SPIKE_REPAIR_20260903_SIGNATURE_, true);
  return { ok: true, db: db, sheet: sheet };
}

function auditMetricSpikeDb20260903() {
  const result = requestMetricSpikeDbRepair20260903_(false);
  Logger.log("metric_spike_db_20260903_dry " + JSON.stringify(result));
  return result;
}
