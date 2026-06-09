/**
 * ═══════════════════════════════════════════════════════════════
 * 광고 데이터 시트 → 협찬 모니터링 사이트 추가 (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════
 *
 * 동작: 시트의 광고 행을 읽어 → 사이트(/api/sponsored-posts/sync)에 추가(upsert)
 *       조회수 수집은 사이트(/monitoring)가 자동으로 수행함.
 *
 * 시트 컬럼 (gid=1937186871, 1행 헤더):
 *   업로드일 | 게시물URL | 채널명 | 캡션 | 채널 분류 | 프로젝트명 | 상품명 | 비용
 *
 * 플랫폼: 인스타그램 · 유튜브 · 틱톡 URL 추가 가능.
 *
 * "신규만 추가": I열(등록상태)이 비어 있는 행만 골라 보내고,
 *               성공하면 등록상태에 타임스탬프를 기록 → 매일 새로 추가된 광고만 올라감.
 *
 * 엔드포인트: /api/sponsored-posts/bulk (무인증 공개 추가 라우트, 모든 플랫폼 허용)
 *
 * ───────────────────────────────────────────────────────────────
 * [최초 1회 설정]  ※ 시크릿/키 설정 필요 없음
 * 1) 확장 프로그램 → Apps Script 에 이 파일 내용을 붙여넣기 → 💾 저장
 * 2) 시트 새로고침 → 상단 "🚀 광고 모니터링" 메뉴
 * 3) (자동화) 메뉴 → "⏰ 매일 9:30 자동 추가 켜기" 1회 클릭 → 권한 승인
 * ───────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════
// 설정
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  SHEET_GID: 1937186871,
  API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/bulk",
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  STATUS_HEADER: "등록상태",
  TRIGGER_HOUR: 9,
  TRIGGER_MINUTE: 30,
};

// 헤더명(공백 제거·소문자) → API 필드 매핑
const FIELD_BY_HEADER = {
  "업로드일": "posted_at",
  "게시물url": "url",
  "채널명": "account_name",
  "캡션": "content_summary",
  "채널분류": "channel_type",
  "프로젝트명": "project_name",
  "상품명": "product_name",
  "비용": "cost",
};

// 사이트가 허용하는 URL (인스타 / 유튜브 / 틱톡, 서브도메인 포함). 서버 필터와 동일.
const ALLOWED_URL_RE = /^https:\/\/([a-z0-9-]+\.)?(instagram\.com|youtube\.com|youtu\.be|tiktok\.com)\//i;

// ═══════════════════════════════════════════════════════════════
// 메뉴
// ═══════════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🚀 광고 모니터링")
    .addItem("👀 전송 미리보기 (신규)", "previewNew")
    .addItem("✅ 신규 광고 추가", "syncNew")
    .addSeparator()
    .addItem("♻️ 전체 다시 추가", "syncAll")
    .addItem("🔍 설정 확인", "checkSetup")
    .addSeparator()
    .addItem("⏰ 매일 9:30 자동 추가 켜기", "installDailyTrigger")
    .addItem("⏹ 자동 추가 끄기", "removeDailyTrigger")
    .addToUi();
}

// ═══════════════════════════════════════════════════════════════
// 도우미
// ═══════════════════════════════════════════════════════════════
function norm_(v) {
  return String(v == null ? "" : v).replace(/\s+/g, "").toLowerCase();
}

// 트리거(UI 없는 환경)에서도 안전하게 동작하는 알림
function safeAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find(s => s.getSheetId() === CONFIG.SHEET_GID);
  if (!sheet) throw new Error(`gid=${CONFIG.SHEET_GID} 탭을 찾을 수 없습니다.`);
  return sheet;
}

/** 헤더 → 컬럼 인덱스(1-based) 매핑. {field: colIndex} */
function buildFieldCols_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const fieldCols = {};
  headers.forEach((h, i) => {
    const field = FIELD_BY_HEADER[norm_(h)];
    if (field) fieldCols[field] = i + 1;
  });
  if (!fieldCols.url) throw new Error("'게시물URL' 헤더를 찾지 못했습니다. 1행 헤더를 확인하세요.");
  return fieldCols;
}

/** 등록상태 컬럼 인덱스(1-based). 없으면 헤더 끝에 생성. */
function getStatusCol_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const idx = headers.findIndex(h => norm_(h) === norm_(CONFIG.STATUS_HEADER));
  if (idx !== -1) return idx + 1;
  const col = lastCol + 1;
  sheet.getRange(CONFIG.HEADER_ROW, col).setValue(CONFIG.STATUS_HEADER);
  return col;
}

