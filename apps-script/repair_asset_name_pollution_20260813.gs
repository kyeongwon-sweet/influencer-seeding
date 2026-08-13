/**
 * 소재명(asset_name) 뒤에 잘못 붙은 업로드 파일 목록 정리.
 *
 * 안전 절차:
 *   inspectAssetNamePollution()       읽기 전용 점검
 *   repairAssetNamePollutionPilot()   URL 기준 앞 5건만 백업 후 정리
 *   repairAssetNamePollutionAll()     남은 전건을 별도 백업 후 정리
 *
 * 시트가 정본이므로 DB만 고치지 않는다. 쓰기 직전에 URL열을 다시 읽고
 * URL key가 유일하며 소재명/제작자 원문이 점검 당시와 같을 때만 수정한다.
 */
const ASSET_POLLUTION_RE_ = /\.(?:zip|png|jpe?g|gif|webp|mp4|mov|pdf)|\s\|\s|\d+\.\s*(?:표지|속지)/i;

function stripAssetFileListing_(value) {
  const text = String(value == null ? "" : value).trim();
  const match = ASSET_POLLUTION_RE_.exec(text);
  if (!match) return text;
  return text.slice(0, match.index).replace(/[\s,|]+$/g, "").trim();
}

function scanAssetNamePollution_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return { sheet: sheet, lastRow: lastRow, candidates: [], blockers: [] };
  const fieldCols = buildFieldCols_(sheet);
  const assetCol = findHeaderCol_(sheet, ["소재명"]);
  const creatorCol = findHeaderCol_(sheet, ["제작자", "PD", "디자이너"]);
  if (!fieldCols.url || !assetCol || !creatorCol) throw new Error("URL/소재명/제작자 열을 찾지 못했습니다.");

  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
  const keyCounts = {};
  for (let i = 0; i < n; i++) {
    const key = linkKey_(String(values[i][fieldCols.url - 1] || ""));
    if (key) keyCounts[key] = (keyCounts[key] || 0) + 1;
  }

  const candidates = [];
  const blockers = [];
  for (let i = 0; i < n; i++) {
    const before = String(values[i][assetCol - 1] || "").trim();
    if (!ASSET_POLLUTION_RE_.test(before)) continue;
    const row = CONFIG.DATA_START_ROW + i;
    const url = String(values[i][fieldCols.url - 1] || "").trim();
    const key = linkKey_(url);
    const after = stripAssetFileListing_(before);
    const creatorBefore = String(values[i][creatorCol - 1] || "").trim();
    const creatorAfter = creatorBefore || String(parseCreator_(after).pd || "").trim();
    const candidate = {
      row: row,
      url: url,
      key: key,
      asset_before: before,
      asset_after: after,
      creator_before: creatorBefore,
      creator_after: creatorAfter,
    };
    candidates.push(candidate);
    if (!key) blockers.push({ row: row, reason: "URL key 없음", url: url });
    else if (keyCounts[key] !== 1) blockers.push({ row: row, reason: "URL key 중복 " + keyCounts[key] + "건", url: url });
    if (!after) blockers.push({ row: row, reason: "정리 후 소재명 빈값", url: url });
    if (!creatorBefore && !isValidLinkedPersonName_(creatorAfter)) {
      blockers.push({ row: row, reason: "빈 제작자 파싱 실패", url: url, creator: creatorAfter });
    }
  }
  return {
    sheet: sheet,
    lastRow: lastRow,
    fieldCols: fieldCols,
    assetCol: assetCol,
    creatorCol: creatorCol,
    candidates: candidates,
    blockers: blockers,
  };
}

function summarizeAssetNamePollution_(scan) {
  const creatorBlank = scan.candidates.filter(function(item) { return !item.creator_before; }).length;
  return {
    polluted: scan.candidates.length,
    creator_blank: creatorBlank,
    blockers: scan.blockers.length,
    blocker_samples: scan.blockers.slice(0, 10),
    samples: scan.candidates.slice(0, 8).map(function(item) {
      return { row: item.row, url: item.url, asset_after: item.asset_after, creator_after: item.creator_after };
    }),
  };
}

function inspectAssetNamePollution() {
  const result = summarizeAssetNamePollution_(scanAssetNamePollution_());
  Logger.log("asset_name_pollution_inspect " + JSON.stringify(result));
  SpreadsheetApp.getActive().toast(
    "소재명 오염 " + result.polluted + "건 · 제작자 빈칸 " + result.creator_blank + "건 · 차단 " + result.blockers + "건",
    result.blockers ? "⚠️ 점검 필요" : "읽기 전용 점검",
    8
  );
  return result;
}

