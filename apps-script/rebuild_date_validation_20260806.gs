/**
 * rebuild_date_validation_20260806.gs
 * 날짜열(일자별 조회수/도달수) 유효성 검사를 '단일 규칙'으로 재정비 + 재발방지.
 *
 * 문제: 날짜열 유효성이 경계고정 범위(P2:CX409 등) + 특정셀 참조 수식이라,
 *       행 삽입/삭제 때마다 수백 조각으로 파편화되고 일부가 #REF!로 깨져 오탐 발생.
 *
 * 해법: ① 날짜열 블록 전체의 기존(파편·#REF!) 유효성을 싹 지우고
 *       ② 상대참조만 쓰는 깨끗한 수식 하나를 블록 전체에 재적용(경고 모드, 입력 차단 아님).
 *       ③ 이 함수를 매일 트리거로 돌리면 파편화돼도 자동 재정비(self-healing) → 재발방지.
 *
 * ⚠️ 단조증가(역행) 검사는 여기 넣지 않는다. 시트 수식으로 넣으면 다시 깨지기 쉽다.
 *    역행 감지는 DB 워치독(매일 Slack 알림)이 담당 — 시트 편집과 무관하게 안정적.
 *
 * ⚠️ 실행 lane: 시트 쓰기는 Codex/수동(하네스가 Claude 저장 차단). _WriteGuard 규약 준수.
 *    DRY_RUN=true로 먼저 실행 → 로그(대상 열·행·수식) 확인 → false로 실제 적용.
 *    setAllowInvalid(true)라 값 입력을 막지 않고 빨간 모서리 경고만 표시(기존과 동일 UX).
 *    날짜열(헤더가 날짜값인 열)만 건드림 — A~K 메타데이터 열 규칙은 손대지 않음.
 */
function rebuildDateColumnValidation() {
  var DRY_RUN = true;                 // ← 로그 확인 후 false 로 실제 적용
  var GID = 1937186871;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === GID; })[0];
  if (!sheet) { Logger.log('GID ' + GID + ' 탭 없음'); return; }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // 날짜열 = 헤더(1행)가 날짜값인 열
  var dateCols = [];
  for (var c = 0; c < header.length; c++) {
    if (Object.prototype.toString.call(header[c]) === '[object Date]') dateCols.push(c + 1); // 1-based
  }
  if (!dateCols.length) { Logger.log('날짜열을 못 찾음(헤더가 날짜값이 아님)'); return; }

  var firstCol = Math.min.apply(null, dateCols);
  var lastColD = Math.max.apply(null, dateCols);
  var numCols = lastColD - firstCol + 1;
  var numRows = lastRow - 1; // 2행부터

  var tlLetter = columnToLetter_(firstCol);
  var tl = tlLetter + '2';
  // 깨끗한 수식: 빈칸 OR (숫자이고 그 열 날짜가 오늘 이하). 상대참조 + 1행 절대(안 깨짐).
  var formula = '=OR(' + tl + '="",AND(ISNUMBER(' + tl + '),' + tlLetter + '$1<=TODAY()))';

  Logger.log('날짜열 ' + columnToLetter_(firstCol) + '~' + columnToLetter_(lastColD) + ' (' + numCols + '열), 행 2~' + lastRow + ' (' + numRows + '행)');
  Logger.log('재적용 수식(좌상단 기준): ' + formula);

  if (DRY_RUN) { Logger.log('[DRY-RUN] 적용 안 함. 로그 확인 후 DRY_RUN=false 로 실제 실행.'); return; }

  var range = sheet.getRange(2, firstCol, numRows, numCols);
  range.clearDataValidations();       // 기존 파편·#REF! 규칙 제거(날짜열만)
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(formula)
    .setAllowInvalid(true)            // 경고만(입력 차단 아님)
    .setHelpText('숫자만 · 미래 날짜열엔 값 금지 (자동 재정비 규칙). 역행 감지는 DB 워치독 담당.')
    .build();
  range.setDataValidation(rule);
  Logger.log('[실행] 날짜열 ' + numCols + '열 × ' + numRows + '행에 단일 규칙 재적용 완료. #REF!·파편 제거됨.');
}

function columnToLetter_(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - m) / 26); }
  return s;
}

/**
 * 재발방지: 매일 새벽 rebuildDateColumnValidation 을 자동 실행하는 트리거를 설치한다(한 번만 실행).
 * ⚠️ 먼저 rebuildDateColumnValidation 의 DRY_RUN 을 false 로 바꿔 저장할 것 —
 *    안 그러면 트리거가 매일 dry-run(아무것도 안 함)만 돈다.
 * 동일 트리거는 중복 설치되지 않게 먼저 지운다.
 */
function installDailyRebuildTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuildDateColumnValidation') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildDateColumnValidation').timeBased().everyDays(1).atHour(3).create();
  Logger.log('설치 완료: 매일 03시(스크립트 시간대=KST) rebuildDateColumnValidation 자동 실행. '
    + '※ DRY_RUN=false 로 저장돼 있어야 실제 재정비됨.');
}
