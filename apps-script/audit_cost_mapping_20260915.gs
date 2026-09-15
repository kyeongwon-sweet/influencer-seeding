/**
 * C15 가격미매핑 11건의 연동시트 비용과 가격표 후보를 읽기 전용으로 확인한다.
 * 시트/DB 쓰기는 없으며 URL 정규키가 정확히 일치하는 행만 보고한다.
 */
function auditCostMapping20260915(signature) {
  const SIGNATURE = "cost-mapping-audit-2026-09-15";
  if (signature !== SIGNATURE) throw new Error("가격 매핑 감사 서명이 올바르지 않습니다.");

  const targets = [
    { label: "힐링하고 가세요", url: "https://www.tiktok.com/@healing0315/photo/7675271025176661269/" },
    { label: "wikitrip", url: "https://www.instagram.com/p/DcQQ2npCWJL/" },
    { label: "happy__pyeong", url: "https://www.instagram.com/p/DcakMZokd2s/" },
    { label: "음식덕후", url: "https://www.tiktok.com/@mhduchu/photo/7678986191189937416/" },
    { label: "맨투맨 스튜디오(틱톡)", url: "https://www.tiktok.com/@man2man_studio/photo/7681587607020506389/" },
    { label: "shoushou.mgz 08-28", url: "https://www.instagram.com/p/Dcm6_35k8fT/" },
    { label: "shoushou.mgz 09-02", url: "https://www.instagram.com/p/DcyGTvHSm5a/" },
    { label: "김쏘콩", url: "https://www.instagram.com/p/DdLeIVWJ7u5/" },
    { label: "후루룹", url: "https://www.instagram.com/p/DdOwP2pz8dQ/" },
    { label: "챱챱쓰", url: "https://www.instagram.com/p/DdOqhr6hrEc/" },
    { label: "빵야", url: "https://www.instagram.com/p/DdOe1TxJz2k/" },
  ];

  const sheet = getSheet_();
  const fields = buildFieldCols_(sheet);
  if (!fields.url || !fields.cost || !fields.account_name || !fields.channel_type) {
    throw new Error("필수 열(URL/비용/채널명/채널분류)을 찾을 수 없습니다.");
  }
  const lastRow = sheet.getLastRow();
  const rowCount = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  const values = rowCount ? sheet.getRange(CONFIG.DATA_START_ROW, 1, rowCount, sheet.getLastColumn()).getValues() : [];
  const costFormulas = rowCount ? sheet.getRange(CONFIG.DATA_START_ROW, fields.cost, rowCount, 1).getFormulas() : [];
  const targetByKey = {};
  targets.forEach(function(target) {
    const key = linkKey_(target.url);
    if (!key) throw new Error("대상 URL 정규화 실패: " + target.url);
    target.key = key;
    targetByKey[key] = target;
  });

  const matchesByKey = {};
  values.forEach(function(row, index) {
    const key = linkKey_(String(row[fields.url - 1] || ""));
    if (!targetByKey[key]) return;
    if (!matchesByKey[key]) matchesByKey[key] = [];
    const posted = fields.posted_at ? row[fields.posted_at - 1] : "";
    matchesByKey[key].push({
      row: CONFIG.DATA_START_ROW + index,
      url: String(row[fields.url - 1] || ""),
      account_name: String(row[fields.account_name - 1] || ""),
      channel_type: String(row[fields.channel_type - 1] || ""),
      company_name: fields.company_name ? String(row[fields.company_name - 1] || "") : "",
      posted_at: posted instanceof Date && !isNaN(posted.getTime())
        ? Utilities.formatDate(posted, CONFIG.KST_TIMEZONE, "yyyy-MM-dd")
        : String(posted || ""),
      cost: row[fields.cost - 1] === "" || row[fields.cost - 1] == null ? null : Number(row[fields.cost - 1]),
      cost_formula: String(costFormulas[index][0] || ""),
    });
  });

  const pricing = getPricingSheet_();
  if (!pricing) throw new Error("가격/업체명 매핑 시트를 찾을 수 없습니다.");
  const pricingValues = pricing.getDataRange().getValues();
  const pricingHeaders = (pricingValues[0] || []).slice(0, 8).map(String);
  const accounts = {};
  Object.keys(matchesByKey).forEach(function(key) {
    matchesByKey[key].forEach(function(row) {
      const normalized = priceChannelKey_(row.account_name);
      if (normalized) accounts[normalized] = true;
    });
  });
  const pricingCandidates = [];
  pricingValues.slice(1).forEach(function(row, index) {
    const account = String(row[0] || "");
    const normalized = priceChannelKey_(account);
    if (!normalized || !accounts[normalized]) return;
    pricingCandidates.push({
      row: index + 2,
      account_name: account,
      company_name: String(row[1] || ""),
      format: String(row[2] || ""),
      cost: row[3] === "" || row[3] == null ? null : Number(row[3]),
      extra: row.slice(4, 8).map(function(value) { return String(value == null ? "" : value); }),
    });
  });

  return {
    ok: true,
    sheet_name: sheet.getName(),
    pricing_sheet_name: pricing.getName(),
    pricing_headers: pricingHeaders,
    targets: targets.map(function(target) {
      return {
        label: target.label,
        key: target.key,
        matches: matchesByKey[target.key] || [],
      };
    }),
    pricing_candidates: pricingCandidates,
  };
}
