/**
 * 25.5_mag 게시일 오기 1건을 실측일로 교정한다.
 * URL key·계정·기존값이 모두 맞을 때 A:O 중 게시일 셀 하나만 수정한다.
 */

var POSTED_AT_REPAIR_20260907_ = Object.freeze({
  signature: "posted-at-25-5-mag-2026-09-07",
  key: "ig:DclKlzuJof6",
  account: "25.5_mag",
  oldDate: "2026-08-30",
  newDate: "2026-08-28",
});

function postedAtRepairSnapshot20260907_() {
  var target = POSTED_AT_REPAIR_20260907_;
  var sheet = getSheet_();
  var fieldCols = buildFieldCols_(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.min(sheet.getLastColumn(), 15);
  var count = lastRow - CONFIG.DATA_START_ROW + 1;
  if (count < 1) throw new Error("연동시트 데이터 행이 없습니다.");

  var values = sheet.getRange(CONFIG.DATA_START_ROW, 1, count, lastCol).getValues();
  var formulas = sheet.getRange(CONFIG.DATA_START_ROW, 1, count, lastCol).getFormulas();
  var matches = [];
  values.forEach(function(row, index) {
    var url = String(row[fieldCols.url - 1] || "").trim();
    if (String(linkKey_(url) || "") !== target.key) return;
    matches.push({
      row: CONFIG.DATA_START_ROW + index,
      url: url,
      account: String(row[fieldCols.account_name - 1] || "").trim(),
      postedAt: toDateStr_(row[fieldCols.posted_at - 1]),
      rawValues: row,
      rawFormulas: formulas[index],
    });
  });
  if (matches.length !== 1) {
    throw new Error("대상 URL key 행 개수 불일치: " + matches.length);
  }
  var match = matches[0];
  if (match.account !== target.account) {
    throw new Error("대상 계정 지문 불일치: " + match.account);
  }
  if (match.postedAt !== target.oldDate && match.postedAt !== target.newDate) {
    throw new Error("기존 게시일 지문 불일치: " + match.postedAt);
  }
  var header = String(sheet.getRange(CONFIG.HEADER_ROW, fieldCols.posted_at).getDisplayValue() || "").trim();
  if (header !== "업로드일" && header !== "게시일") {
    throw new Error("게시일 헤더 지문 불일치: " + header);
  }
  return {
    sheet: sheet,
    fieldCols: fieldCols,
    lastRow: lastRow,
    lastCol: lastCol,
    match: match,
    header: header,
  };
}

function postedAtRepairComparable20260907_(value) {
  if (value instanceof Date) return "date:" + Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  if (value == null) return "null";
  return typeof value + ":" + String(value);
}

function postedAtRepairPublic20260907_(snapshot, status) {
  return {
    ok: true,
    status: status,
    row: snapshot.match.row,
    url: snapshot.match.url,
    key: POSTED_AT_REPAIR_20260907_.key,
    account: snapshot.match.account,
    header: snapshot.header,
    posted_at: snapshot.match.postedAt,
    expected_posted_at: POSTED_AT_REPAIR_20260907_.newDate,
    matched: 1,
    untouched_columns: snapshot.lastCol - 1,
  };
}

function repairPostedAt20260907(signature, apply) {
  if (signature !== POSTED_AT_REPAIR_20260907_.signature) throw new Error("승인 서명 불일치");
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var before = postedAtRepairSnapshot20260907_();
    if (!apply || before.match.postedAt === POSTED_AT_REPAIR_20260907_.newDate) {
      return postedAtRepairPublic20260907_(before, before.match.postedAt === POSTED_AT_REPAIR_20260907_.newDate ? "ALREADY_DONE" : "DRY_RUN");
    }

    assertRowCountStable_(before.sheet, before.lastRow, "repairPostedAt20260907");
    var rowBeforeWrite = before.sheet.getRange(before.match.row, 1, 1, before.lastCol).getValues()[0];
    var formulasBeforeWrite = before.sheet.getRange(before.match.row, 1, 1, before.lastCol).getFormulas()[0];
    if (String(linkKey_(rowBeforeWrite[before.fieldCols.url - 1]) || "") !== POSTED_AT_REPAIR_20260907_.key ||
        toDateStr_(rowBeforeWrite[before.fieldCols.posted_at - 1]) !== POSTED_AT_REPAIR_20260907_.oldDate) {
      throw new Error("쓰기 직전 대상 행 지문 변경 감지");
    }

    var corrected = Utilities.parseDate(POSTED_AT_REPAIR_20260907_.newDate, "Asia/Seoul", "yyyy-MM-dd");
    before.sheet.getRange(before.match.row, before.fieldCols.posted_at).setValue(corrected);
    SpreadsheetApp.flush();

    assertRowCountStable_(before.sheet, before.lastRow, "repairPostedAt20260907 verify");
    var rowAfterWrite = before.sheet.getRange(before.match.row, 1, 1, before.lastCol).getValues()[0];
    var formulasAfterWrite = before.sheet.getRange(before.match.row, 1, 1, before.lastCol).getFormulas()[0];
    for (var col = 0; col < before.lastCol; col++) {
      if (col === before.fieldCols.posted_at - 1) continue;
      if (postedAtRepairComparable20260907_(rowBeforeWrite[col]) !== postedAtRepairComparable20260907_(rowAfterWrite[col]) ||
          formulasBeforeWrite[col] !== formulasAfterWrite[col]) {
        throw new Error("인접셀 변경 감지: " + (col + 1) + "열");
      }
    }

    var after = postedAtRepairSnapshot20260907_();
    if (after.match.row !== before.match.row || after.match.postedAt !== POSTED_AT_REPAIR_20260907_.newDate) {
      throw new Error("게시일 사후검증 실패");
    }
    return postedAtRepairPublic20260907_(after, "OK");
  } finally {
    lock.releaseLock();
  }
}

