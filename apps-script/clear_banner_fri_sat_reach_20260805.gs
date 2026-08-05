/**
 * clear_banner_fri_sat_reach_20260805.gs — 배너(바이럴 배너) 행의 금/토 일자별 도달수 셀 정리(일회성)
 *
 * 배경: run_monitoring 스냅샷 + exportStats가 금/토(배너는 수집불가)까지 잘못 자동채움(예 7,834·15,668).
 *       원인은 e9a0331로 차단됨(스냅샷 비활성화 + stats-for-sheet 배너 reach 되쓰기 차단).
 *       배너 reach 진짜 출처 = banner-reach-sync(시트 per-date → DB, 빈 셀 skip). 시트를 비우면 DB도 다음 동기화에 정리됨.
 *       이 스크립트는 시트에 이미 남은 잘못된 금/토 값을 일회성으로 지운다.
 *
 * ⚠️ 실행 lane: 시트 쓰기는 Codex/수동(하네스가 Claude 저장 차단). _WriteGuard.gs 규약 준수:
 *    - 실행 전 다른 세션/사용자가 이 프로젝트·시트를 편집 중이 아닌지 확인.
 *    - DRY_RUN=true로 먼저 실행 → 실행 로그에서 대상 셀·이전값(백업) 확인 → false로 바꿔 실제 실행.
 *    - clearContent()만 사용(행 밀림 없음). 비어있는 셀은 건드리지 않음.
 *    - IG 배너(URL instagram.com)만 대상(사용자: "인스타그램 배너는 금/토 입력 불가"). 非IG 배너는 카운트만.
 */
function clearBannerFriSatReach() {
  var DRY_RUN = true;                 // ← 로그 확인 후 false로 바꿔 실제 실행
  var GID = 1937186871;               // 콘텐츠 대시보드 연동 탭

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === GID; })[0];
  if (!sheet) { Logger.log('GID ' + GID + ' 탭 없음'); return; }

  var vals = sheet.getDataRange().getValues();
  var header = vals[0];

  function findCol(pred) { for (var c = 0; c < header.length; c++) if (pred(String(header[c] == null ? '' : header[c]))) return c; return -1; }
  var chCol  = findCol(function (h) { return h.replace(/\s/g, '').indexOf('채널분류') >= 0; });
  var urlCol = findCol(function (h) { return h.replace(/\s/g, '').indexOf('게시물URL') >= 0 || h.replace(/\s/g, '').toUpperCase().indexOf('URL') >= 0; });
  if (chCol < 0 || urlCol < 0) { Logger.log('열 탐지 실패 channelType=' + chCol + ' url=' + urlCol); return; }

  var friSatCols = [];
  for (var c = 0; c < header.length; c++) {
    var h = String(header[c] == null ? '' : header[c]);
    if (h.indexOf('(금)') >= 0 || h.indexOf('(토)') >= 0) friSatCols.push({ c: c, h: h });
  }
  Logger.log('열: 채널분류=' + (chCol + 1) + ' URL=' + (urlCol + 1) + ' | 금/토 날짜열 ' + friSatCols.length + '개: ' + friSatCols.map(function (x) { return x.h; }).join(', '));

  var clearedIG = [], skippedNonIG = 0;
  for (var r = 1; r < vals.length; r++) {
    var ch = String(vals[r][chCol] == null ? '' : vals[r][chCol]);
    if (ch.indexOf('배너') < 0) continue;
    var url = String(vals[r][urlCol] == null ? '' : vals[r][urlCol]);
    var isIG = url.indexOf('instagram.com') >= 0;
    for (var i = 0; i < friSatCols.length; i++) {
      var c = friSatCols[i].c, v = vals[r][c];
      if (v === '' || v === null) continue;
      if (!isIG) { skippedNonIG++; continue; }
      clearedIG.push({ row: r + 1, colHeader: friSatCols[i].h, url: url, old: v });
      if (!DRY_RUN) sheet.getRange(r + 1, c + 1).clearContent();
    }
  }

  Logger.log((DRY_RUN ? '[DRY-RUN] 지울 대상' : '[실행] 삭제 완료') + ' — IG 배너 금/토 셀 ' + clearedIG.length + '개 (非IG 배너 금/토 값 ' + skippedNonIG + '개는 미처리)');
  clearedIG.forEach(function (x) { Logger.log('  row ' + x.row + ' [' + x.colHeader + '] old=' + x.old + '  ' + x.url); });
  return clearedIG.length;
}