function toDateStr_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function toNumber_(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

// ═══════════════════════════════════════════════════════════════
// 행 읽기
// ═══════════════════════════════════════════════════════════════
/**
 * @param {boolean} onlyNew - true면 등록상태가 비어있는 행만
 * @returns {{rows, rowNums, statusCol, skipped:number}}
 */
function collectRows_(onlyNew) {
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const statusCol = getStatusCol_(sheet);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  let skipped = 0;
  if (lastRow < CONFIG.DATA_START_ROW) return { rows: [], rowNums: [], statusCol, skipped };

  const values = sheet
    .getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol)
    .getValues();

  const rows = [];
  const rowNums = [];

  values.forEach((row, i) => {
    const rowNum = CONFIG.DATA_START_ROW + i;
    const rawUrl = String(row[fieldCols.url - 1] || "").trim();
    if (!rawUrl) return; // URL 없는 빈 행

    const status = String(row[statusCol - 1] || "").trim();
    if (onlyNew && status) return; // 이미 추가된 행

    if (!ALLOWED_URL_RE.test(rawUrl)) { skipped++; return; } // 지원 안 되는 URL

    const obj = { url: rawUrl };
    if (fieldCols.posted_at)       obj.posted_at       = toDateStr_(row[fieldCols.posted_at - 1]);
    if (fieldCols.account_name)    obj.account_name    = String(row[fieldCols.account_name - 1] || "").trim() || null;
    if (fieldCols.content_summary) obj.content_summary = String(row[fieldCols.content_summary - 1] || "").trim() || null;
    if (fieldCols.channel_type)    obj.channel_type    = String(row[fieldCols.channel_type - 1] || "").trim() || null;
    if (fieldCols.project_name)    obj.project_name    = String(row[fieldCols.project_name - 1] || "").trim() || null;
    if (fieldCols.product_name)    obj.product_name    = String(row[fieldCols.product_name - 1] || "").trim() || null;
    if (fieldCols.cost)            obj.cost            = toNumber_(row[fieldCols.cost - 1]);

    rows.push(obj);
    rowNums.push(rowNum);
  });

  return { rows, rowNums, statusCol, skipped };
}

function skipNote_(skipped) {
  return skipped ? `\n\n⚠️ 지원 플랫폼(IG/YT/TikTok) URL이 아니어서 제외됨: ${skipped}건` : "";
}

// ═══════════════════════════════════════════════════════════════
// 전송 (/bulk 로 행 배열 POST, 인증 불필요)
// ═══════════════════════════════════════════════════════════════
function postRows_(rows) {
  const res = UrlFetchApp.fetch(CONFIG.API_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(`API ${code}: ${body}`);
  const data = JSON.parse(body);
  return data.upserted != null ? data.upserted : rows.length; // 추가된 건수
}

function markRegistered_(sheet, statusCol, rowNums) {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  rowNums.forEach(r => sheet.getRange(r, statusCol).setValue("✅ " + stamp));
}

// ═══════════════════════════════════════════════════════════════
// 메뉴 핸들러
// ═══════════════════════════════════════════════════════════════
function runSync_(onlyNew) {
  try {
    const { rows, rowNums, statusCol, skipped } = collectRows_(onlyNew);
    if (rows.length === 0) {
      safeAlert_((onlyNew ? "추가할 신규 광고가 없습니다." : "추가할 광고가 없습니다.") + skipNote_(skipped));
      return;
    }
    const count = postRows_(rows);
    markRegistered_(getSheet_(), statusCol, rowNums);
    safeAlert_(`✅ ${count}개 광고를 사이트에 추가했습니다.` + skipNote_(skipped));
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
  }
}

function syncNew()  { runSync_(true); }
function syncAll()  { runSync_(false); }

function previewNew() {
  try {
    const { rows, skipped } = collectRows_(true);
    if (rows.length === 0) { safeAlert_("추가할 신규 광고가 없습니다." + skipNote_(skipped)); return; }
    const sample = rows.slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.url}\n   채널:${r.account_name || "-"} / 분류:${r.channel_type || "-"} / 프로젝트:${r.project_name || "-"} / 비용:${r.cost != null ? r.cost : "-"}`)
      .join("\n");
    safeAlert_(`총 ${rows.length}개 추가 예정 (상위 5개 미리보기)\n\n${sample}` + skipNote_(skipped));
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
  }
}

function checkSetup() {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    safeAlert_(`✅ 설정 정상\n탭: ${sheet.getName()}\n인식된 필드: ${Object.keys(fieldCols).join(", ")}`);
  } catch (e) {
    safeAlert_("❌ 설정 오류\n" + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 자동 트리거 (매일 9:30, syncNew 실행)
// ═══════════════════════════════════════════════════════════════
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "syncNew")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("syncNew")
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .nearMinute(CONFIG.TRIGGER_MINUTE)
    .create();

  safeAlert_(`✅ 매일 오전 ${CONFIG.TRIGGER_HOUR}:${CONFIG.TRIGGER_MINUTE} (±15분) 자동 추가를 켰습니다.\n버튼 없이 신규 광고가 매일 자동으로 사이트에 추가됩니다.`);
}

function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "syncNew");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_(`⏹ 자동 추가를 껐습니다. (${triggers.length}개 트리거 제거)`);
}
