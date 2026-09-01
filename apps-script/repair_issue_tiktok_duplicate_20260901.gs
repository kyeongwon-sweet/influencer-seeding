/**
 * 이슈뜨기 TikTok URL 중복 수술적 정리 (2026-09-01).
 *
 * 실물 판정 결과 두 행은 같은 소재의 중복이 아니라 서로 다른 소재다.
 * 8/25 지젤 소재는 기존 URL을 유지하고, 8/26 카리나 소재의 URL만
 * 실제 게시물 주소로 교정한다. 행·날짜값·H/I 수식은 삭제하거나 쓰지 않는다.
 */

const ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_ = Object.freeze({
  sharedKey: "tt:7677969398061141255",
  replacementUrl: "https://www.tiktok.com/@issuetteugi/video/7678330001627909394",
  replacementKey: "tt:7678330001627909394",
  canonicalPostedAt: "2026-08-25",
  canonicalDate: "2026-08-25",
  canonicalValue: 50,
  canonicalAssetMarker: "지젤.비주얼",
  misplacedPostedAt: "2026-08-26",
  misplacedDate: "2026-08-30",
  misplacedValue: 136,
  misplacedAssetMarker: "행복지수 10000%",
  cumulativeCol: 8,
  backupPrefix: "_codex_issue_tiktok_duplicate_backup_20260901",
});

function issueTiktokDuplicateSnapshot20260901_() {
  const target = ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_;
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const dateColumns = metricDateColumns_(sheet);
  const dateByKey = {};
  dateColumns.forEach(function(item) { dateByKey[item.date] = item.col; });
  [target.canonicalDate, target.misplacedDate].forEach(function(date) {
    if (!dateByKey[date]) throw new Error("대상 날짜열 없음: " + date);
  });

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  const urls = rowCount ? sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, rowCount, 1).getValues() : [];
  const shared = [];
  const replacements = [];
  urls.forEach(function(item, index) {
    const row = CONFIG.DATA_START_ROW + index;
    const url = String(item[0] || "").trim();
    const key = String(linkKey_(url) || "");
    if (key === target.replacementKey) replacements.push({ row: row, url: url });
    if (key !== target.sharedKey) return;
    const history = dateColumns.map(function(dateItem) {
      return { date: dateItem.date, col: dateItem.col, value: sheet.getRange(row, dateItem.col).getValue() };
    }).filter(function(historyItem) { return historyItem.value !== "" && historyItem.value !== null; });
    const cumulative = sheet.getRange(row, target.cumulativeCol);
    shared.push({
      row: row,
      url: url,
      postedAt: toDateStr_(sheet.getRange(row, fieldCols.posted_at).getValue()),
      assetName: String(sheet.getRange(row, fieldCols.asset_name).getValue() || ""),
      hValue: cumulative.getValue(),
      hFormula: cumulative.getFormula(),
      canonicalValue: sheet.getRange(row, dateByKey[target.canonicalDate]).getValue(),
      misplacedValue: sheet.getRange(row, dateByKey[target.misplacedDate]).getValue(),
      history: history,
      fixedAtoO: sheet.getRange(row, 1, 1, Math.min(15, lastCol)).getDisplayValues()[0],
    });
  });
  if (shared.length !== 2) throw new Error("공유 URL-key 행 수 불일치: " + shared.length);
  if (replacements.length !== 0) throw new Error("교정 URL이 이미 시트에 존재합니다: " + JSON.stringify(replacements));

  const canonical = shared.filter(function(item) {
    return item.postedAt === target.canonicalPostedAt &&
      item.assetName.indexOf(target.canonicalAssetMarker) >= 0 &&
      Number(item.canonicalValue) === target.canonicalValue &&
      Number(item.hValue) === target.canonicalValue;
  });
  const misplaced = shared.filter(function(item) {
    return item.postedAt === target.misplacedPostedAt &&
      item.assetName.indexOf(target.misplacedAssetMarker) >= 0 &&
      Number(item.misplacedValue) === target.misplacedValue &&
      Number(item.hValue) === target.misplacedValue;
  });
  if (canonical.length !== 1 || misplaced.length !== 1 || canonical[0].row === misplaced[0].row) {
    throw new Error("지젤/카리나 행 지문 불일치: " + JSON.stringify(shared));
  }
  [canonical[0], misplaced[0]].forEach(function(item) {
    if (!item.hFormula || item.hFormula.charAt(0) !== "=") throw new Error("H 수식 누락: " + item.row);
  });
  return {
    sheet: sheet, fieldCols: fieldCols, dateByKey: dateByKey,
    lastRow: lastRow, lastCol: lastCol, canonical: canonical[0], misplaced: misplaced[0],
  };
}

