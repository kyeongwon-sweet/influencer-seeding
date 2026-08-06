/**
 * restore_cumulative_20260806.gs — 누적조회수(H) 긴급 복구 + 내가 건 트리거 제거.
 *
 * 사고(2026-08-06): 날짜 헤더 97개 중 81개가 '숫자(serial)'로 저장돼 있어,
 * dailyAuto의 refreshCumulativeViews가 마지막 16개(Date형)만 날짜열로 인식 →
 * H 수식이 =MAX(CS:DH)로 좁혀 재작성됨 → 옛 데이터 행 1,765개의 H가 빈칸("").
 * (데이터 손실 없음. 날짜칸 값은 그대로. H 수식 범위만 잘못됨.)
 *
 * ① removeRebuildTrigger()  — 내가 건 매일 rebuildDateColumnValidation 트리거 제거(재발 방지 차단)
 * ② rebuildCumulativeFormulas_fix() — 숫자형 헤더까지 인식해 H 수식을 '전체 날짜열'로 재작성(복구)
 *    ※ 프로젝트의 CONFIG/getSheet_/findHeaderCol_/colLetter_ 를 그대로 재사용한다.
 *    ※ refreshCumulativeViews와 동일한 '수동 입력값 보존' 로직 유지.
 */
function removeRebuildTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuildDateColumnValidation') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('rebuildDateColumnValidation 트리거 ' + n + '개 삭제 완료.');
}

function rebuildCumulativeFormulas_fix() {
  const sheet = getSheet_();
  const lastCol = sheet.getLastColumn();
  const cumCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  if (!cumCol) { Logger.log('누적 열 못 찾음'); return; }
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const dateRe = /^\s*(?:\d{2,4}\s*[.]\s*)?\d{1,2}\s*[.]\s*\d{1,2}\s*[.]?\s*(\s|\(|$)/;
  const dateCols = [];
  for (let i = CONFIG.STATS_FIRST_COL - 1; i < headers.length; i++) {
    const h = headers[i];
    const isSerialDate = typeof h === "number" && h >= 44000 && h <= 48000;   // 서식 풀린 날짜 serial
    if (h instanceof Date || isSerialDate || dateRe.test(String(h))) dateCols.push(i + 1);
  }
  if (!dateCols.length) { Logger.log('날짜열 못 찾음'); return; }
  const firstDateCol = Math.min.apply(null, dateCols);
  const lastDateCol = Math.max.apply(null, dateCols);
  const firstDate = colLetter_(firstDateCol);
  const lastDate = colLetter_(lastDateCol);
  Logger.log('날짜열 ' + firstDate + '~' + lastDate + ' (' + dateCols.length + '개) 로 H 수식 재작성');

  const lastRow = sheet.getLastRow();
  const n = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  if (!n) return;
  const range = sheet.getRange(CONFIG.DATA_START_ROW, cumCol, n, 1);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const daily = sheet.getRange(CONFIG.DATA_START_ROW, firstDateCol, n, lastDateCol - firstDateCol + 1).getValues();

  const out = [];
  let wrote = 0, manualKept = 0;
  for (let i = 0; i < n; i++) {
    const r = CONFIG.DATA_START_ROW + i;
    const hasFormula = formulas[i][0] !== "";
    const cur = values[i][0];
    const hasValue = cur !== "" && cur != null;
    let rowMax = null;
    for (let j = 0; j < daily[i].length; j++) {
      const v = daily[i][j];
      if (typeof v === "number" && v > 0 && (rowMax === null || v > rowMax)) rowMax = v;
    }
    const f = "=IF(COUNT(" + firstDate + r + ":" + lastDate + r + ")=0,\"\",MAX(" + firstDate + r + ":" + lastDate + r + "))";
    if (rowMax !== null) {
      if (!hasFormula && hasValue && Number(cur) !== rowMax) { out.push([cur]); manualKept++; continue; }
      out.push([f]); wrote++; continue;
    }
    if (!hasFormula && hasValue) { out.push([cur]); manualKept++; }
    else { out.push([f]); wrote++; }
  }
  range.setValues(out);
  Logger.log('[완료] 누적 수식 ' + wrote + '행 재작성(전체 날짜열 ' + firstDate + ':' + lastDate + ') · 수동보존 ' + manualKept + '건');
}
