/**
 * 콘텐츠 대시보드 연동 B열 URL에서 공유/추적 파라미터를 제거한다.
 *
 * 라이브 파일명: cleanup_url_params_20260730.gs
 * 여러 번 실행해도 안전하며, 건수를 하드코딩하지 않는다.
 */
function cleanupUrlParamsBColumn20260730() {
  const SPREADSHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
  const TARGET_GID = 1937186871;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(function(s) { return s.getSheetId() === TARGET_GID; });
  if (!sheet) throw new Error("Target sheet gid not found: " + TARGET_GID);

  const lastRow = sheet.getLastRow();
  const numRows = Math.max(0, lastRow - 1);
  if (!numRows) return { ok: true, changed: 0, remainingQuestionMarks: 0 };

  const range = sheet.getRange(2, 2, numRows, 1);
  const beforeValues = range.getValues().map(function(r) { return String(r[0] || "").trim(); });
  const targets = [];
  const counts = { img_index: 0, igsh: 0, utm_source: 0, si: 0, other: 0 };

  for (let i = 0; i < beforeValues.length; i++) {
    const before = beforeValues[i];
    const q = before.indexOf("?");
    if (q < 0) continue;

    const after = before.slice(0, q);
    if (!after) throw new Error("Empty URL after cleanup at row " + (i + 2));

    const keyBefore = cleanupUrlKey20260730_(before);
    const keyAfter = cleanupUrlKey20260730_(after);
    if (!keyBefore || keyBefore !== keyAfter) {
      throw new Error("Join key changed at row " + (i + 2) + ": " + keyBefore + " -> " + keyAfter);
    }

    if (before.indexOf("img_index=") >= 0) counts.img_index++;
    else if (before.indexOf("igsh=") >= 0) counts.igsh++;
    else if (before.indexOf("utm_source=") >= 0) counts.utm_source++;
    else if (before.indexOf("si=") >= 0) counts.si++;
    else counts.other++;

    targets.push({ row: i + 2, before: before, after: after, key: keyAfter });
  }

  if (!targets.length) {
    const emptyResult = {
      ok: true,
      sheetName: sheet.getName(),
      gid: TARGET_GID,
      changed: 0,
      counts: counts,
      remainingQuestionMarks: 0,
    };
    Logger.log("[URL_PARAM_CLEANUP_RESULT] " + JSON.stringify(emptyResult));
    return emptyResult;
  }

  const ts = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
  const backupName = "_codex_url_param_backup_" + ts;
  const backup = ss.insertSheet(backupName);
  backup.getRange(1, 1, 1, 5).setValues([["row", "before_url", "is_target", "after_url", "join_key"]]);
  const backupRows = beforeValues.map(function(before, i) {
    const q = before.indexOf("?");
    const isTarget = q >= 0;
    return [
      i + 2,
      before,
      isTarget,
      isTarget ? before.slice(0, q) : "",
      isTarget ? cleanupUrlKey20260730_(before) : "",
    ];
  });
  backup.getRange(2, 1, backupRows.length, 5).setValues(backupRows);
  backup.hideSheet();

  targets.forEach(function(t) {
    sheet.getRange(t.row, 2).setValue(t.after);
  });
  SpreadsheetApp.flush();

  const afterValues = range.getValues().map(function(r) { return String(r[0] || "").trim(); });
  const mismatches = [];
  targets.forEach(function(t) {
    const got = afterValues[t.row - 2];
    if (got !== t.after || cleanupUrlKey20260730_(got) !== t.key) {
      mismatches.push({ row: t.row, expected: t.after, got: got });
    }
  });
  const remaining = [];
  afterValues.forEach(function(value, i) {
    if (value.indexOf("?") >= 0) remaining.push({ row: i + 2, value: value });
  });
  if (mismatches.length || remaining.length) {
    throw new Error(
      "Verification failed; backup=" + backupName +
      ", mismatches=" + JSON.stringify(mismatches.slice(0, 5)) +
      ", remaining=" + JSON.stringify(remaining.slice(0, 5)),
    );
  }

  const result = {
    ok: true,
    sheetName: sheet.getName(),
    gid: TARGET_GID,
    backupSheet: backupName,
    totalRows: numRows,
    changed: targets.length,
    counts: counts,
    remainingQuestionMarks: remaining.length,
    sample: targets.slice(0, 5),
  };
  Logger.log("[URL_PARAM_CLEANUP_RESULT] " + JSON.stringify(result));
  return result;
}

function cleanupUrlKey20260730_(url) {
  if (typeof linkKey_ === "function") return linkKey_(url);
  const s = String(url || "");
  let m = s.match(/instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
  if (m) return "ig:" + m[1];
  m = s.match(/(?:youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/watch\?v=)([^&/?#]+)/i);
  if (m) return "yt:" + m[1];
  m = s.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/i);
  if (m) return "tt:" + m[1];
  return s.split("?")[0].replace(/\/+$/, "").toLowerCase();
}
