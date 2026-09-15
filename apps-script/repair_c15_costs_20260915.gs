/**
 * C15 가격미매핑 중 연동시트에서 60,000원 근거가 유일하게 확인된 4건만 복구한다.
 * DB는 건드리지 않으며 URL key, 계정, 기존 비용, 수식 없음이 모두 맞아야 쓴다.
 */

var C15_COST_REPAIR_20260915_ = Object.freeze({
  signature: "repair-c15-costs-2026-09-15",
  expectedCost: 60000,
  backupPrefix: "_codex_c15_cost_backup_20260915",
  targets: [
    { label: "힐링하고 가세요", key: "tt:7675271025176661269", account: "힐링하고 가세요" },
    { label: "wikitrip", key: "ig:DcQQ2npCWJL", account: "wikitrip" },
    { label: "happy__pyeong", key: "ig:DcakMZokd2s", account: "happy__pyeong" },
    { label: "맨투맨 스튜디오(틱톡)", key: "tt:7681587607020506389", account: "맨투맨 스튜디오(틱톡)" },
  ],
});

function c15CostRepairSnapshot20260915_() {
  var target = C15_COST_REPAIR_20260915_;
  var sheet = getSheet_();
  var fields = buildFieldCols_(sheet);
  if (!fields.url || !fields.account_name || !fields.cost) {
    throw new Error("필수 열(URL/채널명/비용)을 찾을 수 없습니다.");
  }
  var lastRow = sheet.getLastRow();
  var rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  var urls = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, fields.url, rowCount, 1).getValues()
    : [];
  var accounts = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, fields.account_name, rowCount, 1).getValues()
    : [];
  var costs = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, fields.cost, rowCount, 1).getValues()
    : [];
  var formulas = rowCount
    ? sheet.getRange(CONFIG.DATA_START_ROW, fields.cost, rowCount, 1).getFormulas()
    : [];

  var matches = {};
  target.targets.forEach(function(item) { matches[item.key] = []; });
  urls.forEach(function(row, index) {
    var key = String(linkKey_(String(row[0] || "")) || "");
    if (!Object.prototype.hasOwnProperty.call(matches, key)) return;
    matches[key].push({
      row: CONFIG.DATA_START_ROW + index,
      url: String(row[0] || "").trim(),
      account: String(accounts[index][0] || "").trim(),
      cost: costs[index][0] === "" || costs[index][0] == null ? null : Number(costs[index][0]),
      formula: String(formulas[index][0] || ""),
    });
  });

  var rows = target.targets.map(function(item) {
    var found = matches[item.key] || [];
    var match = found.length === 1 ? found[0] : null;
    var safe = Boolean(match)
      && match.account === item.account
      && (match.cost === 0 || match.cost === target.expectedCost)
      && match.formula === "";
    return {
      label: item.label,
      key: item.key,
      expectedAccount: item.account,
      matchCount: found.length,
      row: match ? match.row : null,
      url: match ? match.url : "",
      account: match ? match.account : "",
      cost: match ? match.cost : null,
      formula: match ? match.formula : "",
      costA1: match ? colLetter_(fields.cost) + match.row : "",
      safe: safe,
    };
  });
  return { sheet: sheet, fields: fields, lastRow: lastRow, rows: rows };
}

function c15CostRepairPublic20260915_(snapshot, status, backupName) {
  return {
    ok: snapshot.rows.every(function(row) { return row.safe; }),
    status: status,
    expectedCost: C15_COST_REPAIR_20260915_.expectedCost,
    backupSheet: backupName || null,
    rows: snapshot.rows.map(function(row) {
      return {
        label: row.label,
        key: row.key,
        matchCount: row.matchCount,
        row: row.row,
        costA1: row.costA1,
        cost: row.cost,
        formula: row.formula,
        safe: row.safe,
      };
    }),
  };
}

function repairC15Costs20260915(signature) {
  var target = C15_COST_REPAIR_20260915_;
  if (signature !== target.signature) throw new Error("승인 서명 불일치");
  var snapshot = c15CostRepairSnapshot20260915_();
  if (snapshot.rows.length !== target.targets.length || snapshot.rows.some(function(row) { return !row.safe; })) {
    throw new Error("C15 비용 감사 실패: " + JSON.stringify(c15CostRepairPublic20260915_(snapshot, "BLOCKED")));
  }
  var pending = snapshot.rows.some(function(row) { return row.cost !== target.expectedCost; });
  return c15CostRepairPublic20260915_(snapshot, pending ? "DRY_RUN" : "ALREADY_DONE");
}

function auditC15Costs20260915() {
  var result = repairC15Costs20260915(C15_COST_REPAIR_20260915_.signature);
  Logger.log("audit_c15_costs_20260915 " + JSON.stringify(result));
  return result;
}

function applyC15Costs20260915() {
  throw new Error("이 일회성 복구 함수는 2026-09-15 완료 후 영구 차단됐습니다.");
}
