/**
 * 이슈박스 YouTube 카리나 소재의 시트 중복 3행을 정본 1행으로 정리한다.
 *
 * DB는 건드리지 않는다. URL-key·게시일·계정·소재명 지문이 모두 맞고,
 * 같은 영상 2행 중 날짜값이 더 많은 행이 하나로 확정될 때만 실행한다.
 */

const ISSUEBOX_YT_DUPLICATE_20260903_ = Object.freeze({
  videoKey: "yt:6ronnq9uRbE",
  profileUrlPattern: /^https?:\/\/(?:www\.)?youtube\.com\/@issuebox_x\/shorts\/?(?:\?.*)?$/i,
  postedAt: "2026-08-30",
  account: "이슈박스(유튜브)",
  assetName: "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_선망성_var14.렉카_카리나.비주얼.작정하고 꾸민 카리나가 너무 고능해.디자인4.X_스틱바P_이세진_260826_빙과_최재헌",
  cumulative: 3,
  cumulativeCol: 8,
  incrementCol: 9,
  backupPrefix: "_codex_issuebox_yt_dup_backup_20260903_",
});

function issueboxYoutubeDuplicateSnapshot20260903_() {
  const target = ISSUEBOX_YT_DUPLICATE_20260903_;
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const dateCols = metricDateColumns_(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  const range = sheet.getRange(CONFIG.DATA_START_ROW, 1, rowCount, lastCol);
  const values = range.getValues();
  const displays = range.getDisplayValues();
  const formulas = range.getFormulas();

  const rows = [];
  values.forEach(function(row, index) {
    const rowNumber = CONFIG.DATA_START_ROW + index;
    const url = String(row[fieldCols.url - 1] || "").trim();
    const key = String(linkKey_(url) || "");
    const isProfile = target.profileUrlPattern.test(url);
    if (key !== target.videoKey && !isProfile) return;
    const dateValues = dateCols.map(function(item) { return row[item.col - 1]; });
    rows.push({
      row: rowNumber,
      url: url,
      key: key,
      isProfile: isProfile,
      postedAt: toDateStr_(row[fieldCols.posted_at - 1]),
      account: String(row[fieldCols.account_name - 1] || "").trim(),
      assetName: String(row[fieldCols.asset_name - 1] || "").trim(),
      hValue: row[target.cumulativeCol - 1],
      iValue: row[target.incrementCol - 1],
      hFormula: formulas[index][target.cumulativeCol - 1] || "",
      iFormula: formulas[index][target.incrementCol - 1] || "",
      metricCount: dateValues.filter(function(value) { return Number(value) > 0; }).length,
      dateValues: dateValues,
      rawValues: row,
      rawFormulas: formulas[index],
      displayValues: displays[index],
    });
  });

  const matching = rows.filter(function(item) {
    return item.postedAt === target.postedAt &&
      item.account === target.account &&
      item.assetName === target.assetName;
  });
  const videoRows = matching.filter(function(item) { return item.key === target.videoKey; });
  const profileRows = matching.filter(function(item) { return item.isProfile; });
  if (videoRows.length !== 2 || profileRows.length !== 1 || matching.length !== 3) {
    throw new Error("이슈박스 대상 3행 지문 불일치: " + JSON.stringify(rows.map(function(item) {
      return { row: item.row, url: item.url, postedAt: item.postedAt, account: item.account, assetName: item.assetName };
    })));
  }

  const ranked = videoRows.slice().sort(function(a, b) {
    return b.metricCount - a.metricCount || a.row - b.row;
  });
  if (ranked[0].metricCount <= ranked[1].metricCount) {
    throw new Error("정본행 날짜값 우위가 유일하지 않음: " + JSON.stringify(videoRows));
  }
  const keeper = ranked[0];
  const duplicate = ranked[1];
  if (Number(keeper.hValue) !== target.cumulative || !keeper.hFormula || !keeper.iFormula) {
    throw new Error("정본행 H/I 지문 불일치: " + JSON.stringify(keeper));
  }

  return {
    sheet: sheet,
    fieldCols: fieldCols,
    dateCols: dateCols,
    lastRow: lastRow,
    lastCol: lastCol,
    keeper: keeper,
    removals: [duplicate, profileRows[0]],
  };
}

function issueboxYoutubeDuplicateBackup20260903_(snapshot) {
  const ss = snapshot.sheet.getParent();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
  const name = ISSUEBOX_YT_DUPLICATE_20260903_.backupPrefix + stamp;
  if (ss.getSheetByName(name)) throw new Error("백업 탭 이름 충돌: " + name);
  const backup = ss.insertSheet(name);
  const metadataCols = 5;
  const totalCols = metadataCols + snapshot.lastCol;
  if (backup.getMaxColumns() < totalCols) {
    backup.insertColumnsAfter(backup.getMaxColumns(), totalCols - backup.getMaxColumns());
  }
  const header = ["source_row", "action", "source_url", "original_formulas_json", "backup_at"]
    .concat(snapshot.sheet.getRange(CONFIG.HEADER_ROW, 1, 1, snapshot.lastCol).getDisplayValues()[0]);
  const now = new Date().toISOString();
  const backupRows = [snapshot.keeper].concat(snapshot.removals).map(function(item) {
    const action = item.row === snapshot.keeper.row ? "KEEP" : "DELETE";
    return [item.row, action, item.url, JSON.stringify(item.rawFormulas), now].concat(item.rawValues);
  });
  backup.getRange(1, 1, 1 + backupRows.length, totalCols).setValues([header].concat(backupRows));
  backup.hideSheet();
  SpreadsheetApp.flush();
  if (backup.getLastRow() !== 4 || backup.getRange(2, 1, 3, 1).getValues().flat().filter(Boolean).length !== 3) {
    throw new Error("중복행 백업 검증 실패: " + name);
  }
  return name;
}

function auditIssueboxYoutubeDuplicate20260903() {
  const snapshot = issueboxYoutubeDuplicateSnapshot20260903_();
  const result = {
    status: "DRY_RUN",
    lastRow: snapshot.lastRow,
    keeper: {
      row: snapshot.keeper.row,
      url: snapshot.keeper.url,
      hValue: snapshot.keeper.hValue,
      iValue: snapshot.keeper.iValue,
      metricCount: snapshot.keeper.metricCount,
    },
    removals: snapshot.removals.map(function(item) {
      return { row: item.row, url: item.url, hValue: item.hValue, iValue: item.iValue, metricCount: item.metricCount };
    }),
  };
  Logger.log("issuebox_youtube_duplicate_20260903_audit " + JSON.stringify(result));
  return result;
}

function verifyIssueboxYoutubeDuplicate20260903() {
  const target = ISSUEBOX_YT_DUPLICATE_20260903_;
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const dateCols = metricDateColumns_(sheet);
  const lastRow = sheet.getLastRow();
  const rowCount = lastRow - CONFIG.DATA_START_ROW + 1;
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, rowCount, sheet.getLastColumn()).getValues();
  const formulas = sheet.getRange(CONFIG.DATA_START_ROW, 1, rowCount, target.incrementCol).getFormulas();
  const videoRows = [];
  const profileRows = [];

  values.forEach(function(row, index) {
    const url = String(row[fieldCols.url - 1] || "").trim();
    const rowNumber = CONFIG.DATA_START_ROW + index;
    if (String(linkKey_(url) || "") === target.videoKey) {
      videoRows.push({
        row: rowNumber,
        url: url,
        postedAt: toDateStr_(row[fieldCols.posted_at - 1]),
        account: String(row[fieldCols.account_name - 1] || "").trim(),
        assetName: String(row[fieldCols.asset_name - 1] || "").trim(),
        hValue: row[target.cumulativeCol - 1],
        hFormula: formulas[index][target.cumulativeCol - 1] || "",
        iFormula: formulas[index][target.incrementCol - 1] || "",
        metricCount: dateCols.filter(function(item) { return Number(row[item.col - 1]) > 0; }).length,
      });
    }
    if (target.profileUrlPattern.test(url)) profileRows.push(rowNumber);
  });

  if (videoRows.length !== 1 || profileRows.length !== 0) {
    throw new Error("이슈박스 URL 사후검증 실패: " + JSON.stringify({ videoRows: videoRows, profileRows: profileRows }));
  }
  const keeper = videoRows[0];
  if (keeper.postedAt !== target.postedAt || keeper.account !== target.account ||
      keeper.assetName !== target.assetName || Number(keeper.hValue) !== target.cumulative ||
      !keeper.hFormula || !keeper.iFormula || keeper.metricCount < 2) {
    throw new Error("이슈박스 정본행 사후 지문 불일치: " + JSON.stringify(keeper));
  }

  const result = {
    status: "OK",
    row: keeper.row,
    url: keeper.url,
    videoKeyCount: 1,
    profileUrlCount: 0,
    hValue: keeper.hValue,
    hFormulaPresent: true,
    iFormulaPresent: true,
    metricCount: keeper.metricCount,
    dbWrites: 0,
  };
  Logger.log("issuebox_youtube_duplicate_20260903_verify " + JSON.stringify(result));
  return result;
}