function applyAssetNamePollutionRepair_(limit) {
  return withAutoWriteGuard_(function() {
    const scan = scanAssetNamePollution_();
    if (scan.blockers.length) {
      throw new Error("안전 차단 " + scan.blockers.length + "건: " + JSON.stringify(scan.blockers.slice(0, 5)));
    }
    const selected = limit ? scan.candidates.slice(0, limit) : scan.candidates.slice();
    if (!selected.length) return { applied: 0, creator_filled: 0, remaining: 0, backup_sheet: null };

    // 쓰기 직전 최신 URL 순서를 다시 읽어 현 행번호를 구한다.
    const latestLastRow = scan.sheet.getLastRow();
    const n = latestLastRow - CONFIG.DATA_START_ROW + 1;
    const urls = scan.sheet.getRange(CONFIG.DATA_START_ROW, scan.fieldCols.url, n, 1).getValues();
    const assets = scan.sheet.getRange(CONFIG.DATA_START_ROW, scan.assetCol, n, 1).getValues();
    const creators = scan.sheet.getRange(CONFIG.DATA_START_ROW, scan.creatorCol, n, 1).getValues();
    const index = buildUrlKeyIndex_(urls, linkKey_);
    const assetEdits = [];
    const creatorEdits = [];
    const backupRows = [["row_at_write", "url", "asset_before", "asset_after", "creator_before", "creator_after"]];
    selected.forEach(function(item) {
      if (index.countsByKey[item.key] !== 1) throw new Error("쓰기 직전 URL key 중복/소실: " + item.url);
      const idx = index.firstIndexByKey[item.key];
      const row = CONFIG.DATA_START_ROW + idx;
      const currentAsset = String(assets[idx][0] || "").trim();
      const currentCreator = String(creators[idx][0] || "").trim();
      if (currentAsset !== item.asset_before || currentCreator !== item.creator_before) {
        throw new Error("쓰기 직전 값 변경 감지 — 행 " + row + " " + item.url);
      }
      backupRows.push([row, item.url, currentAsset, item.asset_after, currentCreator, item.creator_after]);
      assetEdits.push({ row: row, value: item.asset_after });
      if (!currentCreator && item.creator_after) creatorEdits.push({ row: row, value: item.creator_after });
    });

    const stamp = Utilities.formatDate(new Date(), CONFIG.KST_TIMEZONE, "yyyyMMdd_HHmmss");
    const backupName = "_codex_asset_pollution_backup_" + stamp;
    const backup = SpreadsheetApp.getActive().insertSheet(backupName);
    backup.getRange(1, 1, backupRows.length, backupRows[0].length).setValues(backupRows);
    backup.hideSheet();

    const assetWritten = writeColumnRuns_(scan.sheet, scan.assetCol, assetEdits, latestLastRow);
    const creatorWritten = writeColumnRuns_(scan.sheet, scan.creatorCol, creatorEdits, latestLastRow);
    SpreadsheetApp.flush();

    // URL별 사후 검증. 일부만 실패해도 완료로 보고하지 않는다.
    const afterUrls = scan.sheet.getRange(CONFIG.DATA_START_ROW, scan.fieldCols.url, n, 1).getValues();
    const afterAssets = scan.sheet.getRange(CONFIG.DATA_START_ROW, scan.assetCol, n, 1).getValues();
    const afterCreators = scan.sheet.getRange(CONFIG.DATA_START_ROW, scan.creatorCol, n, 1).getValues();
    const afterIndex = buildUrlKeyIndex_(afterUrls, linkKey_);
    selected.forEach(function(item) {
      const idx = afterIndex.firstIndexByKey[item.key];
      if (idx == null || String(afterAssets[idx][0] || "").trim() !== item.asset_after) {
        throw new Error("소재명 사후 검증 실패: " + item.url);
      }
      if (!item.creator_before && item.creator_after && String(afterCreators[idx][0] || "").trim() !== item.creator_after) {
        throw new Error("제작자 사후 검증 실패: " + item.url);
      }
    });

    const remaining = scanAssetNamePollution_().candidates.length;
    const result = { applied: assetWritten, creator_filled: creatorWritten, remaining: remaining, backup_sheet: backupName };
    Logger.log("asset_name_pollution_repair " + JSON.stringify(result));
    SpreadsheetApp.getActive().toast(
      "소재명 " + assetWritten + "건 정리 · 제작자 " + creatorWritten + "건 채움 · 잔여 " + remaining + "건 · 백업 " + backupName,
      "완료",
      10
    );
    return result;
  });
}

function repairAssetNamePollutionPilot() {
  return applyAssetNamePollutionRepair_(5);
}

function repairAssetNamePollutionAll() {
  return applyAssetNamePollutionRepair_(0);
}

/** 사용자가 소재명 열을 붙여넣을 때 파일 목록 접미사를 즉시 제거한다. */
function sanitizeAssetNameOnEdit_(e, sheet) {
  if (!e || !e.range || !sheet) return 0;
  const assetCol = findHeaderCol_(sheet, ["소재명"]);
  if (!assetCol || e.range.getColumn() > assetCol || e.range.getLastColumn() < assetCol) return 0;
  const rowStart = Math.max(e.range.getRow(), CONFIG.DATA_START_ROW);
  const rowEnd = e.range.getLastRow();
  if (rowEnd < rowStart) return 0;
  const range = sheet.getRange(rowStart, assetCol, rowEnd - rowStart + 1, 1);
  const values = range.getValues();
  let changed = 0;
  const out = values.map(function(row) {
    const before = String(row[0] == null ? "" : row[0]);
    const after = ASSET_POLLUTION_RE_.test(before) ? stripAssetFileListing_(before) : before;
    if (after !== before) changed++;
    return [after];
  });
  if (!changed) return 0;
  range.setValues(out);
  SpreadsheetApp.getActive().toast("소재명에 붙은 파일 목록 " + changed + "건을 자동 제거했습니다.", "소재명 정리", 6);
  return changed;
}
