function repairTikTokStats20260729() {
  var targetDate = "2026-07-29";
  var videoIds = ["7647855494035426581","7647857902786514196","7647872432384298260","7647881683508743444","7649002915977284885","7649415597738003733","7649417710308265236","7649420906263121172","7649811961563057429","7650507867551993109","7650508317558721813","7650509038157040916","7650527215213415700","7650528540923858197","7650529175073295636","7652687635835620629","7652729322964258069","7654385956182625557","7654391328578669845","7656707663044185364","7656713209381981461","7656721761605635349","7661935334569135380","7661937025888652565","7662311127312796948","7662340941344247060","7662666555720797461","7662668330641165588","7662670473804713236","7662675391336811796","7662675726818233621","7662676352071404821","7662679593614101780","7662680135077743892","7662695295104470292","7662695804527758612","7662696389587094805","7662700769912655125","7662701388060740884","7663027833849171220","7663028619328965908","7663029758988520725","7663030193577200916","7664498173536128276","7664499936486018324","7664501404379188500","7664502556693105941","7664504603555269909","7664534062048136468","7665269525436239125","7665270472749108500","7665663420569603348","7665671805817851157","7665674302238330132","7665676571142819092","7665681604081208596","7665888761741446420","7665889242416958741","7665890031692877077","7665891877094231317","7665892230653021461","7665894732840684820","7665895022981565716","7665896479042669844","7665897994331442453","7665900162237156628","7665966425172905236","7665977180072987925","7666006586111855893","7666008677807115540","7666011340145806613","7666014297432083732","7667152002266287378","7667190463270554888","7667526117305208082","7667528423920782600","7667917090640252168","7667919291517308168"];
  var wanted = {};
  videoIds.forEach(function(id) { wanted["tt:" + id] = true; });

  var expected = {};
  fetchCollectedStats_().forEach(function(p) {
    var key = linkKey_(String(p.key || p.url || ""));
    if (!wanted[key]) return;
    (p.stats || []).forEach(function(pair) {
      var date = String(pair[0]).slice(0, 10);
      var metric = Number(pair[1]);
      if (date === targetDate && metric > 0) expected[key] = metric;
    });
  });

  var sheet = getSheet_();
  var fieldCols = buildFieldCols_(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var targetCol = 0;
  var previousCol = 0;
  var year = CONFIG.STATS_START_YEAR;
  var prevMonth = null;
  for (var c = CONFIG.STATS_FIRST_COL; c <= lastCol; c++) {
    var md = parseMonthDay_(header[c - 1]);
    if (!md) continue;
    if (prevMonth !== null && md.mo < prevMonth) year++;
    prevMonth = md.mo;
    var dateText = year + "-" + ("0" + md.mo).slice(-2) + "-" + ("0" + md.da).slice(-2);
    if (dateText === "2026-07-28") previousCol = c;
    if (dateText === targetDate) targetCol = c;
  }
  if (!targetCol || !previousCol) throw new Error("7/28 또는 7/29 날짜 열을 찾지 못했습니다.");

  var nRows = lastRow - CONFIG.DATA_START_ROW + 1;
  var urls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, nRows, 1).getValues();
  var currentVals = sheet.getRange(CONFIG.DATA_START_ROW, targetCol, nRows, 1).getValues();
  var previousVals = sheet.getRange(CONFIG.DATA_START_ROW, previousCol, nRows, 1).getValues();
  var candidates = [];
  var found = 0;
  var already = 0;
  var noExpected = 0;
  var conflicts = [];

  for (var i = 0; i < nRows; i++) {
    var key = linkKey_(String(urls[i][0] || ""));
    if (!wanted[key]) continue;
    found++;
    var next = expected[key];
    if (!(next > 0)) { noExpected++; continue; }
    var current = currentVals[i][0];
    var previous = previousVals[i][0];
    if (Number(current) === next) { already++; continue; }
    var isBlank = current === "" || current === null;
    var isCarried = Number(current) > 0 && Number(current) === Number(previous);
    if (!isBlank && !isCarried) {
      conflicts.push({row: CONFIG.DATA_START_ROW + i, key: key, current: current, expected: next});
      continue;
    }
    candidates.push({row: CONFIG.DATA_START_ROW + i, key: key, oldValue: current, expected: next});
  }

  var written = 0;
  var concurrentSkips = 0;
  candidates.forEach(function(item) {
    var currentKey = linkKey_(String(sheet.getRange(item.row, fieldCols.url).getValue() || ""));
    var currentValue = sheet.getRange(item.row, targetCol).getValue();
    if (currentKey !== item.key || String(currentValue) !== String(item.oldValue)) {
      concurrentSkips++;
      return;
    }
    sheet.getRange(item.row, targetCol).setValue(item.expected);
    written++;
  });
  SpreadsheetApp.flush();

  var verified = 0;
  candidates.forEach(function(item) {
    if (Number(sheet.getRange(item.row, targetCol).getValue()) === item.expected) verified++;
  });
  var result = {target_date: targetDate, target_ids: videoIds.length, found_rows: found, expected_found: Object.keys(expected).length, written: written, already_correct: already, verified: verified, conflicts: conflicts, no_expected: noExpected, concurrent_skips: concurrentSkips};
  Logger.log("repair_tiktok_20260729 " + JSON.stringify(result));
  return result;
}
