/**
 * ═══════════════════════════════════════════════════════════════
 * 라라스윗 검색량 시트 → 협찬 모니터링 사이트 전송 (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════
 *
 * 대상 시트(피벗 탭, gid=426959601):
 *   1행 그룹헤더 · 2행 키워드헤더 · 3행부터 데이터
 *   A열 = 날짜, B열 = 라라스윗 (절대검색량)
 *
 * 동작: A·B열을 읽어 [{measured_at, search_volume}] 로 사이트(/api/larasweet-search)에 전송(upsert).
 *       모니터링 대시보드 "라라스윗 검색지수" 카드가 이 데이터의 최신값을 표시.
 *
 * [설정] 이 시트의 확장 프로그램 → Apps Script 에 붙여넣기 → 저장 → 새로고침 → 메뉴 사용
 */
const CONFIG = {
  SHEET_ID: "1fxxxTHRQUQ7NIAB8WSK2lKjPyVYrPe63_RPMKfm_v3M",
  SHEET_GID: 426959601,
  API_URL: "https://influencer-seeding-mu.vercel.app/api/larasweet-search",
  DATE_COL: 1,        // A열: 날짜
  VALUE_COL: 2,       // B열: 라라스윗 검색량
  DATA_START_ROW: 3,  // 1~2행은 헤더
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔎 라라스윗 검색량")
    .addItem("🚀 사이트로 전송", "pushLarasweetSearch")
    .addSeparator()
    .addItem("⏰ 매일 09:40 자동 전송 켜기", "installSearchTrigger")
    .addItem("⏹ 자동 전송 끄기", "removeSearchTrigger")
    .addToUi();
}

function safeAlert_(m) { try { SpreadsheetApp.getUi().alert(m); } catch (e) { Logger.log(m); } }

function getSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sh = ss.getSheets().find(s => s.getSheetId() === CONFIG.SHEET_GID);
  if (!sh) throw new Error(`gid=${CONFIG.SHEET_GID} 탭을 찾을 수 없습니다.`);
  return sh;
}

function pushLarasweetSearch() {
  try {
    const sh = getSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) { safeAlert_("데이터가 없습니다."); return; }

    const n = lastRow - CONFIG.DATA_START_ROW + 1;
    const dates = sh.getRange(CONFIG.DATA_START_ROW, CONFIG.DATE_COL, n, 1).getValues();
    const vals  = sh.getRange(CONFIG.DATA_START_ROW, CONFIG.VALUE_COL, n, 1).getValues();
    const tz = Session.getScriptTimeZone();

    const rows = [];
    for (let i = 0; i < n; i++) {
      const d = dates[i][0], v = vals[i][0];
      const measured_at = d instanceof Date
        ? Utilities.formatDate(d, tz, "yyyy-MM-dd")
        : (String(d).match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
      if (!measured_at) continue;
      if (v === "" || v == null) continue; // 빈칸 스킵
      const num = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
      if (!isFinite(num)) continue;
      rows.push({ measured_at: measured_at, search_volume: Math.round(num) });
    }
    if (rows.length === 0) { safeAlert_("전송할 데이터가 없습니다."); return; }

    const res = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(rows),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) throw new Error(`API ${code}: ${res.getContentText()}`);
    const out = JSON.parse(res.getContentText());
    const last = rows[rows.length - 1];
    safeAlert_(`✅ 라라스윗 검색량 ${out.upserted}건 전송 완료.\n최신: ${last.measured_at} = ${last.search_volume.toLocaleString()}`);
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
  }
}

function installSearchTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "pushLarasweetSearch")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("pushLarasweetSearch").timeBased().everyDays(1).atHour(9).nearMinute(40).create();
  safeAlert_("✅ 매일 09:40(±15분) 자동 전송을 켰습니다.");
}

function removeSearchTrigger() {
  const t = ScriptApp.getProjectTriggers().filter(x => x.getHandlerFunction() === "pushLarasweetSearch");
  t.forEach(x => ScriptApp.deleteTrigger(x));
  safeAlert_(`⏹ 자동 전송을 껐습니다. (${t.length}개 제거)`);
}
