/**
 * clear_banner_fri_sat_reverse_20260805.gs — 배너(바이럴 배너) 금/토 셀 중 '확실한 특이값(역행)'만 비운다.
 *
 * 배경: 비활성화된 run_monitoring 스냅샷 + 옛 exportStats가 금/토(배너 수집불가)에 잘못된 값을 복붙(예 7,834·15,668).
 *       근본원인은 e9a0331로 차단됨(스냅샷 비활성화 + stats-for-sheet 배너 reach 되쓰기 차단).
 *
 * ⚠️ "확실한 특이값만" 정책(사용자 지시): IG 배너 금/토를 무조건 지우지 않는다.
 *    **그 게시물(행)의 이전 최고값(peak)보다 낮은 금/토 값만** 삭제한다(누적 도달수가 줄어드는 건 불가능 → 확실한 오류).
 *    peak 이상인 애매한 금/토 값은 건드리지 않는다(미러링·정상 가능성 보존).
 *
 * ⚠️ 실행 lane: 시트 쓰기는 Codex/수동(하네스가 Claude 저장 차단). _WriteGuard.gs 규약 준수(동시편집 확인).
 *    DRY_RUN=true로 먼저 실행 → 로그에서 대상·이전값(백업) 확인 → false로 실제 실행.
 */
function clearBannerFriSatReverse() {
  var DRY_RUN = true;                 // ← 로그 확인 후 false 로 바꿔 실제 실행
  var GID = 1937186871;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === GID; })[0];
  if (!sheet) { Logger.log('GID ' + GID + ' 탭 없음'); return; }

  var range = sheet.getDataRange();
  var vals = range.getValues();
  var disp = range.getDisplayValues();
  var header = vals[0], headerDisp = disp[0];

  function findCol(pred) { for (var c = 0; c < headerDisp.length; c++) if (pred(String(headerDisp[c] == null ? '' : headerDisp[c]))) return c; return -1; }
  var chCol  = findCol(function (h) { return h.replace(/\s/g, '').indexOf('채널분류') >= 0; });
  var urlCol = findCol(function (h) { return h.replace(/\s/g, '').indexOf('게시물URL') >= 0 || h.replace(/\s/g, '').toUpperCase().indexOf('URL') >= 0; });
  if (chCol < 0 || urlCol < 0) { Logger.log('열 탐지 실패 ch=' + chCol + ' url=' + urlCol); return; }

  // 날짜열 = 헤더가 Date값. 날짜순 정렬해 peak를 시간순으로 추적.
  var dateCols = [];
  for (var c = 0; c < header.length; c++) {
    var hv = header[c];
    if (Object.prototype.toString.call(hv) === '[object Date]') dateCols.push({ c: c, date: hv, day: hv.getDay(), disp: String(headerDisp[c] == null ? '' : headerDisp[c]) });
  }
  dateCols.sort(function (a, b) { return a.date - b.date; });
  var friSat = dateCols.filter(function (x) { return x.day === 5 || x.day === 6; });
  Logger.log('날짜열 ' + dateCols.length + '개 (금/토 ' + friSat.length + '개). ch=' + (chCol + 1) + ' url=' + (urlCol + 1));

  var cleared = [];
  for (var r = 1; r < vals.length; r++) {
    var ch = String(vals[r][chCol] == null ? '' : vals[r][chCol]);
    if (ch.indexOf('배너') < 0) continue;
    var url = String(vals[r][urlCol] == null ? '' : vals[r][urlCol]);
    if (url.indexOf('instagram.com') < 0) continue;
    var peak = 0;
    for (var i = 0; i < dateCols.length; i++) {
      var dc = dateCols[i], v = vals[r][dc.c];
      if (v === '' || v === null || typeof v !== 'number') continue;   // 빈칸·비숫자 무시
      var isFS = (dc.day === 5 || dc.day === 6);
      if (isFS && v < peak) {                                          // 금/토인데 이전 peak보다 낮음 = 확실한 오류
        cleared.push({ row: r + 1, date: dc.disp, url: url, old: v, peak: peak });
        if (!DRY_RUN) sheet.getRange(r + 1, dc.c + 1).clearContent();
        // 지운(틀린) 값으로는 peak 갱신하지 않음
      } else if (v > peak) {
        peak = v;
      }
    }
  }
  Logger.log((DRY_RUN ? '[DRY-RUN] 지울 대상' : '[실행] 삭제 완료') + ' — 금/토 역행(확실한 특이값) ' + cleared.length + '개');
  cleared.forEach(function (x) { Logger.log('  row ' + x.row + ' [' + x.date + '] old=' + x.old + ' (peak ' + x.peak + ') ' + x.url); });
  return cleared.length;
}