function issueTiktokDuplicateBackup20260901_(snapshot) {
  const ss = snapshot.sheet.getParent();
  let name = ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_.backupPrefix;
  let suffix = 2;
  while (ss.getSheetByName(name)) name = ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_.backupPrefix + "_" + suffix++;
  const backup = ss.insertSheet(name);
  snapshot.sheet.getRange(CONFIG.HEADER_ROW, 1, 1, snapshot.lastCol)
    .copyTo(backup.getRange(1, 1, 1, snapshot.lastCol), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  snapshot.sheet.getRange(snapshot.canonical.row, 1, 1, snapshot.lastCol)
    .copyTo(backup.getRange(2, 1, 1, snapshot.lastCol), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  snapshot.sheet.getRange(snapshot.misplaced.row, 1, 1, snapshot.lastCol)
    .copyTo(backup.getRange(3, 1, 1, snapshot.lastCol), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  backup.getRange(1, snapshot.lastCol + 1, 3, 2).setValues([
    ["source_row", "backup_at"],
    [snapshot.canonical.row, new Date().toISOString()],
    [snapshot.misplaced.row, new Date().toISOString()],
  ]);
  backup.hideSheet();
  SpreadsheetApp.flush();
  return name;
}

function auditIssueTiktokDuplicate20260901() {
  const snapshot = issueTiktokDuplicateSnapshot20260901_();
  const out = {
    dry_run: true,
    shared_key: ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_.sharedKey,
    replacement_url: ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_.replacementUrl,
    canonical: snapshot.canonical,
    misplaced: snapshot.misplaced,
  };
  Logger.log("issue_tiktok_duplicate_20260901_audit " + JSON.stringify(out));
  return out;
}

function repairIssueTiktokDuplicate20260901() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const target = ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_;
    const before = issueTiktokDuplicateSnapshot20260901_();
    assertRowCountStable_(before.sheet, before.lastRow, "repairIssueTiktokDuplicate20260901");
    const backupName = issueTiktokDuplicateBackup20260901_(before);

    const urlRange = before.sheet.getRange(before.misplaced.row, before.fieldCols.url);
    if (String(linkKey_(String(urlRange.getValue() || "").trim()) || "") !== target.sharedKey) {
      throw new Error("쓰기 직전 URL-key 변경 감지");
    }
    urlRange.setValue(target.replacementUrl);
    SpreadsheetApp.flush();

    const afterShared = [];
    const afterReplacement = [];
    const afterCount = Math.max(0, before.sheet.getLastRow() - CONFIG.DATA_START_ROW + 1);
    const afterUrls = afterCount
      ? before.sheet.getRange(CONFIG.DATA_START_ROW, before.fieldCols.url, afterCount, 1).getValues()
      : [];
    afterUrls.forEach(function(item, index) {
      const key = String(linkKey_(String(item[0] || "").trim()) || "");
      if (key === target.sharedKey) afterShared.push(CONFIG.DATA_START_ROW + index);
      if (key === target.replacementKey) afterReplacement.push(CONFIG.DATA_START_ROW + index);
    });
    if (afterShared.length !== 1 || afterShared[0] !== before.canonical.row ||
        afterReplacement.length !== 1 || afterReplacement[0] !== before.misplaced.row) {
      throw new Error("URL 교정 사후검증 실패: " + JSON.stringify({ shared: afterShared, replacement: afterReplacement }));
    }
    if (before.sheet.getRange(before.canonical.row, target.cumulativeCol).getFormula() !== before.canonical.hFormula ||
        before.sheet.getRange(before.misplaced.row, target.cumulativeCol).getFormula() !== before.misplaced.hFormula) {
      throw new Error("H 수식 변경 감지");
    }
    if (Number(before.sheet.getRange(before.canonical.row, before.dateByKey[target.canonicalDate]).getValue()) !== target.canonicalValue ||
        Number(before.sheet.getRange(before.misplaced.row, before.dateByKey[target.misplacedDate]).getValue()) !== target.misplacedValue) {
      throw new Error("날짜값 변경 감지");
    }

    const out = {
      changed: true,
      backup_sheet: backupName,
      canonical_row: before.canonical.row,
      corrected_row: before.misplaced.row,
      corrected_url: target.replacementUrl,
      shared_key_count: 1,
      replacement_key_count: 1,
      rows_deleted: 0,
      h_formulas_preserved: true,
      metric_values_preserved: true,
    };
    Logger.log("issue_tiktok_duplicate_20260901_result " + JSON.stringify(out));
    return out;
  } finally {
    lock.releaseLock();
  }
}

function verifyIssueTiktokDuplicate20260901() {
  const target = ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_;
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const dateColumns = metricDateColumns_(sheet);
  const dateByKey = {};
  dateColumns.forEach(function(item) { dateByKey[item.date] = item.col; });
  [target.canonicalDate, target.misplacedDate, "2026-09-01"].forEach(function(date) {
    if (!dateByKey[date]) throw new Error("검증 날짜열 없음: " + date);
  });

  const rowsByKey = {};
  const rowCount = Math.max(0, sheet.getLastRow() - CONFIG.DATA_START_ROW + 1);
  const urls = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, rowCount, 1).getValues()
    : [];
  urls.forEach(function(item, index) {
    const key = String(linkKey_(String(item[0] || "").trim()) || "");
    if (key !== target.sharedKey && key !== target.replacementKey) return;
    const row = CONFIG.DATA_START_ROW + index;
    const h = sheet.getRange(row, target.cumulativeCol);
    rowsByKey[key] = rowsByKey[key] || [];
    rowsByKey[key].push({
      row: row,
      url: String(item[0] || "").trim(),
      hValue: h.getValue(),
      hFormula: h.getFormula(),
      canonicalDateValue: sheet.getRange(row, dateByKey[target.canonicalDate]).getValue(),
      misplacedDateValue: sheet.getRange(row, dateByKey[target.misplacedDate]).getValue(),
      finalDateValue: sheet.getRange(row, dateByKey["2026-09-01"]).getValue(),
    });
  });
  if (!rowsByKey[target.sharedKey] || rowsByKey[target.sharedKey].length !== 1 ||
      !rowsByKey[target.replacementKey] || rowsByKey[target.replacementKey].length !== 1) {
    throw new Error("시트 URL-key 개수 불일치: " + JSON.stringify(rowsByKey));
  }

  const statsByKey = {};
  fetchCollectedStats_().forEach(function(post) {
    const key = String(linkKey_(String(post.key || post.url || "")) || "");
    if (key !== target.sharedKey && key !== target.replacementKey) return;
    statsByKey[key] = statsByKey[key] || [];
    statsByKey[key].push({
      url: String(post.url || ""),
      stats: (post.stats || []).map(function(pair) {
        return [String(pair[0]).slice(0, 10), Number(pair[1]), pair.length >= 3 ? pair[2] === true : null];
      }),
    });
  });
  if (!statsByKey[target.sharedKey] || statsByKey[target.sharedKey].length !== 1 ||
      !statsByKey[target.replacementKey] || statsByKey[target.replacementKey].length !== 1) {
    throw new Error("DB URL-key 개수 불일치: " + JSON.stringify(statsByKey));
  }

  const statValue = function(key, date) {
    const hit = statsByKey[key][0].stats.filter(function(pair) { return pair[0] === date; });
    return hit.length === 1 ? hit[0][1] : null;
  };
  const canonical = rowsByKey[target.sharedKey][0];
  const replacement = rowsByKey[target.replacementKey][0];
  const checks = {
    sheet_canonical_0825: Number(canonical.canonicalDateValue) === target.canonicalValue,
    sheet_canonical_0901: Number(canonical.finalDateValue) === 136,
    sheet_replacement_0830: Number(replacement.misplacedDateValue) === target.misplacedValue,
    sheet_canonical_h: Number(canonical.hValue) === 136 && String(canonical.hFormula).charAt(0) === "=",
    sheet_replacement_h: Number(replacement.hValue) === 136 && String(replacement.hFormula).charAt(0) === "=",
    db_canonical_0825: statValue(target.sharedKey, target.canonicalDate) === target.canonicalValue,
    db_canonical_0901: statValue(target.sharedKey, "2026-09-01") === 136,
    db_replacement_0830: statValue(target.replacementKey, target.misplacedDate) === target.misplacedValue,
  };
  const failed = Object.keys(checks).filter(function(name) { return !checks[name]; });
  if (failed.length) {
    throw new Error("이슈뜨기 정합 검증 실패: " + failed.join(", ") + " " + JSON.stringify({ rowsByKey: rowsByKey, statsByKey: statsByKey }));
  }

  const out = { ok: true, checks: checks, rowsByKey: rowsByKey, statsByKey: statsByKey };
  Logger.log("issue_tiktok_duplicate_20260901_verify " + JSON.stringify(out));
  return out;
}

