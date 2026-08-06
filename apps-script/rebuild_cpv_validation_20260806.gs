/**
 * rebuild_cpv_validation_20260806.gs — CPV(J열) 유효성 #REF!·파편화 재정비.
 *
 * 증상: CPV 셀 값(₩3.48 등)은 정상인데 "유효성 위반" 빨간표시. 원인은 날짜열과 동일 —
 *       행 삽입/삭제로 J열 유효성 규칙이 조각나고 일부에 #REF!가 생겨 값과 무관하게 오탐.
 * 해법: J열 유효성을 싹 지우고, INDEX(J:J,ROW())로 현재 자기셀을 찾는 단일 규칙 재적용.
 *       J2 직접 참조는 그 행이 삭제되면 #REF!가 될 수 있으므로 사용하지 않는다.
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

  var letter = colLetter_(cpvCol);
  var self = 'INDEX(' + letter + ':' + letter + ',ROW())';
  var formula = '=OR(' + self + '="",' + self + '="?",ISNUMBER(' + self + '))';
  Logger.log('CPV 열 = ' + colLetter_(cpvCol) + ' (col ' + cpvCol + '), 행 ' + CONFIG.DATA_START_ROW + '~' + lastRow + ' (' + n + '행)');
  Logger.log('재적용 수식(자기셀만 참조 → #REF! 불가): ' + formula);
  if (DRY_RUN) { Logger.log('[DRY-RUN] 적용 안 함. DRY_RUN=false 로 실제 실행.'); return; }

  var range = sheet.getRange(CONFIG.DATA_START_ROW, cpvCol, n, 1);
  var oldRules = range.getDataValidations();
  var backupRows = [['row', 'criteria_type', 'formula']];
  for (var i = 0; i < oldRules.length; i++) {
    var oldRule = oldRules[i][0];
    var oldValues = oldRule ? oldRule.getCriteriaValues() : [];
    backupRows.push([
      CONFIG.DATA_START_ROW + i,
      oldRule ? String(oldRule.getCriteriaType()) : '',
      String(oldValues && oldValues.length ? oldValues[0] : '')
    ]);
  }
  var stamp = Utilities.formatDate(new Date(), CONFIG.KST_TIMEZONE, 'yyyyMMdd_HHmmss');
  var backupName = '_codex_cpv_validation_backup_' + stamp;
  var backup = sheet.getParent().insertSheet(backupName);
  backup.getRange(1, 1, backupRows.length, 3).setValues(backupRows);
  backup.hideSheet();

  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(formula)
    .setAllowInvalid(true)            // 경고만(값 입력 안 막음)
    .setHelpText('CPV: 숫자 · "?" · 빈칸 허용 (행 삽입·삭제 안전 규칙)')
    .build();
  // 기본 필터로 숨겨진 행은 대량 쓰기에서 건너뛸 수 있다. 기준을 보존해 잠시 해제 후 즉시 복원한다.
  var filter = sheet.getFilter();
  var filterRangeA1 = null;
  var filterCriteria = [];
  if (filter) {
    var filterRange = filter.getRange();
    filterRangeA1 = filterRange.getA1Notation();
    for (var filterCol = filterRange.getColumn(); filterCol <= filterRange.getLastColumn(); filterCol++) {
      var criterion = filter.getColumnFilterCriteria(filterCol);
      if (criterion) filterCriteria.push({ col: filterCol, criterion: criterion });
    }
    filter.remove();
  }
  try {
    range.clearDataValidations();
    range.setDataValidation(rule);
    SpreadsheetApp.flush();
  } finally {
    if (filterRangeA1) {
      var restoredFilter = sheet.getRange(filterRangeA1).createFilter();
      filterCriteria.forEach(function (item) {
        restoredFilter.setColumnFilterCriteria(item.col, item.criterion);
      });
      SpreadsheetApp.flush();
    }
  }

  var newRules = range.getDataValidations();
  var missing = 0, wrongType = 0, refErrors = 0, wrongFormula = 0;
  for (var j = 0; j < newRules.length; j++) {
    var newRule = newRules[j][0];
    if (!newRule) { missing++; continue; }
    if (String(newRule.getCriteriaType()) !== String(SpreadsheetApp.DataValidationCriteria.CUSTOM_FORMULA)) wrongType++;
    var newValues = newRule.getCriteriaValues();
    var newFormula = String(newValues && newValues.length ? newValues[0] : '');
    if (newFormula.indexOf('#REF!') >= 0) refErrors++;
    if (newFormula !== formula) wrongFormula++;
  }
  Logger.log('[실행] CPV(J열) 유효성 재정비 완료 ' + JSON.stringify({
    rows: n,
    formula: formula,
    backup_sheet: backupName,
    missing: missing,
    wrong_type: wrongType,
    ref_errors: refErrors,
    wrong_formula: wrongFormula,
    filter_removed_and_restored: !!filterRangeA1,
    filter_criteria_restored: filterCriteria.length
  }));
}
