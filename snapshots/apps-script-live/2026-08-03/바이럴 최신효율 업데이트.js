function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    if (sheet.getSheetId() === gid) return sheet;
  }
  return null;
}

function normalizeName(name) {
  return name
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/[\s_\-\.]/g, '');
}

function updateExpectedViews__wgimpl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = getSheetByGid(ss, 1937186871);
  const dstSheet = getSheetByGid(ss, 1649102171);
  if (!srcSheet || !dstSheet) { Logger.log('시트를 찾을 수 없음'); return; }

  const srcData = srcSheet.getDataRange().getValues();
  const headers = srcData[0];

  // 날짜 헤더 중 가장 오른쪽 = 최신 성과 열
  let lastPerfCol = -1;
  for (let c = headers.length - 1; c >= 0; c--) {
    const h = headers[c];
    if (h instanceof Date || (typeof h === 'string' && h.match(/\d{4}[-\/]\d{1,2}/))) {
      lastPerfCol = c;
      break;
    }
  }
  if (lastPerfCol === -1) { Logger.log('성과 열을 찾을 수 없음'); return; }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // A=0, C=2, D=3, F=5, I=8
  const channelMap = {};
  for (let r = 1; r < srcData.length; r++) {
    const row = srcData[r];
    const uploadDate = row[0];
    if (!(uploadDate instanceof Date) || uploadDate < cutoff) continue;

    const chName = (row[2] || '').toString().trim();
    const agency  = (row[3] || '').toString().trim();
    const format  = (row[5] || '').toString().replace(/\s/g, '');
    if (format !== '바이럴(영상)' && format !== '바이럴(배너)') continue;

    const perf     = row[lastPerfCol];
    const priceRaw = row[8];
    const price    = typeof priceRaw === 'number' ? priceRaw : parseInt((priceRaw || '').toString().replace(/,/g, '')) || 0;
    if (!chName || typeof perf !== 'number' || perf <= 0) continue;

    const key = normalizeName(chName) + '__' + format;
    if (!channelMap[key]) channelMap[key] = { views: [], price: 0, agency: '', origName: chName, format: format };
    channelMap[key].views.push(perf);
    if (price > 0) channelMap[key].price = price;
    if (agency) channelMap[key].agency = agency;
  }

  const computed = {};
  for (const key in channelMap) {
    const arr = channelMap[key].views;
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    computed[key] = {
      avg,
      price: channelMap[key].price,
      agency: channelMap[key].agency,
      origName: channelMap[key].origName,
      format: channelMap[key].format
    };
  }

  // A=채널명(0), B=업체명(1), C=포맷(2), D=단가(3), E=예상조회수(4), F=평균조회수(5), G=채널URL(6)
  const dstData = dstSheet.getDataRange().getValues();
  const updated = { count: 0, appended: 0 };

  // 기존 행: E열(예상조회수)만 업데이트, D열 건드리지 않음
  for (let r = 1; r < dstData.length; r++) {
    const chName = (dstData[r][0] || '').toString().trim();
    const fmt    = (dstData[r][2] || '').toString().trim();
    const fmtKey = fmt === '릴스' ? '바이럴(영상)' : fmt === '배너' ? '바이럴(배너)' : fmt.replace(/\s/g, '');
    const key    = normalizeName(chName) + '__' + fmtKey;
    if (computed[key] !== undefined) {
      dstSheet.getRange(r + 1, 5).setValue(computed[key].avg);
      updated.count++;
      delete computed[key];
    }
  }

  // 새 채널: A~G 전체 추가
  for (const key in computed) {
    const { avg, price, agency, origName, format } = computed[key];
    const displayFormat = format === '바이럴(영상)' ? '릴스' : '배너';
    dstSheet.appendRow([
      origName,
      agency || '',
      displayFormat,
      price > 0 ? price : '',
      avg,
      '',
      ''
    ]);
    updated.appended++;
  }

  Logger.log(`업데이트: ${updated.count}개, 신규 추가: ${updated.appended}개`);
}

function setWeeklyTrigger() {
  ScriptApp.newTrigger('updateExpectedViews')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
}
// 동시편집 행 밀림 방지: 공용 withDocLock_는 메인 파일에 정의됨
function updateExpectedViews(){ var a=arguments,t=this; return withDocLock_(function(){ return updateExpectedViews__wgimpl.apply(t,a); }); }