function fillIssueTiktokCanonical136After20260901() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const target = ISSUE_TIKTOK_DUPLICATE_REPAIR_20260901_;
    const finalDate = "2026-09-01";
    const finalValue = 136;
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const dateColumns = metricDateColumns_(sheet);
    const dateByKey = {};
    dateColumns.forEach(function(item) { dateByKey[item.date] = item.col; });
    if (!dateByKey[finalDate]) throw new Error("검증 날짜열 없음: " + finalDate);

    const rowsByKey = {};
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
    const urls = rowCount
      ? sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, rowCount, 1).getValues()
      : [];
    urls.forEach(function(item, index) {
      const key = String(linkKey_(String(item[0] || "").trim()) || "");
      if (key !== target.sharedKey && key !== target.replacementKey) return;
      rowsByKey[key] = rowsByKey[key] || [];
      rowsByKey[key].push(CONFIG.DATA_START_ROW + index);
    });
    if (!rowsByKey[target.sharedKey] || rowsByKey[target.sharedKey].length !== 1 ||
        !rowsByKey[target.replacementKey] || rowsByKey[target.replacementKey].length !== 1) {
      throw new Error("시트 URL-key 개수 불일치: " + JSON.stringify(rowsByKey));
    }

    const dbHits = [];
    fetchCollectedStats_().forEach(function(post) {
      const key = String(linkKey_(String(post.key || post.url || "")) || "");
      if (key !== target.sharedKey) return;
      const stat = (post.stats || []).filter(function(pair) {
        return String(pair[0]).slice(0, 10) === finalDate && Number(pair[1]) === finalValue && pair[2] === true;
      });
      if (stat.length === 1) dbHits.push(post);
    });
    if (dbHits.length !== 1) throw new Error("DB 정본 manual 136 확인 실패: " + dbHits.length);

    const canonicalRow = rowsByKey[target.sharedKey][0];
    const replacementRow = rowsByKey[target.replacementKey][0];
    const finalCell = sheet.getRange(canonicalRow, dateByKey[finalDate]);
    const beforeValue = finalCell.getValue();
    if (beforeValue !== "" && Number(beforeValue) !== finalValue) {
      throw new Error("정본행 09-01 셀 예상 밖 값: " + beforeValue);
    }
    const canonicalH = sheet.getRange(canonicalRow, target.cumulativeCol);
    const replacementH = sheet.getRange(replacementRow, target.cumulativeCol);
    const canonicalHFormula = canonicalH.getFormula();
    const replacementHFormula = replacementH.getFormula();
    if (!canonicalHFormula || !replacementHFormula) throw new Error("H 수식 누락");

    const backupName = issueTiktokDuplicateBackup20260901_({
      sheet: sheet,
      canonical: { row: canonicalRow },
      misplaced: { row: replacementRow },
      lastRow: lastRow,
      lastCol: lastCol,
    });
    assertRowCountStable_(sheet, lastRow, "fillIssueTiktokCanonical136After20260901");
    if (beforeValue === "") finalCell.setValue(finalValue);
    SpreadsheetApp.flush();

    if (Number(finalCell.getValue()) !== finalValue || Number(canonicalH.getValue()) !== finalValue ||
        canonicalH.getFormula() !== canonicalHFormula || replacementH.getFormula() !== replacementHFormula) {
      throw new Error("시트 정본 136 반영 사후검증 실패");
    }
    const out = {
      changed: beforeValue === "",
      backup_sheet: backupName,
      row: canonicalRow,
      date: finalDate,
      value: finalValue,
      h_value: canonicalH.getValue(),
      h_formula_preserved: true,
    };
    Logger.log("issue_tiktok_duplicate_20260901_fill " + JSON.stringify(out));
    return out;
  } finally {
    lock.releaseLock();
  }
}
