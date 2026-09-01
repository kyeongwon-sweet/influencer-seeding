/**
 * 콘텐츠 대시보드 연동 탭의 읽기 전용 시각 서식.
 *
 * 안전 원칙
 * - 값·수식·유효성·필터·조건부서식은 변경하지 않는다.
 * - 열 너비, 행 높이, 고정 영역, 글꼴/정렬, 숫자 표시형식, 헤더 색만 다룬다.
 * - URL/날짜 헤더로 정본 탭을 검증한 뒤에만 실행한다.
 */

var LINKED_READABILITY_SHEET_GID_ = 1937186871;
var LINKED_READABILITY_DATE_START_COL_ = 16; // P열

function linkedReadabilitySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === LINKED_READABILITY_SHEET_GID_) return sheets[i];
  }
  throw new Error("콘텐츠 대시보드 연동 탭(gid=1937186871)을 찾지 못했습니다.");
}

function linkedReadabilityDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "number" && value >= 44000 && value <= 48000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  var s = String(value == null ? "" : value).trim();
  var m = s.match(/(?:(20\d{2})[.\/-]\s*)?(\d{1,2})[.\/-]\s*(\d{1,2})/);
  if (!m) return null;
  var year = Number(m[1] || 2026), month = Number(m[2]), day = Number(m[3]);
  var d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function assertLinkedReadabilityTarget_(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.min(15, sheet.getLastColumn())).getDisplayValues()[0];
  var a = String(headers[0] || "").replace(/\s/g, "");
  var b = String(headers[1] || "").replace(/\s/g, "").toLowerCase();
  if (a.indexOf("업로드일") < 0 || b.indexOf("url") < 0) {
    throw new Error("대상 검증 실패: A열=업로드일, B열=게시물URL 헤더가 아닙니다.");
  }
}

function styleLinkedSheetDateColumns_(sheet, startCol, numCols) {
  if (!numCols || numCols < 1) return;
  var lastRow = Math.max(2, sheet.getLastRow());
  var range = sheet.getRange(1, startCol, lastRow, numCols);
  var headerRange = sheet.getRange(1, startCol, 1, numCols);
  var values = headerRange.getValues()[0];

  sheet.setColumnWidths(startCol, numCols, 78);
  headerRange
    .setBackground("#334155")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setNumberFormat("yy.m.d.(ddd)");
  if (lastRow > 1) {
    sheet.getRange(2, startCol, lastRow - 1, numCols)
      .setHorizontalAlignment("right")
      .setVerticalAlignment("middle")
      .setNumberFormat("#,##0");
  }

  for (var i = 0; i < values.length; i++) {
    var d = linkedReadabilityDate_(values[i]);
    if (!d) continue;
    var col = startCol + i;
    var day = d.getDay();
    if (day === 0 || day === 6) {
      sheet.getRange(1, col).setBackground("#475569");
    }
    if (day === 1 || d.getDate() === 1) {
      sheet.getRange(1, col, lastRow, 1).setBorder(
        null, true, null, null, null, null, "#94A3B8", SpreadsheetApp.BorderStyle.SOLID_MEDIUM
      );
    }
  }
}

function inspectLinkedSheetReadabilityTheme() {
  var sheet = linkedReadabilitySheet_();
  assertLinkedReadabilityTarget_(sheet);
  var summary = {
    sheet: sheet.getName(),
    rows: sheet.getLastRow(),
    columns: sheet.getLastColumn(),
    frozenRows: sheet.getFrozenRows(),
    frozenColumns: sheet.getFrozenColumns(),
    dateStartColumn: LINKED_READABILITY_DATE_START_COL_
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}

function applyLinkedSheetReadabilityTheme() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error("다른 시트 작업이 실행 중입니다. 잠시 후 다시 시도해 주세요.");
  try {
    var sheet = linkedReadabilitySheet_();
    assertLinkedReadabilityTarget_(sheet);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < LINKED_READABILITY_DATE_START_COL_) {
      throw new Error("서식을 적용할 데이터 범위를 찾지 못했습니다.");
    }

    // 상단 핵심 식별정보(A:D)만 고정해 날짜 이력 영역을 넓게 보이게 한다.
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(4);
    sheet.setHiddenGridlines(false);
    sheet.setTabColor("#2563EB");
    sheet.setRowHeight(1, 38);
    sheet.setRowHeights(2, lastRow - 1, 27);

    var all = sheet.getRange(1, 1, lastRow, lastCol);
    all.setFontFamily("Noto Sans KR").setFontSize(10).setVerticalAlignment("middle");
    sheet.getRange(2, 1, lastRow - 1, Math.min(15, lastCol))
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    // 의미 단위별 헤더 색: 식별 / 콘텐츠 / 성과 / 담당·상태 / 일자별 이력.
    sheet.getRange(1, 1, 1, 4).setBackground("#DBEAFE").setFontColor("#1E3A8A");
    sheet.getRange(1, 5, 1, 2).setBackground("#EDE9FE").setFontColor("#5B21B6");
    sheet.getRange(1, 7, 1, 4).setBackground("#DCFCE7").setFontColor("#166534");
    sheet.getRange(1, 11, 1, 5).setBackground("#FFEDD5").setFontColor("#9A3412");
    sheet.getRange(1, 1, 1, Math.min(15, lastCol))
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true)
      .setBorder(null, null, true, null, null, null, "#94A3B8", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

    var widths = [96, 220, 132, 132, 360, 72, 92, 94, 88, 90, 82, 82, 280, 112, 104];
    for (var c = 0; c < widths.length && c < lastCol; c++) sheet.setColumnWidth(c + 1, widths[c]);

    sheet.getRange(2, 1, lastRow - 1, 1).setHorizontalAlignment("center").setNumberFormat("yyyy. m. d.");
    sheet.getRange(2, 2, lastRow - 1, 1).setHorizontalAlignment("left");
    sheet.getRange(2, 3, lastRow - 1, 1).setHorizontalAlignment("center");
    sheet.getRange(2, 4, lastRow - 1, 1).setHorizontalAlignment("left");
    sheet.getRange(2, 5, lastRow - 1, 1).setHorizontalAlignment("right");   // 소재명(헤더 제외)
    sheet.getRange(2, 6, lastRow - 1, 1).setHorizontalAlignment("center");
    sheet.getRange(2, 7, lastRow - 1, 1).setHorizontalAlignment("center").setNumberFormat("₩#,##0");
    sheet.getRange(2, 8, lastRow - 1, 2).setHorizontalAlignment("center").setNumberFormat("#,##0");
    sheet.getRange(2, 10, lastRow - 1, 1).setHorizontalAlignment("center").setNumberFormat("₩#,##0.00");
    sheet.getRange(2, 11, lastRow - 1, 2).setHorizontalAlignment("center");
    sheet.getRange(2, 13, lastRow - 1, 1).setHorizontalAlignment("left");   // 캡션
    sheet.getRange(2, 14, lastRow - 1, 2).setHorizontalAlignment("center");

    styleLinkedSheetDateColumns_(
      sheet,
      LINKED_READABILITY_DATE_START_COL_,
      lastCol - LINKED_READABILITY_DATE_START_COL_ + 1
    );

    SpreadsheetApp.flush();
    var result = inspectLinkedSheetReadabilityTheme();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "값·수식은 그대로 두고 가독성 서식만 적용했습니다.",
      "연동 시트 디자인",
      5
    );
    return result;
  } finally {
    lock.releaseLock();
  }
}

