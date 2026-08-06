/**
 * rebuild_cpv_validation_20260806.gs — CPV(J열) 유효성 #REF!·파편화 재정비.
 *
 * 증상: CPV 셀 값(₩3.48 등)은 정상인데 "유효성 위반" 빨간표시. 원인은 날짜열과 동일 —
 *       행 삽입/삭제로 J열 유효성 규칙이 조각나고 일부에 #REF!가 생겨 값과 무관하게 오탐.
 * 해법: J열 유효성을 싹 지우고, 자기셀만 참조하는(=#REF! 불가) 깨끗한 단일 규칙 재적용.
 *       CPV 허용값 = 빈칸 · "?" · 숫자. 경고모드(setAllowInvalid=true, 입력 차단 아님).
 *
 * ⚠️ H 사고 교훈 적용: 범위는 J열만(최소), DRY_RUN 우선, 자동 트리거 안 검. 실행 전후 formula-audit로 H/I 무영향 확인.
 * ⚠️ 시트 쓰기 lane: 하네스가 Claude 저장 차단 → 사용자/Codex 실행.
 *   프로젝트의 CONFIG/getSheet_/findHeaderCol_/colLetter_ 재사용.
 */
function rebuildCpvValidation() {
  var DRY_RUN = true;                 // ← 로그 확인 후 false 로 실제 적용
  var GID = 1937186871;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === GID; })[0];
  if (!sheet) { Logger.log('GID ' + GID + ' 탭 없음'); return; }

  var cpvCol = findHeaderCol_(sheet, ["CPV"]);
  if (!cpvCol) { Logger.log('CPV 열을 못 찾음(헤더 확인 필요)'); return; }
  var lastRow = sheet.getLastRow();
  var n = lastRow - CONFIG.DATA_START_ROW + 1;
  if (n < 1) { Logger.log('데이터 행 없음'); return; }

  var tl = colLetter_(cpvCol) + CONFIG.DATA_START_ROW;
  var formula = '=OR(' + tl + '="",' + tl + '="?",ISNUMBER(' + tl + '))';
  Logger.log('CPV 열 = ' + colLetter_(cpvCol) + ' (col ' + cpvCol + '), 행 ' + CONFIG.DATA_START_ROW + '~' + lastRow + ' (' + n + '행)');
  Logger.log('재적용 수식(자기셀만 참조 → #REF! 불가): ' + formula);
  if (DRY_RUN) { Logger.log('[DRY-RUN] 적용 안 함. DRY_RUN=false 로 실제 실행.'); return; }

  var range = sheet.getRange(CONFIG.DATA_START_ROW, cpvCol, n, 1);
  range.clearDataValidations();       // 기존 파편·#REF! 규칙 제거(J열만)
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(formula)
    .setAllowInvalid(true)            // 경고만(값 입력 안 막음)
    .setHelpText('CPV: 숫자 · "?" · 빈칸 허용 (자동 재정비 규칙)')
    .build();
  range.setDataValidation(rule);
  Logger.log('[실행] CPV(J열) 유효성 재정비 완료 — ' + n + '행 단일 규칙. #REF!·파편 제거.');
}
