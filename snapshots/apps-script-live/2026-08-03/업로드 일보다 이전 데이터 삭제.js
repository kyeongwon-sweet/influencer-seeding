function myFunction() {
  
}
// [일회용] 게시일(업로드일) 이전 날짜 칸의 일자별 조회수를 전부 삭제.
// 실행하면 먼저 원본 탭을 통째로 복제(백업 탭 생성)한 뒤 지운다. 확인 후 함수·백업 탭 삭제해도 됨.
function clearPrePostedStats() {
  const GID = 1937186871, HEADER_ROW = 1, DATA_START = 2, FIRST_DATE_COL = 9, START_YEAR = 2026;
  const norm = v => String(v == null ? "" : v).replace(/\s+/g, "").toLowerCase();
  const toDateStr = v => {
    if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const s = String(v || "").trim(); if (!s) return null;
    const d = new Date(s); return isNaN(d.getTime()) ? null : Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find(s => s.getSheetId() === GID);
  if (!sheet) throw new Error("연동 탭(gid=" + GID + ")을 찾을 수 없습니다");

  // 1) 백업 탭 생성
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMdd_HHmm");
  const backup = sheet.copyTo(ss).setName("백업_게시일전정리_" + stamp);

  // 2) 헤더 파싱 (게시물URL·업로드일·날짜열)
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  const header = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  let urlCol = 0, postedCol = 0;
  header.forEach((h, i) => {
    if (norm(h) === "게시물url") urlCol = i + 1;
    if (norm(h) === "업로드일") postedCol = i + 1;
  });
  if (!urlCol || !postedCol) throw new Error("게시물URL/업로드일 헤더를 찾지 못했습니다");
  const dateCols = [];
  let year = START_YEAR, prevMonth = null;
  for (let c = FIRST_DATE_COL; c <= lastCol; c++) {
    const raw = header[c - 1];
    let mo, da;
    if (raw instanceof Date && !isNaN(raw.getTime())) { mo = raw.getMonth() + 1; da = raw.getDate(); }
    else { const m = String(raw == null ? "" : raw).match(/(\d{1,2})\D+(\d{1,2})/); if (!m) continue; mo = +m[1]; da = +m[2]; }
    if (prevMonth !== null && mo < prevMonth) year++;
    prevMonth = mo;
    dateCols.push({ col: c, date: year + "-" + ("0" + mo).slice(-2) + "-" + ("0" + da).slice(-2) });
  }

  // 3) 업로드일 이전 날짜 칸 삭제
  const values = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, lastCol).getValues();
  let cells = 0, rows = 0;
  const touched = [];
  values.forEach((row, i) => {
    const url = String(row[urlCol - 1] || "").trim();
    const posted = toDateStr(row[postedCol - 1]);
    if (!url || !posted) return;
    let n = 0;
    dateCols.forEach(dc => {
      if (dc.date < posted && row[dc.col - 1] !== "" && row[dc.col - 1] != null) {
        sheet.getRange(DATA_START + i, dc.col).clearContent();
        n++;
      }
    });
    if (n) { rows++; cells += n; touched.push(url.slice(-22) + " ×" + n); }
  });
  const msg = "✅ 게시일 이전 칸 삭제 완료\n행 " + rows + "개 · 칸 " + cells + "개\n백업 탭: " + backup.getName()
    + "\n\n" + touched.slice(0, 15).join("\n") + (touched.length > 15 ? "\n… 외 " + (touched.length - 15) + "행" : "");
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}