function repairIssueboxYoutubeDuplicate20260903() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const target = ISSUEBOX_YT_DUPLICATE_20260903_;
    const before = issueboxYoutubeDuplicateSnapshot20260903_();
    assertRowCountStable_(before.sheet, before.lastRow, "repairIssueboxYoutubeDuplicate20260903");
    const backupName = issueboxYoutubeDuplicateBackup20260903_(before);

    const removalRows = before.removals.map(function(item) { return item.row; })
      .sort(function(a, b) { return b - a; });
    removalRows.forEach(function(rowNumber) {
      const rowUrl = String(before.sheet.getRange(rowNumber, before.fieldCols.url).getValue() || "").trim();
      const planned = before.removals.filter(function(item) { return item.row === rowNumber; })[0];
      if (!planned || rowUrl !== planned.url) throw new Error("삭제 직전 URL 변경 감지: " + rowNumber);
      before.sheet.deleteRow(rowNumber);
    });
    SpreadsheetApp.flush();
    if (before.sheet.getLastRow() !== before.lastRow - 2) throw new Error("삭제 후 행 수 불일치");

    const afterRowCount = before.sheet.getLastRow() - CONFIG.DATA_START_ROW + 1;
    const afterUrls = before.sheet.getRange(CONFIG.DATA_START_ROW, before.fieldCols.url, afterRowCount, 1).getValues();
    const videoRows = [];
    const profileRows = [];
    afterUrls.forEach(function(item, index) {
      const url = String(item[0] || "").trim();
      const rowNumber = CONFIG.DATA_START_ROW + index;
      if (String(linkKey_(url) || "") === target.videoKey) videoRows.push(rowNumber);
      if (target.profileUrlPattern.test(url)) profileRows.push(rowNumber);
    });
    if (videoRows.length !== 1 || profileRows.length !== 0) {
      throw new Error("삭제 후 URL 개수 불일치: " + JSON.stringify({ videoRows: videoRows, profileRows: profileRows }));
    }

    const keeperRow = videoRows[0];
    const hCell = before.sheet.getRange(keeperRow, target.cumulativeCol);
    const iCell = before.sheet.getRange(keeperRow, target.incrementCol);
    const afterDateValues = before.dateCols.map(function(item) {
      return before.sheet.getRange(keeperRow, item.col).getValue();
    });
    if (Number(hCell.getValue()) !== target.cumulative || !hCell.getFormula() || !iCell.getFormula()) {
      throw new Error("정본행 H/I 사후검증 실패");
    }
    if (JSON.stringify(afterDateValues) !== JSON.stringify(before.keeper.dateValues)) {
      throw new Error("정본행 날짜값 변경 감지");
    }
    const result = {
      status: "OK",
      backupSheet: backupName,
      beforeLastRow: before.lastRow,
      afterLastRow: before.sheet.getLastRow(),
      deletedRows: removalRows,
      keeperRow: keeperRow,
      videoKeyCount: 1,
      profileUrlCount: 0,
      hValue: hCell.getValue(),
      hFormulaPreserved: true,
      iFormulaPreserved: true,
      metricValuesPreserved: true,
      dbWrites: 0,
    };
    Logger.log("issuebox_youtube_duplicate_20260903_result " + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
