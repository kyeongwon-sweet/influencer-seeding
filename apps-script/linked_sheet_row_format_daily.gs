/**
 * 연동 시트 행 서식 일상 정규화 — 매일 추가되는 신규 행을 기준 서식으로 맞춘다.
 *
 * 왜 필요한가
 * - 기준 서식은 이미 `linked_sheet_readability_theme_20260812.gs`의
 *   `applyLinkedSheetReadabilityTheme()`에 정의돼 있으나 **수동 1회 실행용**이다.
 *   그래서 매일 syncAll이 append하는 신규 행은 서식이 안 맞은 채 쌓인다.
 * - 그 테마는 글꼴 굵기를 건드리지 않아 채널명(C열) 볼드가 섞여 있었다.
 *   사용자 결정(2026-09-01): 데이터 행 볼드는 전부 해제한다(헤더는 유지).
 *
 * 안전 원칙 (2026-08-06 사고 재발방지)
 * - 그날 나는 "유효성만 바꾸니 안전"이라 판단하고 22만 셀을 대량 변경했다가
 *   refreshCumulativeViews를 촉발해 **H열 1,765행을 손상**시켰다.
 *   서식 변경도 라이브 상호의존 시트에서는 데이터 사고가 된다.
 * - 그래서 이 파일은 **값·수식·유효성·조건부서식·필터를 절대 건드리지 않는다.**
 *   행 높이 / 글꼴(패밀리·크기·굵기) / 정렬 / 숫자 표시형식만 다룬다.
 * - 일상 경로는 **신규 행 범위만** 대상으로 한다(전체 재적용 금지).
 *   전체 1회 정리는 `normalizeAllLinkedRowsOnce()`로 분리하고 백업 후 수동 실행한다.
 * - 대상 탭은 헤더로 검증한 뒤에만 쓴다.
 */

var LINKED_ROW_FORMAT_GID_ = 1937186871;
var LINKED_ROW_FORMAT_DATA_START_ROW_ = 2;
var LINKED_ROW_FORMAT_META_COLS_ = 15;      // A:O — 식별·콘텐츠·성과·담당/상태
var LINKED_ROW_FORMAT_DATE_START_COL_ = 16; // P열부터 일자별 이력
var LINKED_ROW_FORMAT_ROW_HEIGHT_ = 27;
var LINKED_ROW_FORMAT_FONT_FAMILY_ = "Noto Sans KR";
var LINKED_ROW_FORMAT_FONT_SIZE_ = 10;
var LINKED_ROW_FORMAT_POINTER_PROP_ = "LINKED_ROW_FORMAT_LAST_ROW";
var LINKED_ROW_FORMAT_MAX_DAILY_ROWS_ = 400; // 일상 경로 폭주 가드(초과분은 다음 날)

/**
 * 열별 가로 정렬·숫자 표시형식. `applyLinkedSheetReadabilityTheme()`와 동일해야 한다.
 * ⚠️ 두 곳이 어긋나면 매일 서식이 흔들린다 — 계약 테스트가 이 표를 검사한다.
 */
function linkedRowFormatColumnSpecs_() {
  return [
    { col: 1,  span: 1, align: "center", numberFormat: "yyyy. m. d." },
    { col: 2,  span: 1, align: "left" },
    { col: 3,  span: 4, align: "left" },
    { col: 7,  span: 1, align: "right", numberFormat: "₩#,##0" },
    { col: 8,  span: 2, align: "right", numberFormat: "#,##0" },
    { col: 10, span: 1, align: "right", numberFormat: "₩#,##0.00" },
    { col: 11, span: 5, align: "left" }
  ];
}

function linkedRowFormatSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === LINKED_ROW_FORMAT_GID_) return sheets[i];
  }
  throw new Error("연동 시트 탭(gid=" + LINKED_ROW_FORMAT_GID_ + ")을 찾지 못했습니다.");
}

/** 정본 탭인지 헤더로 확인한다. 엉뚱한 탭에 서식을 쓰지 않기 위한 최소 가드. */
function assertLinkedRowFormatTarget_(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.min(3, sheet.getLastColumn())).getDisplayValues()[0];
  var a = String(headers[0] || "").replace(/\s/g, "");
  var b = String(headers[1] || "").replace(/\s/g, "").toLowerCase();
  if (a.indexOf("업로드일") < 0 || b.indexOf("url") < 0) {
    throw new Error("대상 검증 실패: A열=업로드일, B열=게시물URL 헤더가 아닙니다.");
  }
}

/**
 * 지정한 행 범위만 기준 서식으로 맞춘다. 값·수식은 읽지도 쓰지도 않는다.
 * 반환: 적용한 행 수.
 */
