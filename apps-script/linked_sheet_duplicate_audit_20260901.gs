/**
 * 연동시트 중복 게시물 정밀감사(읽기 전용).
 *
 * checkDuplicates()의 행 번호뿐 아니라 각 중복행의 메타데이터·H/I·날짜이력 요약과
 * DB 정본 통계 요약을 함께 반환한다. URL이 같다는 이유만으로 행을 지워 다른 소재를
 * 잃는 사고를 막기 위한 삭제 전 진단 함수다.
 */

function linkedDuplicateAuditColumnLetter_(column) {
  var out = "";
  var n = Number(column);
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function auditLinkedSheetDuplicates20260901() {
  var sheet = getSheet_();
  var fieldCols = buildFieldCols_(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.DATA_START_ROW) return { duplicateGroups: 0, groups: [] };

  var numRows = lastRow - CONFIG.DATA_START_ROW + 1;
  var range = sheet.getRange(CONFIG.DATA_START_ROW, 1, numRows, lastCol);
  var values = range.getValues();
  var displays = range.getDisplayValues();
  var formulas = range.getFormulas();
  var byKey = {};

  values.forEach(function (row, i) {
    var url = String(row[fieldCols.url - 1] || "").trim();
    if (!url) return;
    var key = linkKey_(url);
    if (!key) return;
    (byKey[key] = byKey[key] || []).push(i);
  });

  var duplicateKeys = Object.keys(byKey).filter(function (key) { return byKey[key].length > 1; });
  var dbByKey = {};
  if (duplicateKeys.length) {
    var wanted = {};
    duplicateKeys.forEach(function (key) { wanted[key] = true; });
    fetchCollectedStats_().forEach(function (post) {
      var key = linkKey_(String(post.key || post.url || ""));
      if (!wanted[key]) return;
      var stats = post.stats || [];
      dbByKey[key] = {
        ended_at: post.ended_at || null,
        statCount: stats.length,
        first: stats.length ? stats[0] : null,
        last: stats.length ? stats[stats.length - 1] : null
      };
    });
  }

  var groups = duplicateKeys.map(function (key) {
    return {
      key: key,
      db: dbByKey[key] || null,
      rows: byKey[key].map(function (i) {
        var row = values[i];
        var display = displays[i];
        var metricCells = [];
        for (var c = 15; c < lastCol; c++) {
          if (row[c] === "" || row[c] == null) continue;
          metricCells.push({
            cell: linkedDuplicateAuditColumnLetter_(c + 1) + (CONFIG.DATA_START_ROW + i),
            value: display[c]
          });
        }
        return {
          row: CONFIG.DATA_START_ROW + i,
          posted_at: display[0],
          url: String(row[fieldCols.url - 1] || "").trim(),
          account: display[2],
          channel_type: display[3],
          asset_name: display[4],
          product: display[5],
          cost: display[6],
          cumulative: display[7],
          increment: display[8],
          planner: display[10],
          creator: display[11],
          caption: display[12],
          company: display[13],
          status: display[14],
          filledCells: row.filter(function (cell) { return cell !== "" && cell != null; }).length,
          metricCellCount: metricCells.length,
          firstMetric: metricCells.length ? metricCells[0] : null,
          lastMetric: metricCells.length ? metricCells[metricCells.length - 1] : null,
          recentMetrics: metricCells.slice(-6),
          hFormula: formulas[i][7] || "",
          iFormula: formulas[i][8] || ""
        };
      })
    };
  });

  var result = {
    sheet: sheet.getName(),
    lastRow: lastRow,
    duplicateGroups: groups.length,
    duplicateExtraRows: groups.reduce(function (sum, group) { return sum + group.rows.length - 1; }, 0),
    groups: groups
  };
  Logger.log("linked_sheet_duplicate_audit " + JSON.stringify(result));
  return result;
}
