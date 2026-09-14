/**
 * 슈기 2026-09-08 조회수의 시트 정본을 팀 확인값으로 복구한다.
 * URL key, 계정, 날짜, 기존값이 모두 맞을 때 날짜 셀 하나만 수정한다.
 */

var SHUGI_0908_REPAIR_20260914_ = Object.freeze({
  signature: "shugi-0908-play-2026-09-14",
  key: "ig:DdBU6JmhltN",
  account: "슈기",
  date: "2026-09-08",
  oldValue: 463731,
  newValue: 413000,
});

function shugi0908RepairSnapshot20260914_() {
  var target = SHUGI_0908_REPAIR_20260914_;
  var sheet = getSheet_();
  var fieldCols = buildFieldCols_(sheet);
  var lastRow = sheet.getLastRow();
  var count = lastRow - CONFIG.DATA_START_ROW + 1;
  if (count < 1) throw new Error("연동시트 데이터 행이 없습니다.");

  var dateMatches = metricDateColumns_(sheet).filter(function(item) {
    return item.date === target.date;
  });
  if (dateMatches.length !== 1) {
    throw new Error("대상 날짜 열 개수 불일치: " + dateMatches.length);
  }

  var urls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, count, 1).getValues();
  var accounts = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.account_name, count, 1).getValues();
  var matches = [];
  urls.forEach(function(row, index) {
    var url = String(row[0] || "").trim();
    if (String(linkKey_(url) || "") !== target.key) return;
    matches.push({
      row: CONFIG.DATA_START_ROW + index,
      url: url,
      account: String(accounts[index][0] || "").trim(),
    });
  });
  if (matches.length !== 1) {
    throw new Error("대상 URL key 행 개수 불일치: " + matches.length);
  }
  if (matches[0].account !== target.account) {
    throw new Error("대상 계정 지문 불일치: " + matches[0].account);
  }

  var row = matches[0].row;
  var dateCol = dateMatches[0].col;
  var value = sheet.getRange(row, dateCol).getValue();
  return {
    sheet: sheet,
    lastRow: lastRow,
    match: matches[0],
    dateCol: dateCol,
    dateA1: colLetter_(dateCol) + row,
    value: value,
    cumulativeValue: sheet.getRange(row, 8).getValue(),
    cumulativeFormula: sheet.getRange(row, 8).getFormula(),
    incrementValue: sheet.getRange(row, 9).getValue(),
    incrementFormula: sheet.getRange(row, 9).getFormula(),
    previousValue: sheet.getRange(row, dateCol - 1).getValue(),
    nextValue: sheet.getRange(row, dateCol + 1).getValue(),
  };
}

function shugi0908RepairPublic20260914_(snapshot, status) {
  return {
    ok: true,
    status: status,
    row: snapshot.match.row,
    url: snapshot.match.url,
    key: SHUGI_0908_REPAIR_20260914_.key,
    account: snapshot.match.account,
    date: SHUGI_0908_REPAIR_20260914_.date,
    cell: snapshot.dateA1,
    value: snapshot.value,
    expectedValue: SHUGI_0908_REPAIR_20260914_.newValue,
    previousValue: snapshot.previousValue,
    nextValue: snapshot.nextValue,
    cumulativeValue: snapshot.cumulativeValue,
    cumulativeFormula: snapshot.cumulativeFormula,
    incrementValue: snapshot.incrementValue,
    incrementFormula: snapshot.incrementFormula,
    matched: 1,
  };
}

function repairShugi0908Cell20260914(signature, apply) {
  var target = SHUGI_0908_REPAIR_20260914_;
  if (signature !== target.signature) throw new Error("승인 서명 불일치");
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var before = shugi0908RepairSnapshot20260914_();
    var numericBefore = Number(before.value);
    if (numericBefore !== target.oldValue && numericBefore !== target.newValue) {
      throw new Error("기존 셀값 지문 불일치: " + before.dateA1 + "=" + before.value);
    }
    if (!apply || numericBefore === target.newValue) {
      return shugi0908RepairPublic20260914_(before, numericBefore === target.newValue ? "ALREADY_DONE" : "DRY_RUN");
    }

    assertRowCountStable_(before.sheet, before.lastRow, "repairShugi0908Cell20260914");
    var urlBeforeWrite = String(before.sheet.getRange(before.match.row, buildFieldCols_(before.sheet).url).getValue() || "").trim();
    var valueBeforeWrite = before.sheet.getRange(before.match.row, before.dateCol).getValue();
    if (String(linkKey_(urlBeforeWrite) || "") !== target.key || Number(valueBeforeWrite) !== target.oldValue) {
      throw new Error("쓰기 직전 대상 행 지문 변경 감지");
    }

    before.sheet.getRange(before.match.row, before.dateCol).setValue(target.newValue);
    SpreadsheetApp.flush();

    assertRowCountStable_(before.sheet, before.lastRow, "repairShugi0908Cell20260914 verify");
    var after = shugi0908RepairSnapshot20260914_();
    if (Number(after.value) !== target.newValue || after.match.row !== before.match.row) {
      throw new Error("대상 셀 사후검증 실패");
    }
    if (after.cumulativeFormula !== before.cumulativeFormula || after.incrementFormula !== before.incrementFormula) {
      throw new Error("H/I 수식 변경 감지");
    }
    if (after.previousValue !== before.previousValue || after.nextValue !== before.nextValue) {
      throw new Error("인접 날짜셀 변경 감지");
    }
    return shugi0908RepairPublic20260914_(after, "OK");
  } finally {
    lock.releaseLock();
  }
}

function auditShugi0908Cell20260914() {
  var result = repairShugi0908Cell20260914(SHUGI_0908_REPAIR_20260914_.signature, false);
  Logger.log("audit_shugi_0908_20260914 " + JSON.stringify(result));
  return result;
}

function applyShugi0908Cell20260914() {
  var result = repairShugi0908Cell20260914(SHUGI_0908_REPAIR_20260914_.signature, true);
  Logger.log("apply_shugi_0908_20260914 " + JSON.stringify(result));
  return result;
}