function normalizeLinkedRowFormat_(sheet, startRow, endRow) {
  if (!(endRow >= startRow) || startRow < LINKED_ROW_FORMAT_DATA_START_ROW_) return 0;
  var lastCol = sheet.getLastColumn();
  if (lastCol < LINKED_ROW_FORMAT_META_COLS_) {
    throw new Error("열 수가 부족해 서식을 적용하지 않습니다.");
  }
  var numRows = endRow - startRow + 1;

  sheet.setRowHeights(startRow, numRows, LINKED_ROW_FORMAT_ROW_HEIGHT_);

  // 데이터 행 전체: 글꼴·세로정렬·굵기 해제. 헤더(1행)는 범위에 들어가지 않는다.
  sheet.getRange(startRow, 1, numRows, lastCol)
    .setFontFamily(LINKED_ROW_FORMAT_FONT_FAMILY_)
    .setFontSize(LINKED_ROW_FORMAT_FONT_SIZE_)
    .setFontWeight("normal")
    .setVerticalAlignment("middle");

  sheet.getRange(startRow, 1, numRows, Math.min(LINKED_ROW_FORMAT_META_COLS_, lastCol))
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  var specs = linkedRowFormatColumnSpecs_();
  for (var i = 0; i < specs.length; i++) {
    var spec = specs[i];
    if (spec.col > lastCol) continue;
    var span = Math.min(spec.span, lastCol - spec.col + 1);
    var range = sheet.getRange(startRow, spec.col, numRows, span);
    range.setHorizontalAlignment(spec.align);
    if (spec.numberFormat) range.setNumberFormat(spec.numberFormat);
  }

  // 일자별 이력 값은 오른쪽 정렬 + 천단위. 헤더 서식은 건드리지 않는다.
  if (lastCol >= LINKED_ROW_FORMAT_DATE_START_COL_) {
    sheet.getRange(startRow, LINKED_ROW_FORMAT_DATE_START_COL_, numRows,
                   lastCol - LINKED_ROW_FORMAT_DATE_START_COL_ + 1)
      .setHorizontalAlignment("right")
      .setNumberFormat("#,##0");
  }
  return numRows;
}

/**
 * dailyAuto 마지막 단계 — 지난 실행 이후 늘어난 행만 정규화한다.
 *
 * 포인터는 스크립트 속성에 저장한다. 행이 줄었으면(삭제) 포인터를 당겨 맞추고 넘어간다.
 * 하루 상한을 둬서 예기치 못한 대량 증가 때 실행 한도를 넘기지 않게 한다.
 */
function normalizeNewLinkedRowsDaily() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error("다른 시트 작업이 실행 중입니다.");
  try {
    var sheet = linkedRowFormatSheet_();
    assertLinkedRowFormatTarget_(sheet);
    var props = PropertiesService.getScriptProperties();
    var lastRow = sheet.getLastRow();
    var pointer = Number(props.getProperty(LINKED_ROW_FORMAT_POINTER_PROP_) || 0);

    if (!(pointer >= LINKED_ROW_FORMAT_DATA_START_ROW_ - 1) || pointer > lastRow) {
      // 최초 실행이거나 행이 줄었다 — 전체 재적용은 하지 않고 현재 위치만 기록한다.
      props.setProperty(LINKED_ROW_FORMAT_POINTER_PROP_, String(lastRow));
      Logger.log("linked_row_format_daily " + JSON.stringify(
        { status: "POINTER_RESET", last_row: lastRow }));
      return { status: "POINTER_RESET", rows: 0, lastRow: lastRow };
    }

    var startRow = Math.max(pointer + 1, LINKED_ROW_FORMAT_DATA_START_ROW_);
    if (startRow > lastRow) {
      Logger.log("linked_row_format_daily " + JSON.stringify({ status: "NOOP", last_row: lastRow }));
      return { status: "NOOP", rows: 0, lastRow: lastRow };
    }
    var endRow = Math.min(lastRow, startRow + LINKED_ROW_FORMAT_MAX_DAILY_ROWS_ - 1);
    var rows = normalizeLinkedRowFormat_(sheet, startRow, endRow);
    SpreadsheetApp.flush();
    props.setProperty(LINKED_ROW_FORMAT_POINTER_PROP_, String(endRow));
    var result = { status: "OK", rows: rows, startRow: startRow, endRow: endRow, lastRow: lastRow };
    Logger.log("linked_row_format_daily " + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 전체 1회 정리 — 사용자 승인(2026-09-01) 후 수동 실행 전용.
 *
 * ⚠️ 실행 전 체크리스트
 *   1. 시트 버전 사본(백업) 확보
 *   2. 실행 직전 formula-audit 스냅샷(H/I 오류·mismatch 기준값) 기록
 *   3. 실행 직후 formula-audit 재실행 — 기준값과 동일해야 한다
 * 값·수식을 건드리지 않으므로 이론상 안전하지만, 2026-08-06 사고가 정확히
 * "서식만 바꿨는데 데이터가 깨진" 사례였으므로 전후 검증 없이 완료로 보지 않는다.
 */
function normalizeAllLinkedRowsOnce() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error("다른 시트 작업이 실행 중입니다.");
  try {
    var sheet = linkedRowFormatSheet_();
    assertLinkedRowFormatTarget_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < LINKED_ROW_FORMAT_DATA_START_ROW_) {
      return { status: "EMPTY", rows: 0 };
    }
    var rows = normalizeLinkedRowFormat_(sheet, LINKED_ROW_FORMAT_DATA_START_ROW_, lastRow);
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties()
      .setProperty(LINKED_ROW_FORMAT_POINTER_PROP_, String(lastRow));
    var result = { status: "OK", rows: rows, lastRow: lastRow };
    Logger.log("linked_row_format_all " + JSON.stringify(result));
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "값·수식은 그대로 두고 행 서식만 " + rows + "행 통일했습니다.",
      "연동 시트 서식", 5);
    return result;
  } finally {
    lock.releaseLock();
  }
}