function verifyPostedAt20260907() {
  var snapshot = postedAtRepairSnapshot20260907_();
  var response = UrlFetchApp.fetch(CONFIG.LIST_API_URL, {
    method: "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("DB 재조회 실패 " + response.getResponseCode() + ": " + response.getContentText());
  }
  var posts = (JSON.parse(response.getContentText()).posts) || [];
  var dbMatches = posts.filter(function(post) {
    return String(linkKey_(String(post.url || "")) || "") === POSTED_AT_REPAIR_20260907_.key;
  });
  if (dbMatches.length !== 1) throw new Error("DB 대상 행 개수 불일치: " + dbMatches.length);
  var dbPostedAt = toDateStr_(dbMatches[0].posted_at);
  if (snapshot.match.postedAt !== POSTED_AT_REPAIR_20260907_.newDate || dbPostedAt !== POSTED_AT_REPAIR_20260907_.newDate) {
    throw new Error("시트/DB 게시일 불일치: " + JSON.stringify({ sheet: snapshot.match.postedAt, db: dbPostedAt }));
  }
  return {
    ok: true,
    status: "VERIFIED",
    row: snapshot.match.row,
    url: snapshot.match.url,
    sheet_posted_at: snapshot.match.postedAt,
    db_posted_at: dbPostedAt,
    db_matches: 1,
  };
}

function auditPostedAt20260907() {
  var result = repairPostedAt20260907(POSTED_AT_REPAIR_20260907_.signature, false);
  Logger.log("audit_posted_at_20260907 " + JSON.stringify(result));
  return result;
}

function applyPostedAt20260907() {
  var result = repairPostedAt20260907(POSTED_AT_REPAIR_20260907_.signature, true);
  Logger.log("apply_posted_at_20260907 " + JSON.stringify(result));
  return result;
}

function syncAndVerifyPostedAt20260907() {
  syncAll();
  var result = verifyPostedAt20260907();
  Logger.log("sync_verify_posted_at_20260907 " + JSON.stringify(result));
  return result;
}
