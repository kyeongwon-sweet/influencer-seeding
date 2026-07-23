/**
 * ═══════════════════════════════════════════════════════════════
 * 광고 데이터 시트 → 협찬 모니터링 사이트 추가 (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════
 *
 * 동작: 시트의 광고 행을 읽어 → 사이트(/api/sponsored-posts/bulk)에 추가(upsert)
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
  KST_TIMEZONE: "Asia/Seoul",
  API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/bulk",
  STATS_API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/stats-import",
  TRACKING_API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/tracking-by-url",
  LIST_API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/list-for-sheet",  // DB→시트 반영(대시보드 추가분 가져오기)용 조회
  STATS_EXPORT_API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/stats-for-sheet",  // 자동수집 조회수 → 시트 I열~ 역채움용 조회
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  STATUS_HEADER: "등록상태",
  TRIGGER_HOUR: 9,
  TRIGGER_MINUTE: 30,
  STATS_FIRST_COL: 9,        // 일자별 조회수 시작 열 (I열). 끝 열은 자동(데이터가 AE 넘어 늘어나도 OK).
  STATS_START_YEAR: 2026,    // 가장 왼쪽 날짜 열의 연도. 월이 줄면(예: 12→1) 자동으로 +1년 처리.
};

// 헤더명(공백 제거·소문자) → API 필드 매핑
const FIELD_BY_HEADER = {
  "업로드일": "posted_at",
  "게시물url": "url",
  "채널명": "account_name",
  "업체명": "company_name",
  "캡션": "content_summary",
  "소재명": "asset_name",
  "채널분류": "channel_type",
  "프로젝트명": "project_name",
  "상품명": "product_name",
  "비용": "cost",
};

// 사이트가 허용하는 URL (인스타 / 유튜브 / 틱톡 / 페이스북 / 스레드 / X(트위터) / 카카오 숏폼 / 네이버 클립, 다단계 서브도메인 포함). 서버 필터와 동일.
const ALLOWED_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net|x\.com|twitter\.com|t\.co|kakao\.com|naver\.com)\//i;

// 필드 → 표시용 컬럼명 (빈칸 검사 보고용)
const FIELD_LABEL = {
  posted_at: "업로드일", url: "게시물URL", account_name: "채널명", content_summary: "캡션",
  asset_name: "소재명", channel_type: "채널 분류", project_name: "프로젝트명", product_name: "상품명", cost: "비용",
  company_name: "업체명",
};

// ═══════════════════════════════════════════════════════════════
// 메뉴
// ═══════════════════════════════════════════════════════════════
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  // 🚀 광고 모니터링 (협찬 모니터링 연동)
  ui.createMenu("🚀 광고 모니터링")
    .addItem("👀 전송 미리보기 (신규)", "previewNew")
    .addItem("✅ 신규 광고 추가", "syncNew")
    .addSeparator()
    .addItem("📊 일자별 조회수 입력 (I~열)", "importStats")
    .addItem("📥 수집 조회수 시트로 채우기 (I~열)", "exportStats")
    .addItem("♻️ 전체 다시 추가", "syncAll")
    .addItem("⬇️ 대시보드 추가분 시트로 가져오기", "pullFromDB")
    .addSeparator()
    .addItem("🔎 빈칸 검사 (A~H)", "checkBlanks")
    .addItem("🔁 중복 URL 검사", "checkDuplicates")
    .addItem("🧹 중복 링크 정리 (하나만 남김)", "removeDuplicateLinks")
    .addItem("🔍 설정 확인", "checkSetup")
    .addSeparator()
    .addItem("⏰ 매일 9:30 자동 추가 켜기", "installDailyTrigger")
    .addItem("⏹ 자동 추가 끄기", "removeDailyTrigger")
    .addToUi();
  // 💻 배너 인사이트 요청
  ui.createMenu("💻배너 인사이트 요청")
    .addItem("업체별 채널 조회", "summarizeByCompany")
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

function getIncrementCol_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const wanted = [norm_("증분"), norm_("증분값")];
  const idx = headers.findIndex(h => wanted.includes(norm_(h)));
  return idx === -1 ? null : idx + 1;
}

function colLetter_(col) {
  let s = "";
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function toDateStr_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${("0" + m[2]).slice(-2)}-${("0" + m[3]).slice(-2)}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function headerDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return true;
  return /^\s*\d{1,2}\s*[.]\s*\d{1,2}(\s|\(|$)/.test(String(value || ""));
}

function isBeforePostedDate_(date, postedAt) {
  return !!postedAt && !!date && date < postedAt;
}

function toNumber_(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

/** KST 기준 오늘 (YYYY-MM-DD). 업로드일이 이보다 크면 미래 = 아직 게시 전. */
function todayStr_() {
  return Utilities.formatDate(new Date(), CONFIG.KST_TIMEZONE, "yyyy-MM-dd");
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
  const today = todayStr_();
  let skipped = 0, dupCount = 0, future = 0;
  if (lastRow < CONFIG.DATA_START_ROW) return { rows: [], rowNums: [], statusCol, skipped, dupCount, future };

  const values = sheet
    .getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol)
    .getValues();

  const byKey = {}; // 정규화된 URL → 전송 객체 (첫 행 우선, 중복 제거)
  const rowNums = [];

  values.forEach((row, i) => {
    const rowNum = CONFIG.DATA_START_ROW + i;
    const rawUrl = String(row[fieldCols.url - 1] || "").trim();
    if (!rawUrl) return; // URL 없는 빈 행

    const status = String(row[statusCol - 1] || "").trim();
    if (onlyNew && status) return; // 이미 추가된 행

    if (!ALLOWED_URL_RE.test(rawUrl)) { skipped++; return; } // 지원 안 되는 URL

    const postedAt = fieldCols.posted_at ? toDateStr_(row[fieldCols.posted_at - 1]) : null;
    if (postedAt && postedAt > today) { future++; return; } // 업로드일이 오늘 이후 → 아직 게시 전, 제외

    const obj = { url: rawUrl };
    if (fieldCols.posted_at)       obj.posted_at       = postedAt;
    if (fieldCols.account_name)    obj.account_name    = String(row[fieldCols.account_name - 1] || "").trim() || null;
    if (fieldCols.company_name)    obj.company_name    = String(row[fieldCols.company_name - 1] || "").trim() || null;
    if (fieldCols.content_summary) obj.content_summary = String(row[fieldCols.content_summary - 1] || "").trim() || null;
    if (fieldCols.asset_name)      obj.asset_name      = String(row[fieldCols.asset_name - 1] || "").trim() || null;
    if (fieldCols.channel_type)    obj.channel_type    = String(row[fieldCols.channel_type - 1] || "").trim() || null;
    if (fieldCols.project_name)    obj.project_name    = String(row[fieldCols.project_name - 1] || "").trim() || null;
    if (fieldCols.product_name)    obj.product_name    = String(row[fieldCols.product_name - 1] || "").trim() || null;
    if (fieldCols.cost)            obj.cost            = toNumber_(row[fieldCols.cost - 1]);

    const key = urlKey_(rawUrl);
    if (byKey[key]) { dupCount++; rowNums.push(rowNum); return; } // 같은 URL 중복 → 전송 1번만, 행은 등록 처리
    byKey[key] = obj;
    rowNums.push(rowNum);
  });

  const rows = Object.keys(byKey).map(k => byKey[k]);
  return { rows, rowNums, statusCol, skipped, dupCount, future };
}

/** 중복 판정용 URL 키: 쿼리스트링·끝슬래시 제거 + 소문자 (서버 정규화와 동일 기준) */
function urlKey_(u) {
  // 서버 normalizeUrl(web/lib/url-utils.ts)과 동일 규칙으로 정규화 — 안 맞추면 시트↔DB가
  // 도메인/스킴 변형(www.threads.com↔threads.com, http↔https)을 다른 글로 봐서 pullFromDB가
  // 이미 있는 글을 새 행으로 재추가함(2026-07-08 스레드·페북 중복 3건 사례).
  var s = String(u || "").trim().toLowerCase();
  s = s.split("?")[0].split("#")[0];    // 쿼리·프래그먼트 제거
  s = s.replace(/^https?:\/\//, "");    // 스킴 제거(http/https 동일 취급)
  s = s.replace(/^www\./, "");          // 선행 www 제거(서버와 동일; m.blog 등 유의미 서브도메인은 보존)
  s = s.replace(/\/{2,}/g, "/");        // 경로 이중슬래시 축약
  s = s.replace(/\/+$/, "");            // 트레일링 슬래시 제거
  return s;
}

/** 링크 동일성 키 — 같은 게시물이면 경로가 달라도 같은 키.
 *  IG는 shortcode(/p/·/reel/·/reels/·/tv/ 통일), 틱톡은 영상ID, 그 외는 urlKey_. (서버 정규화와 동일 기준) */
function linkKey_(u) {
  u = String(u || "").trim();
  // stats-for-sheet may already return canonical keys like ig:<shortcode>, yt:<videoId>, tt:<videoId>.
  // Preserve ID case; IG/YouTube IDs are case-sensitive, and lowercasing breaks sheet row matching.
  var canonical = u.match(/^(ig|yt|tt):(.+)$/i);
  if (canonical) return canonical[1].toLowerCase() + ":" + canonical[2];
  // /p/·/reel/ 앞에 계정명이 낀 형태(instagram.com/<user>/p/<code>/)도 인식 — 서버 normalizeUrl과 동일.
  // (계정명 무시하고 경로 어디에 있든 /p|reel|reels|tv/<code>를 shortcode로. 2026-07-08 anavocado 중복 사례)
  var ig = u.match(/instagram\.com\/(?:[^/?#]+\/)*(?:p|reels|reel|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) return "ig:" + ig[1];
  // 유튜브: 영상ID로 통일(www/non-www·shorts·watch·youtu.be 모두 동일 영상). ID는 대소문자 구분(소문자화 X).
  var yt = u.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/)
        || u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)
        || u.match(/youtube\.com\/(?:embed|live|v)\/([A-Za-z0-9_-]{6,})/)
        || (/youtube\.com\/watch/.test(u) ? u.match(/[?&]v=([A-Za-z0-9_-]{6,})/) : null);
  if (yt) return "yt:" + yt[1];
  var tt = u.match(/tiktok\.com\/(?:.*\/)?video\/(\d+)/i) || u.match(/\/video\/(\d+)/);
  if (tt) return "tt:" + tt[1];
  return urlKey_(u);
}

// ═══════════════════════════════════════════════════════════════
// 🧹 중복 링크 정리 — 겹치는 링크 행을 각 1개만 남기고 삭제
// ═══════════════════════════════════════════════════════════════
// 같은 게시물(IG shortcode·틱톡 영상ID·정규화 URL 동일)을 그룹으로 묶어, 그룹마다
// '데이터가 가장 많이 채워진 행' 1개만 남기고 나머지 행을 삭제(데이터 손실 최소화).
// 아래→위로 삭제해 행번호 밀림 방지. 조회수는 DB(post_daily_stats)에 있어 안전.
function removeDuplicateLinks() {
  try {
    var sheet = getSheet_();
    var fc = buildFieldCols_(sheet);
    var urlCol = fc.url;
    var lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) { safeAlert_("데이터가 없습니다."); return; }
    var lastCol = sheet.getLastColumn();
    var vals = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getValues();

    var groups = {};
    vals.forEach(function (row, i) {
      var u = String(row[urlCol - 1] || "").trim();
      if (!u) return;
      var k = linkKey_(u);
      var filled = row.filter(function (c) { return String(c).trim() !== ""; }).length;
      (groups[k] = groups[k] || []).push({ row: CONFIG.DATA_START_ROW + i, filled: filled, url: u });
    });

    var toDelete = [], deleted = [], dupGroups = 0;
    Object.keys(groups).forEach(function (k) {
      var rows = groups[k];
      if (rows.length <= 1) return;
      dupGroups++;
      rows.sort(function (a, b) { return b.filled - a.filled || a.row - b.row; }); // 데이터 많은 것 우선, 동률이면 위쪽
      var keep = rows[0];
      rows.slice(1).forEach(function (r) {
        toDelete.push(r.row);
        deleted.push("· 삭제 " + r.row + "행: " + r.url + "\n   (남김 " + keep.row + "행: " + keep.url + ")");
      });
    });

    if (!toDelete.length) { safeAlert_("✅ 겹치는 링크 없음 — 정리할 게 없습니다."); return; }
    toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); }); // 아래→위
    Logger.log("중복 링크 정리 삭제 목록:\n" + deleted.join("\n"));
    safeAlert_("🧹 중복 링크 정리 완료\n중복 그룹 " + dupGroups + "개 → " + toDelete.length + "행 삭제(각 그룹 1행만 남김).\n(행번호는 삭제 전 기준)\n\n" + deleted.join("\n"));
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
  }
}

function noteExtra_(skipped, dupCount, future) {
  let s = "";
  if (dupCount) s += `\n\n🔁 시트 내 중복 URL ${dupCount}건은 1건으로 합쳐 전송(중복 추가 방지).`;
  if (future)   s += `\n⏭️ 업로드일이 오늘 이후인 행 ${future}건 제외(아직 게시 전).`;
  if (skipped)  s += `\n⚠️ 지원 플랫폼(IG/YT/TikTok/FB/Threads/X/카카오/네이버) URL이 아니어서 제외됨: ${skipped}건`;
  return s;
}

// ═══════════════════════════════════════════════════════════════
// 빈칸 검사 (A~H 필수 컬럼)
// ═══════════════════════════════════════════════════════════════
/** 값이 하나라도 있는 행 중, A~H에 빈칸이 있는 행 목록. [{row, missing:[컬럼명]}] */
function scanBlanks_() {
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.DATA_START_ROW) return [];

  const values = sheet
    .getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol)
    .getValues();
  // 업체명(company_name)은 바이럴에만 있는 선택 항목 → 빈칸 검사 대상에서 제외(빈칸이 정상).
  const fields = Object.keys(fieldCols).filter(f => f !== "company_name");
  const cell = (row, f) => String(row[fieldCols[f] - 1] == null ? "" : row[fieldCols[f] - 1]).trim();

  const blanks = [];
  values.forEach((row, i) => {
    // 완전히 빈 행(아래쪽 여백 등)은 검사 제외 — A~H 중 하나라도 값이 있어야 검사 대상
    if (!fields.some(f => cell(row, f) !== "")) return;
    const missing = fields.filter(f => cell(row, f) === "").map(f => FIELD_LABEL[f] || f);
    if (missing.length) blanks.push({ row: CONFIG.DATA_START_ROW + i, missing: missing });
  });
  return blanks;
}

/** 액션 결과창에 덧붙일 짧은 빈칸 경고 (없으면 빈 문자열) */
function blankNote_() {
  try {
    const blanks = scanBlanks_();
    if (!blanks.length) return "";
    const ex = blanks.slice(0, 5).map(b => `${b.row}행(${b.missing.join("·")})`).join(", ");
    return `\n\n⚠️ A~H에 빈칸이 있는 행 ${blanks.length}개: ${ex}${blanks.length > 5 ? " 외…" : ""}\n('🔎 빈칸 검사'로 전체 확인)`;
  } catch (e) { return ""; }
}

/** 메뉴: A~H 빈칸 전체 검사 */
function checkBlanks() {
  try {
    const blanks = scanBlanks_();
    if (blanks.length === 0) { safeAlert_("✅ 빈칸 없음 — 값이 있는 모든 행의 A~H가 채워져 있습니다."); return; }
    const lines = blanks.slice(0, 20).map(b => `  ${b.row}행: ${b.missing.join(", ")}`).join("\n");
    safeAlert_(`⚠️ 빈칸이 있는 행 ${blanks.length}개\n(A~H 중 비어있는 칸)\n\n${lines}${blanks.length > 20 ? `\n  … 외 ${blanks.length - 20}행` : ""}`);
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 전송 (/bulk 로 행 배열 POST, Bearer 인증)
// ═══════════════════════════════════════════════════════════════
// 스크립트 속성 CRON_SECRET 을 Bearer 토큰으로 전송. (프로젝트 설정 > 스크립트 속성)
function authHeaders_() {
  const secret = PropertiesService.getScriptProperties().getProperty("CRON_SECRET");
  if (!secret) throw new Error("스크립트 속성 'CRON_SECRET' 이 설정되지 않았습니다. (프로젝트 설정 > 스크립트 속성)");
  return { Authorization: "Bearer " + secret };
}

function postRows_(rows) {
  const res = UrlFetchApp.fetch(CONFIG.API_URL, {
    method: "post",
    contentType: "application/json",
    headers: authHeaders_(),
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(`API ${code}: ${body}`);
  const data = JSON.parse(body);
  return {
    count: data.upserted != null ? data.upserted : rows.length, // 처리(전송) 건수
    ended: data.ended_marked || 0,                              // 캡션 '삭제/보관' → 종료 처리 건수
    filled: data.meta_filled || 0,                              // 기존 광고의 빈 항목을 시트 값으로 채운 건수
  };
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
    const { rows, rowNums, statusCol, skipped, dupCount, future } = collectRows_(onlyNew);
    if (rows.length === 0) {
      safeAlert_((onlyNew ? "추가할 신규 광고가 없습니다." : "추가할 광고가 없습니다.") + noteExtra_(skipped, dupCount, future));
      return true;
    }
    const { count, ended, filled } = postRows_(rows);
    markRegistered_(getSheet_(), statusCol, rowNums);
    let okMsg = `✅ ${count}개 광고를 사이트에 반영했습니다.`;
    if (filled) okMsg += `\n📝 기존 광고의 빈 항목 ${filled}건을 시트 값으로 채움(채널 분류·비용 등).`;
    if (ended) okMsg += `\n🛑 캡션 '삭제/보관' ${ended}건 → '종료' 처리됨.`;
    safeAlert_(okMsg + noteExtra_(skipped, dupCount, future) + blankNote_());
    return true;
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}

function syncNew()  { runSync_(true); }
function syncAll()  { runSync_(false); }

// ═══════════════════════════════════════════════════════════════
// DB → 시트 반영 (대시보드에서 추가한 게시물을 시트로 가져오기)
// ═══════════════════════════════════════════════════════════════
// 방향: [DB] → [시트]. (시트→DB는 syncNew/syncAll, 이건 그 반대)
// 동작: DB의 모든 게시물을 조회해, URL이 시트에 없으면 새 행 추가.
//       이미 있는 행은 '빈 칸만' DB값으로 채움(계정명·업로드일 등 — 수동 입력분은 보존).
// 인증: bulk와 동일한 Bearer CRON_SECRET. 조회수(일자별)·등록상태 열은 건드리지 않음.
function fmtVal_(field, v) {
  if (v == null) return "";
  if (field === "posted_at") return toDateStr_(v) || "";
  return v;  // cost는 숫자 그대로, 나머지는 문자열
}

function pullFromDB() {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);   // {field: 1-based col}
    const urlCol = fieldCols.url;

    const res = UrlFetchApp.fetch(CONFIG.LIST_API_URL, {
      method: "get",
      headers: authHeaders_(),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error(`API ${res.getResponseCode()}: ${res.getContentText()}`);
    const posts = (JSON.parse(res.getContentText()).posts) || [];

    // 시트 기존 URL → 행번호
    const lastRow = sheet.getLastRow();
    const rowByKey = {};
    if (lastRow >= CONFIG.DATA_START_ROW) {
      const urls = sheet.getRange(CONFIG.DATA_START_ROW, urlCol, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
      urls.forEach((r, i) => {
        const u = String(r[0] || "").trim();
        if (u) rowByKey[linkKey_(u)] = CONFIG.DATA_START_ROW + i;   // shortcode/영상ID 기준 — /p/·/reel/ 등 경로만 달라도 같은 글로 인식
      });
    }

    // 채울 필드(시트에 해당 헤더가 있는 것만)
    const fillFields = ["posted_at", "account_name", "company_name", "content_summary", "asset_name", "channel_type", "project_name", "product_name", "cost"];

    let added = 0, filled = 0;
    posts.forEach(p => {
      const key = linkKey_(String(p.url || ""));   // 시트 인덱스와 동일 기준 — DB /p/ ↔ 시트 /reel/ 매칭되어 재추가 안 됨
      if (!key) return;
      if (rowByKey[key]) {
        // 기존 행 — 빈 칸만 DB값으로 채움(수동 편집 보존)
        const rowNum = rowByKey[key];
        fillFields.forEach(f => {
          if (!fieldCols[f]) return;
          const val = fmtVal_(f, p[f]);
          if (val === "") return;
          const cell = sheet.getRange(rowNum, fieldCols[f]);
          if (String(cell.getValue()).trim() === "") { cell.setValue(val); filled++; }
        });
      } else {
        // 신규 — 새 행에 메타 셀만 기록(조회수·등록상태 열은 그대로 비워둠 → 다른 열 안 건드림)
        const targetRow = sheet.getLastRow() + 1;
        sheet.getRange(targetRow, urlCol).setValue(p.url);
        fillFields.forEach(f => {
          if (!fieldCols[f]) return;
          const val = fmtVal_(f, p[f]);
          if (val !== "") sheet.getRange(targetRow, fieldCols[f]).setValue(val);
        });
        rowByKey[key] = targetRow;
        added++;
      }
    });

    safeAlert_(`⬇️ DB→시트 반영 완료\n• 신규 행 추가: ${added}건\n• 기존 행 빈칸 채움: ${filled}건`);
    return true;
  } catch (e) {
    safeAlert_("❌ DB→시트 반영 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}

// 매일 자동: 시트→DB(전체 syncAll) + DB→시트(대시보드 추가분 가져오기)를 함께 수행.
// syncNew(신규만)→syncAll 변경(2026-07-06): 기존 행의 시트 수정(업로드일 정정 등)이 DB로
// 전파되지 않아 시트·DB 게시일이 어긋나던 문제 해소(640행 7/2↔7/4 사례).
// 서버(bulk)가 '비어있지 않은 값만 덮기 + manual_fields 보존'이라 전체 재전송도 안전.
function dailyAuto() {
  const props = PropertiesService.getScriptProperties();
  const startedAt = new Date().toISOString();
  const errors = [];
  props.setProperties({
    DAILY_AUTO_LAST_STARTED_AT: startedAt,
    DAILY_AUTO_LAST_STATUS: "RUNNING",
  }, false);

  const syncOk = runSync_(false);
  if (syncOk === false) errors.push("syncAll failed");
  try {
    const pullOk = pullFromDB();
    if (pullOk === false) errors.push("pullFromDB failed");
  } catch (e) {
    errors.push("pullFromDB threw: " + (e.stack || e.message));
    Logger.log("dailyAuto pullFromDB: " + (e.stack || e.message));
  }
  try {
    const exportOk = exportStats();
    if (exportOk === false) errors.push("exportStats failed");
  } catch (e) {
    errors.push("exportStats threw: " + (e.stack || e.message));
    Logger.log("dailyAuto exportStats: " + (e.stack || e.message));
  }
  [
    ["syncStatus", syncStatus],
    ["refreshCumulativeViews", refreshCumulativeViews],
    ["syncCreators", syncCreators],
    ["syncPricing", syncPricing],
  ].forEach(([name, fn]) => {
    try {
      const ok = fn();
      if (ok === false) errors.push(name + " failed");
    } catch (e) {
      errors.push(name + " threw: " + (e.stack || e.message));
      Logger.log("dailyAuto " + name + ": " + (e.stack || e.message));
    }
  });

  const finishedAt = new Date().toISOString();
  const status = errors.length ? `ERROR: ${errors.join(" | ")}` : "OK";
  props.setProperties({
    DAILY_AUTO_LAST_FINISHED_AT: finishedAt,
    DAILY_AUTO_LAST_STATUS: status,
  }, false);
  if (errors.length) throw new Error(status);
}

// ═══════════════════════════════════════════════════════════════
// 수집 조회수 → 시트 I열~ 역채움 (대시보드 자동수집분을 시트로 내림)
// importStats(시트→DB)의 반대. 새 날짜는 우측에 열 자동 추가 후, 수집값 있는 날짜 칸만 갱신
// (없으면 기존값 유지=수동 입력 보존). dailyAuto(매일 9:30)에 연결돼 자동 확장·갱신.
// ═══════════════════════════════════════════════════════════════
function fetchCollectedStats_() {
  const res = UrlFetchApp.fetch(CONFIG.STATS_EXPORT_API_URL, {
    method: "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error(`API ${code}: ${res.getContentText()}`);
  return (JSON.parse(res.getContentText()).posts) || []; // [{url, key, ended_at, stats:[[date,metric],...]}]
}

function exportStats() {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.DATA_START_ROW) { safeAlert_("데이터 행이 없습니다."); return; }
    const header = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];

    // 날짜 컬럼 자동 인식 (importStats와 동일 규칙: I열~ 스캔, 월 줄면 +1년)
    const dateCols = [];
    let year = CONFIG.STATS_START_YEAR, prevMonth = null;
    for (let c = CONFIG.STATS_FIRST_COL; c <= lastCol; c++) {
      const md = parseMonthDay_(header[c - 1]);
      if (!md) continue;
      if (prevMonth !== null && md.mo < prevMonth) year++;
      prevMonth = md.mo;
      dateCols.push({ col: c, date: `${year}-${("0" + md.mo).slice(-2)}-${("0" + md.da).slice(-2)}` });
    }

    // 대시보드 수집 조회수 → linkKey(shortcode/영상ID) → {date: play} + 등장 날짜 수집
    const byKey = {};
    const endedByKey = {};
    const allDatesSet = {};
    fetchCollectedStats_().forEach(p => {
      const k = linkKey_(String(p.key || p.url || ""));
      if (!k) return;
      if (p.ended_at) endedByKey[k] = String(p.ended_at).slice(0, 10);
      const m = byKey[k] || (byKey[k] = {});
      (p.stats || []).forEach(pair => {
        if (!(pair[1] > 0)) return; // 0·음수·비숫자 방어 — 시트에 0 찍힘/기존값 덮음/빈 열 추가 방지(엔드포인트도 >0만 반환)
        m[pair[0]] = pair[1]; allDatesSet[pair[0]] = true;
      });
    });

    // ── 우측 날짜열 자동 추가 ──
    // 수집 데이터의 날짜 중 '기존 마지막 날짜열보다 뒤(우측)이고 오늘(KST) 이하'인 날짜만 새 열로 삽입.
    // (중간 백필용 열 삽입은 안 함 — 우측으로만 확장. 헤더/등록상태는 이름 기반 조회라 열 삽입에도 안 깨짐)
    const existingSet = {};
    dateCols.forEach(dc => existingSet[dc.date] = true);
    const maxExisting = dateCols.length ? dateCols[dateCols.length - 1].date : null;
    const today = todayStr_();
    const newDates = Object.keys(allDatesSet)
      .filter(d => !existingSet[d] && d <= today && (maxExisting === null || d > maxExisting))
      .sort();
    let addedCols = 0;
    if (newDates.length) {
      const anchor = dateCols.length ? dateCols[dateCols.length - 1].col : sheet.getLastColumn();
      sheet.insertColumnsAfter(anchor, newDates.length);
      const headerRow = newDates.map(d => { const p = d.split("-"); return `${+p[1]}.${+p[2]}`; }); // "2026-07-08" → "7.8"
      sheet.getRange(CONFIG.HEADER_ROW, anchor + 1, 1, newDates.length).setValues([headerRow]);
      newDates.forEach((d, i) => dateCols.push({ col: anchor + 1 + i, date: d }));
      addedCols = newDates.length;
    }
    if (dateCols.length === 0) { safeAlert_("날짜 열도 없고 추가할 수집 날짜도 없습니다. (1행 날짜 헤더 또는 수집 데이터 확인)"); return; }

    // 중복 날짜열 감지: 같은 날짜가 2개 이상이면 역채움/증분 기준이 흔들려 오염될 수 있으므로 중단.
    {
      const dateSeen = {}, dupDates = [];
      dateCols.forEach(dc => {
        if (dateSeen[dc.date]) {
          if (dupDates.indexOf(dc.date) < 0) dupDates.push(dc.date);
        } else {
          dateSeen[dc.date] = true;
        }
      });
      if (dupDates.length) {
        const s = dupDates.slice(0, 10).map(d => { const p = d.split("-"); return `${+p[1]}.${+p[2]}`; }).join(", ");
        safeAlert_(`🚨 중복 날짜 열 ${dupDates.length}개 발견 — 역채움·증분 오염 우려. 📥 중단. 시트에서 중복 날짜 열을 하나만 남기고 재실행하세요.\n중복 날짜: ${s}${dupDates.length > 10 ? " ..." : ""}`);
        return;
      }
    }

    const nRows = lastRow - CONFIG.DATA_START_ROW + 1;
    const urlVals = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, nRows, 1).getValues();
    const postedVals = fieldCols.posted_at
      ? sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.posted_at, nRows, 1).getValues()
      : new Array(nRows).fill([null]);
    const firstCol = dateCols[0].col, lastDateCol = dateCols[dateCols.length - 1].col;
    const width = lastDateCol - firstCol + 1;
    // 현재값 1회 읽기(읽기는 수식 비파괴). ⚠️ 쓰기는 '날짜 열 단위'로만 → 날짜 아닌 열(수식·메모 등)은 절대 안 건드림.
    const block = sheet.getRange(CONFIG.DATA_START_ROW, firstCol, nRows, width).getValues();

    // 행별 매칭 맵 선계산 + 매칭/누락 카운트
    let matched = 0, missing = 0, shortcodeFormatMatched = 0;
    const rowMap = new Array(nRows);
    const rowKeys = new Array(nRows);
    const postedAtByRow = new Array(nRows);
    for (let i = 0; i < nRows; i++) {
      postedAtByRow[i] = toDateStr_(postedVals[i][0]);
      const url = String(urlVals[i][0] || "").trim();
      if (!url) { rowMap[i] = null; rowKeys[i] = null; continue; }
      const key = linkKey_(url);
      rowKeys[i] = key;
      const m = byKey[key];
      if (m) {
        rowMap[i] = m; matched++;
        if (/instagram\.com\/(?:[^/?#]+\/)*(?:reels|reel|tv)\//i.test(url)) shortcodeFormatMatched++;
      }
      else { rowMap[i] = null; if (ALLOWED_URL_RE.test(url)) missing++; }
    }

    // 행별 좌→우 forward-fill: 실측(>0)은 반영하고 기준값(lastVal) 갱신, '측정 없음' 빈칸은 직전 누적값으로 이어받는다.
    //   → 종료·수집누락·play_count null로 생기는 날짜 공백에도 누적조회수가 줄어(끊겨) 보이지 않게 하는 '표시 보정'.
    //   ⚠️ DB(post_daily_stats)엔 아무것도 안 씀(safeIncrement·증분 규칙 불변). 이어받기 값은 importStats가 재저장 안 함(아래 가드).
    //   배너 등 '양수 조회수가 한 번도 없는' 행은 lastVal이 안 생겨 자동 제외(빈칸 유지).
    //   기존 실측·수동값은 절대 안 덮고, 빈칸 또는 직전값 이어받기였던 칸만 새 실측으로 교체.
    let filled = 0, carried = 0, prePostedCleared = 0, preserved = 0, orphanRows = 0, futureCleared = 0, endedCleared = 0;
    const carriedCells = {};
    const newBlock = block.map(r => r.slice());
    for (let i = 0; i < nRows; i++) {
      const m = rowMap[i];
      // 🛡️ URL 없는 '고아' 행은 절대 건드리지 않는다(ffill로 숫자 옆번짐 차단). 데이터 남은 고아는 카운트→경고.
      if (!String(urlVals[i][0] || "").trim()) {
        for (let j = 0; j < dateCols.length; j++) {
          const c = block[i][dateCols[j].col - firstCol];
          if (c !== "" && c !== null) { orphanRows++; break; }
        }
        continue;
      }
      let lastVal = null;
      const endedAt = rowKeys[i] ? endedByKey[rowKeys[i]] : null;
      for (let j = 0; j < dateCols.length; j++) {
        const bi = dateCols[j].col - firstCol;
        const date = dateCols[j].date;
        const cell = block[i][bi];
        const postedAt = postedAtByRow[i];
        if (isBeforePostedDate_(date, postedAt)) {
          if (cell !== "" && cell !== null) { newBlock[i][bi] = ""; prePostedCleared++; }
          lastVal = null;
          continue;
        }
        if (endedAt && date > endedAt) {
          if (cell !== "" && cell !== null) { newBlock[i][bi] = ""; endedCleared++; }
          lastVal = null;
          continue;
        }
        // 🛡️ 오늘·미래 날짜칸은 채우지 않고 비운다(수집일-1까지만; 대시보드 '오늘 제외'와 일치).
        if (date >= today) {
          if (cell !== "" && cell !== null) { newBlock[i][bi] = ""; futureCleared++; }
          lastVal = null;
          continue;
        }
        const collected = m ? m[date] : undefined;
        if (collected > 0) {                                   // 실측값 도착 → 빈 칸만 채움 + 기준 갱신
          const isBlank = cell === "" || cell === null;
          // 🛡️ 값이 이미 든 칸(수동 입력·기존 실측)은 절대 안 덮는다 — 빈 칸만 실측으로 채운다.
          //    예전엔 isCarried(직전값과 같으면 덮기)도 덮었는데, '평평한 수동값'(배너 도달수는 며칠씩 동일)이
          //    carry로 오인돼 역채움이 사용자 수동입력을 덮어버리는 버그가 있었음. 빈 칸만 채우도록 축소(수동값 보호).
          if (isBlank) {
            if (cell !== collected) { newBlock[i][bi] = collected; filled++; }
            lastVal = collected;
          } else if (typeof cell === "number" && cell > 0) {
            lastVal = cell;
            if (cell !== collected) preserved++;
          }
        } else if (typeof cell === "number" && cell > 0) {     // 기존 실측/수동값 → 유지 + 기준 갱신
          lastVal = cell;
        } else if (lastVal != null && (cell === "" || cell === null)) { // '완전 빈칸'만 이어받기
          newBlock[i][bi] = lastVal; carried++;                // (0·텍스트 등 다른 내용이 든 셀은 절대 안 덮음)
          carriedCells[i + ":" + bi] = true;
        }
      }
    }
    // 변경된 날짜 열만 기록(비-날짜 열은 절대 안 건드림)
    dateCols.forEach(dc => {
      const bi = dc.col - firstCol;
      let changed = false;
      const colVals = new Array(nRows);
      for (let i = 0; i < nRows; i++) {
        colVals[i] = [newBlock[i][bi]];
        if (newBlock[i][bi] !== block[i][bi]) changed = true;
      }
      if (changed) sheet.getRange(CONFIG.DATA_START_ROW, dc.col, nRows, 1).setValues(colVals);
    });

    const incrementCol = getIncrementCol_(sheet);
    let incWritten = 0;
    if (incrementCol) {
      const incFormulas = [];
      for (let i = 0; i < nRows; i++) {
        const url = String(urlVals[i][0] || "").trim();
        const m = rowMap[i];
        const postedAt = postedAtByRow[i];
        const endedAt = rowKeys[i] ? endedByKey[rowKeys[i]] : null;
        const rowNum = CONFIG.DATA_START_ROW + i;
        const refs = [];
        if (url && m) {
          for (let j = 0; j < dateCols.length; j++) {
            const dc = dateCols[j];
            const bi = dc.col - firstCol;
            if (isBeforePostedDate_(dc.date, postedAt)) continue;
            if (endedAt && dc.date > endedAt) continue;
            if (dc.date >= today) continue;
            if (carriedCells[i + ":" + bi]) continue;
            if (!(m[dc.date] > 0)) continue;
            const n = toNumber_(newBlock[i][bi]);
            if (n == null || n <= 0) continue;
            refs.push({ ref: colLetter_(dc.col) + rowNum, date: dc.date });
          }
        }
        if (refs.length === 0) {
          incFormulas.push([""]);
          continue;
        }
        if (refs.length === 1) {
          let firstOk = true;
          if (postedAt) {
            const gapDays = (Date.parse(refs[0].date) - Date.parse(String(postedAt).slice(0, 10))) / 86400000;
            if (gapDays > 7) firstOk = false;
          }
          incFormulas.push([firstOk ? `=IF(N(${refs[0].ref})>0,${refs[0].ref},"")` : ""]);
          if (firstOk) incWritten++;
          continue;
        }
        const latest = refs[refs.length - 1].ref;
        const prevRefs = refs.slice(0, -1).map(r => r.ref);
        const prevMax = prevRefs.length === 1 ? prevRefs[0] : `MAX({${prevRefs.join(",")}})`;
        incFormulas.push([`=IF(N(${latest})<=0,"",MAX(0,${latest}-${prevMax}))`]);
        incWritten++;
      }
      sheet.getRange(CONFIG.DATA_START_ROW, incrementCol, nRows, 1).setFormulas(incFormulas);
    }

    let msg = `✅ 수집 조회수를 시트에 반영했습니다.\n새 날짜 열 ${addedCols}개 추가 · 실측 갱신 ${filled}칸 · 공백 이어받기 ${carried}칸 · 업로드 전 값 삭제 ${prePostedCleared}칸 · 종료 이후 값 삭제 ${endedCleared}칸 · 증분 수식 ${incWritten}행 · 기존값 보존 ${preserved}칸 · 매칭 게시물 ${matched}개 · 날짜 열 ${dateCols.length}개`;
    if (shortcodeFormatMatched) msg += `\n🔁 /reel·/tv 잔재 URL ${shortcodeFormatMatched}개는 shortcode 기준으로 정상 매칭했습니다.`;
    if (missing) msg += `\n⚠️ 시트엔 있으나 대시보드에 수집기록이 없는 URL ${missing}개(아직 수집 전이거나 미등록).`;
    if (futureCleared) msg += `\n🗓️ 오늘·미래(수집일-1 이후) 날짜칸 ${futureCleared}개를 비웠습니다.`;
    if (orphanRows) msg += `\n🧟 URL 없이 숫자만 있는 '고아 행' ${orphanRows}개 발견 — 행 삭제로 정리하세요(데이터는 DB에 있음).`;
    safeAlert_(msg);
    return true;
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 일자별 조회수 입력 (I~AE열 → post_daily_stats 백필)
// ═══════════════════════════════════════════════════════════════
/** 날짜 헤더("5. 17 (일)", "6.1", Date 값) → {mo, da}. 파싱 불가면 null. */
function parseMonthDay_(label) {
  let mo, da;
  if (label instanceof Date && !isNaN(label.getTime())) {
    mo = label.getMonth() + 1; da = label.getDate();
  } else {
    const m = String(label == null ? "" : label).match(/(\d{1,2})\D+(\d{1,2})/);
    if (!m) return null;
    mo = +m[1]; da = +m[2];
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return { mo: mo, da: da };
}

function postStats_(payload) {
  const res = UrlFetchApp.fetch(CONFIG.STATS_API_URL, {
    method: "post",
    contentType: "application/json",
    headers: authHeaders_(),
    payload: JSON.stringify(payload), // { posts: [...], stats: [...] }
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(`API ${code}: ${body}`);
  return JSON.parse(body); // { ok, inserted, created_posts, matched_urls, missing_urls, missing_sample }
}

function importStats() {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const header = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];

    // 날짜 컬럼 자동 인식 (I열~ 마지막 열까지 스캔 → AE 넘어 늘어나도 자동 반영,
    // 수정금지/등록상태 등 비-날짜 열은 자동 제외). 월이 줄면 해 넘김(+1년) 처리.
    const dateCols = [];
    let year = CONFIG.STATS_START_YEAR;
    let prevMonth = null;
    for (let c = CONFIG.STATS_FIRST_COL; c <= lastCol; c++) {
      const md = parseMonthDay_(header[c - 1]);
      if (!md) continue;
      if (prevMonth !== null && md.mo < prevMonth) year++; // 12→1 등 해 넘어감
      prevMonth = md.mo;
      dateCols.push({ col: c, date: `${year}-${("0" + md.mo).slice(-2)}-${("0" + md.da).slice(-2)}` });
    }
    if (dateCols.length === 0) { safeAlert_("날짜 컬럼(I열~)을 찾지 못했습니다. 헤더를 확인하세요."); return; }
    if (lastRow < CONFIG.DATA_START_ROW) { safeAlert_("데이터 행이 없습니다."); return; }

    const values = sheet
      .getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol)
      .getValues();

    const today = todayStr_();
    let future = 0;
    let futureDateCells = 0;
    let blankDateCells = 0;
    let carrySkipped = 0;
    let bannerRows = 0;
    let bannerStats = 0;
    const stats = [];
    const postByKey = {}; // url-key → 광고 메타 (첫 행 우선). 없는 광고 생성용, 기존은 서버가 덮어쓰지 않음.
    values.forEach(row => {
      const url = String(row[fieldCols.url - 1] || "").trim();
      if (!url || !ALLOWED_URL_RE.test(url)) return; // URL 없거나 미지원

      const postedAt = fieldCols.posted_at ? toDateStr_(row[fieldCols.posted_at - 1]) : null;
      if (postedAt && postedAt > today) { future++; return; } // 업로드일이 오늘 이후 → 아직 게시 전, 제외

      const key = urlKey_(url);
      if (!postByKey[key]) {
        const p = { url: url };
        if (fieldCols.posted_at)       p.posted_at       = toDateStr_(row[fieldCols.posted_at - 1]);
        if (fieldCols.account_name)    p.account_name    = String(row[fieldCols.account_name - 1] || "").trim() || null;
        if (fieldCols.company_name)    p.company_name    = String(row[fieldCols.company_name - 1] || "").trim() || null;
        if (fieldCols.content_summary) p.content_summary = String(row[fieldCols.content_summary - 1] || "").trim() || null;
        if (fieldCols.asset_name)      p.asset_name      = String(row[fieldCols.asset_name - 1] || "").trim() || null;
        if (fieldCols.channel_type)    p.channel_type    = String(row[fieldCols.channel_type - 1] || "").trim() || null;
        if (fieldCols.project_name)    p.project_name    = String(row[fieldCols.project_name - 1] || "").trim() || null;
        if (fieldCols.product_name)    p.product_name    = String(row[fieldCols.product_name - 1] || "").trim() || null;
        if (fieldCols.cost)            p.cost            = toNumber_(row[fieldCols.cost - 1]);
        postByKey[key] = p;
      }

      const channelType = fieldCols.channel_type ? String(row[fieldCols.channel_type - 1] || "") : "";
      const isBanner = channelType.indexOf("배너") >= 0;
      if (isBanner) bannerRows++;

      // 날짜 헤더 라벨을 기준으로 오늘(KST) 이하의 숫자 셀을 전송한다.
      // 배너 입력은 서버 stats-import가 reach_count로 저장하므로 여기서 제외하면 안 된다.
      // 비배너만 기존 forward-fill 중복 생략을 유지한다. 배너는 도달수가 같은 날도
      // 실제 수기 스냅샷일 수 있으므로 값이 있는 날짜를 모두 보낸다.
      let prevN = null;
      dateCols.forEach(dc => {
        if (dc.date > today) {
          if (toNumber_(row[dc.col - 1]) !== null) futureDateCells++;
          return;
        }
        if (isBeforePostedDate_(dc.date, postedAt)) return; // 업로드 전 날짜는 조회수 저장 대상 아님
        const n = toNumber_(row[dc.col - 1]);
        if (n === null) { blankDateCells++; return; } // 빈칸/비숫자 → 측정 없음, 스킵
        if (!isBanner && prevN !== null && n === prevN) { carrySkipped++; return; }
        stats.push({ url: url, measured_at: dc.date, play_count: n });
        if (isBanner) bannerStats++;
        prevN = n;
      });
    });

    Logger.log(JSON.stringify({
      event: "importStats_scan",
      today: today,
      rows: values.length,
      date_columns: dateCols.length,
      first_date: dateCols[0].date,
      last_date: dateCols[dateCols.length - 1].date,
      stats_to_send: stats.length,
      banner_rows: bannerRows,
      banner_stats_to_send: bannerStats,
      future_post_rows_skipped: future,
      future_date_cells_skipped: futureDateCells,
      blank_date_cells_skipped: blankDateCells,
      non_banner_carry_skipped: carrySkipped,
    }));

    if (stats.length === 0) { safeAlert_("입력할 조회수 데이터가 없습니다."); return; }

    const posts = Object.keys(postByKey).map(k => postByKey[k]);
    const res = postStats_({ posts: posts, stats: stats });
    Logger.log(JSON.stringify({
      event: "importStats_result",
      inserted: res.inserted || 0,
      banner_reach_inserted: res.banner_reach_inserted || 0,
      future_date_skipped: res.future_date_skipped || 0,
      missing_urls: res.missing_urls || 0,
      dropped_decrease: res.dropped_decrease || 0,
    }));
    let msg = `✅ 일자별 조회수 ${res.inserted}건 입력 완료.\n(날짜 ${dateCols.length}개 열 · 매칭 게시물 ${res.matched_urls}개`;
    msg += res.created_posts ? ` · 신규 광고 ${res.created_posts}개 자동 생성)` : `)`;
    if (res.banner_reach_inserted) msg += `\n🖼️ 배너 도달수 ${res.banner_reach_inserted}건 반영.`;
    if (res.meta_filled) msg += `\n📝 기존 광고의 빈 항목 ${res.meta_filled}건을 시트 값으로 채움(채널 분류 등).`;
    if (res.ended_marked) msg += `\n🛑 캡션 '삭제/보관' ${res.ended_marked}건 → '종료' 처리됨.`;
    if (future) msg += `\n⏭️ 업로드일이 오늘 이후인 행 ${future}건 제외(아직 게시 전).`;
    if (futureDateCells) msg += `\n⏭️ 오늘 이후 날짜 셀 ${futureDateCells}건 제외.`;
    if (res.future_date_skipped) msg += `\n⏭️ 서버에서 오늘 이후 날짜 ${res.future_date_skipped}건 제외.`;
    if (res.pre_posted_skipped) msg += `\n🛡️ 업로드일 이전 조회수 ${res.pre_posted_skipped}건은 서버에서 저장 제외.`;
    if (res.dropped_decrease) {
      msg += `\n🛡️ 누적 조회수가 직전보다 낮은(수집 오류) ${res.dropped_decrease}건은 저장 제외.`;
      if (res.dropped_sample && res.dropped_sample.length) {
        const ex = res.dropped_sample.slice(0, 8).map(function(d) {
          const tail = String(d.url || "").split("/").filter(String).slice(-2).join("/");
          return `  · ${tail} ${d.date}: 입력 ${d.value} < 기존 ${d.blocked_by}(${d.blocked_date})`;
        }).join("\n");
        msg += `\n(예시 — 입력값이 기존값보다 낮아 막힘):\n${ex}`;
      }
    }
    if (res.missing_urls) {
      msg += `\n\n⚠️ 처리 못한 URL ${res.missing_urls}개 (예: ${(res.missing_sample || []).join(", ")})`;
    }
    if (res.overwrote_manual) {
      msg += `\n\nℹ️ 대시보드에서 수정돼 있던 ${res.overwrote_manual}칸을 시트 값으로 갱신했습니다(가장 최근 입력이 반영됨).`;
    }
    msg += `\n\n📌 여기서 입력한 조회수는 대시보드에 반영되며, 밤 자동수집은 이 값을 덮지 않습니다.\n   같은 칸을 대시보드에서 더 나중에 고치면 그 값이 최신으로 우선합니다.`;
    safeAlert_(msg + blankNote_());
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
  }
}

function previewNew() {
  try {
    const { rows, skipped, dupCount, future } = collectRows_(true);
    if (rows.length === 0) { safeAlert_("추가할 신규 광고가 없습니다." + noteExtra_(skipped, dupCount, future)); return; }
    const sample = rows.slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.url}\n   채널:${r.account_name || "-"} / 분류:${r.channel_type || "-"} / 프로젝트:${r.project_name || "-"} / 비용:${r.cost != null ? r.cost : "-"}`)
      .join("\n");
    safeAlert_(`총 ${rows.length}개 추가 예정 (상위 5개 미리보기)\n\n${sample}` + noteExtra_(skipped, dupCount, future));
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
  }
}

function checkSetup() {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const triggers = ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === "syncNew" || t.getHandlerFunction() === "dailyAuto");
    const dailyAutoCount = triggers.filter(t => t.getHandlerFunction() === "dailyAuto").length;
    const legacySyncNewCount = triggers.filter(t => t.getHandlerFunction() === "syncNew").length;
    const props = PropertiesService.getScriptProperties();
    const lastStarted = props.getProperty("DAILY_AUTO_LAST_STARTED_AT") || "-";
    const lastFinished = props.getProperty("DAILY_AUTO_LAST_FINISHED_AT") || "-";
    const lastStatus = props.getProperty("DAILY_AUTO_LAST_STATUS") || "기록 없음";
    const scriptTimezone = Session.getScriptTimeZone();
    const kstToday = todayStr_();
    safeAlert_(
      `✅ 설정 정상\n` +
      `탭: ${sheet.getName()}\n` +
      `인식된 필드: ${Object.keys(fieldCols).join(", ")}\n\n` +
      `🕘 스크립트 시간대: ${scriptTimezone} / KST 오늘: ${kstToday}\n` +
      `⏰ 자동 동기화 트리거: dailyAuto ${dailyAutoCount}개, 구버전 syncNew ${legacySyncNewCount}개\n` +
      `예정: 매일 ${CONFIG.TRIGGER_HOUR}:${CONFIG.TRIGGER_MINUTE} KST 전후(12:20 리포트 전)\n` +
      `마지막 dailyAuto 시작: ${lastStarted}\n` +
      `마지막 dailyAuto 종료: ${lastFinished}\n` +
      `마지막 상태: ${lastStatus}`
    );
  } catch (e) {
    safeAlert_("❌ 설정 오류\n" + e.message);
  }
}

// 🔁 중복 URL 검사 — 같은 게시물URL이 여러 행에 있으면 첫 행만 전송되고 나머지는 무시됨.
// 어느 행이 어느 행과 중복인지(전송/무시) 행 번호로 보여준다.
function checkDuplicates() {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) { safeAlert_("데이터 행이 없습니다."); return; }
    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getValues();

    const byKey = {}; // urlKey → [{row, url}]
    values.forEach((row, i) => {
      const rawUrl = String(row[fieldCols.url - 1] || "").trim();
      if (!rawUrl || !ALLOWED_URL_RE.test(rawUrl)) return;
      const key = urlKey_(rawUrl);
      (byKey[key] = byKey[key] || []).push({ row: CONFIG.DATA_START_ROW + i, url: rawUrl });
    });

    const dups = Object.keys(byKey).map(k => byKey[k]).filter(g => g.length > 1);
    if (dups.length === 0) { safeAlert_("✅ 중복 URL 없음 — 모든 행의 게시물URL이 고유합니다."); return; }

    const lines = dups.slice(0, 15).map(g => {
      const rows = g.map(e => e.row);
      return `· 전송 ${rows[0]}행 / 무시 ${rows.slice(1).join(",")}행\n   ${g[0].url}`;
    }).join("\n");
    safeAlert_(`🔁 중복 URL ${dups.length}건\n(같은 URL이 여러 행 → 첫 행만 전송, 나머지 무시)\n무시되는 행의 URL을 그 게시물의 실제 주소로 바꾸세요.\n\n${lines}${dups.length > 15 ? `\n… 외 ${dups.length - 15}건` : ""}`);
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 자동 트리거 (매일 9:30, dailyAuto 실행: syncAll → pullFromDB → exportStats)
// ═══════════════════════════════════════════════════════════════
function findHeaderCol_(sheet, names) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const wanted = names.map(n => norm_(n));
  const idx = headers.findIndex(h => wanted.includes(norm_(h)));
  return idx === -1 ? null : idx + 1;
}

function getTrackingStatusCol_(sheet) {
  const col = findHeaderCol_(sheet, ["상태"]);
  if (col) return col;
  const next = sheet.getLastColumn() + 1;
  sheet.getRange(CONFIG.HEADER_ROW, next).setValue("상태");
  return next;
}

function trackingEndedAtFromStatus_(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return undefined;
  if (s.indexOf("종료") >= 0) return todayStr_();
  if (s.indexOf("중") >= 0 || s.indexOf("재개") >= 0) return null;
  return undefined;
}

function postTrackingRows_(rows) {
  if (!rows.length) return { updated: 0, missing: [] };
  const res = UrlFetchApp.fetch(CONFIG.TRACKING_API_URL, {
    method: "post",
    contentType: "application/json",
    headers: authHeaders_(),
    payload: JSON.stringify({ rows }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) throw new Error("tracking-by-url API " + code + ": " + text);
  return JSON.parse(text);
}

function onStatusEdit_(e) {
  try {
    if (!e || !e.range || !e.source) return;
    const sheet = e.range.getSheet();
    if (sheet.getSheetId() !== CONFIG.SHEET_GID) return;
    if (e.range.getRow() < CONFIG.DATA_START_ROW || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    const statusCol = findHeaderCol_(sheet, ["상태"]);
    if (!statusCol || e.range.getColumn() !== statusCol) return;
    const endedAt = trackingEndedAtFromStatus_(e.value);
    if (endedAt === undefined) return;
    const fieldCols = buildFieldCols_(sheet);
    const url = String(sheet.getRange(e.range.getRow(), fieldCols.url).getValue() || "").trim();
    if (!url) return;
    const result = postTrackingRows_([{ url, ended_at: endedAt }]);
    SpreadsheetApp.getActive().toast("상태 DB 반영: " + (result.updated || 0) + "건", "완료", 4);
  } catch (err) {
    Logger.log("onStatusEdit_: " + (err.stack || err.message));
    SpreadsheetApp.getActive().toast("상태 DB 반영 실패: " + err.message, "오류", 6);
  }
}

function installStatusEditTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "onStatusEdit_")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onStatusEdit_")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  safeAlert_("상태 열 수기수정 즉시 DB 반영 트리거를 설치했습니다.");
}

function removeStatusEditTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "onStatusEdit_");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_("상태 열 DB 반영 트리거를 제거했습니다. (" + triggers.length + "개)");
}

function syncStatus() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const fieldCols = buildFieldCols_(sheet);
  const statusCol = getTrackingStatusCol_(sheet);
  const resp = UrlFetchApp.fetch(CONFIG.LIST_API_URL, { headers: authHeaders_(), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error("상태 동기화 API " + resp.getResponseCode() + ": " + resp.getContentText());
  const posts = (JSON.parse(resp.getContentText()).posts) || [];
  const ended = {};
  posts.forEach(p => { if (p && p.url) ended[linkKey_(p.url)] = !!p.ended_at; });
  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const urls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, n, 1).getValues();
  const out = urls.map(r => {
    const url = String(r[0] || "").trim();
    if (!url) return [""];
    const uu = url.toLowerCase();
    if (uu.indexOf("instagram.com") >= 0 && !/\/(p|reels|reel|tv)\/[a-z0-9_-]+/i.test(uu)) return ["오류"];
    const k = linkKey_(url);
    if (!(k in ended)) return [""];
    return [ended[k] ? "트래킹 종료" : "트래킹 중"];
  });
  sheet.getRange(CONFIG.DATA_START_ROW, statusCol, n, 1).setValues(out);
  SpreadsheetApp.getActive().toast("상태 동기화 완료: " + n + "행", "완료", 4);
  return true;
}

function refreshCumulativeViews() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const cumCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  if (!cumCol) return true;
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const dateCols = [];
  for (let i = CONFIG.STATS_FIRST_COL - 1; i < headers.length; i++) {
    if (headerDate_(headers[i])) dateCols.push(i + 1);
  }
  if (!dateCols.length) return true;
  const first = colLetter_(Math.min.apply(null, dateCols));
  const last = colLetter_(Math.max.apply(null, dateCols));
  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const data = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
  const currentValues = sheet.getRange(CONFIG.DATA_START_ROW, cumCol, n, 1).getValues();
  const currentFormulas = sheet.getRange(CONFIG.DATA_START_ROW, cumCol, n, 1).getFormulas();
  const formulas = [];
  for (let i = 0; i < n; i++) {
    const r = CONFIG.DATA_START_ROW + i;
    const hasDateMetric = dateCols.some(c => typeof data[i][c - 1] === "number" && data[i][c - 1] > 0);
    const manualValue = currentFormulas[i][0] === "" && currentValues[i][0] !== "" && currentValues[i][0] != null;
    if (!hasDateMetric && manualValue) {
      formulas.push([currentValues[i][0]]);
    } else {
      formulas.push(["=IF(COUNT(" + first + r + ":" + last + r + ")=0,\"\",MAX(" + first + r + ":" + last + r + "))"]);
    }
  }
  sheet.getRange(CONFIG.DATA_START_ROW, cumCol, n, 1).setValues(formulas);
  SpreadsheetApp.getActive().toast("누적 조회수 수식 갱신: " + n + "행", "완료", 4);
  return true;
}

function parseCreator_(name) {
  const result = { mk: "", pd: "" };
  if (!name || name.charAt(0) !== "[") return result;
  const parts = String(name).split("_");
  if (parts.length > 10) result.mk = String(parts[10] || "").trim();
  if (parts.length > 13) {
    const tail = parts.slice(13).join("_").trim().replace(/\.(mp4|mov|png|jpe?g|gif|webp|zip|pdf)$/i, "");
    result.pd = (tail.split("_").pop() || "").trim().replace(/\s*\(\d+\)\s*$/, "").trim();
  }
  return result;
}

function syncCreators() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const sourceCol = findHeaderCol_(sheet, ["소재명"]);
  const plannerCol = findHeaderCol_(sheet, ["기획자"]);
  const makerCol = findHeaderCol_(sheet, ["제작자", "PD", "디자이너"]);
  if (!sourceCol || !plannerCol || !makerCol) return true;
  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const source = sheet.getRange(CONFIG.DATA_START_ROW, sourceCol, n, 1).getValues();
  const planners = sheet.getRange(CONFIG.DATA_START_ROW, plannerCol, n, 1).getValues();
  const makers = sheet.getRange(CONFIG.DATA_START_ROW, makerCol, n, 1).getValues();
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const parsed = parseCreator_(source[i][0]);
    if (parsed.mk) { planners[i][0] = parsed.mk; filled++; }
    if (parsed.pd) { makers[i][0] = parsed.pd; filled++; }
  }
  sheet.getRange(CONFIG.DATA_START_ROW, plannerCol, n, 1).setValues(planners);
  sheet.getRange(CONFIG.DATA_START_ROW, makerCol, n, 1).setValues(makers);
  SpreadsheetApp.getActive().toast("기획자/제작자 갱신: " + filled + "칸", "완료", 4);
  return true;
}

function getPricingSheet_() {
  const target = 1649102171;
  const sheets = SpreadsheetApp.getActive().getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === target) return sheets[i];
  }
  return null;
}

function priceChannelKey_(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_+/g, "_");
}

function addUniqueMapValue_(map, key, value) {
  if (!key || value === "" || value == null) return;
  if (!map[key]) map[key] = {};
  map[key][String(value)] = true;
}

function onlyUniqueMapValue_(map, key) {
  const vals = Object.keys(map[key] || {});
  return vals.length === 1 ? vals[0] : null;
}

function pricingFormatFromType_(channelType) {
  const s = String(channelType == null ? "" : channelType);
  if (s.indexOf("배너") >= 0) return "배너";
  if (s.indexOf("영상") >= 0 || s.indexOf("릴스") >= 0 || s.indexOf("숏폼") >= 0) return "릴스";
  return "";
}

function syncPricing() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const fieldCols = buildFieldCols_(sheet);
  if (!fieldCols.account_name || !fieldCols.channel_type || !fieldCols.company_name || !fieldCols.cost) return true;
  const pricing = getPricingSheet_();
  if (!pricing) throw new Error("가격/업체명 매핑 시트를 찾을 수 없습니다.");
  const rows = pricing.getDataRange().getValues();
  const companyByChannel = {};
  const priceByChannelFormat = {};
  for (let i = 1; i < rows.length; i++) {
    const key = priceChannelKey_(rows[i][0]);
    const company = String(rows[i][1] == null ? "" : rows[i][1]).trim();
    const format = String(rows[i][2] == null ? "" : rows[i][2]).trim();
    const price = toNumber_(rows[i][3]);
    addUniqueMapValue_(companyByChannel, key, company);
    if (format && price !== null) addUniqueMapValue_(priceByChannelFormat, key + "|" + format, price);
  }
  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const data = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, sheet.getLastColumn()).getValues();
  let filledCompany = 0, filledCost = 0, ambiguous = 0;
  for (let r = 0; r < n; r++) {
    const row = data[r];
    const key = priceChannelKey_(row[fieldCols.account_name - 1]);
    const type = String(row[fieldCols.channel_type - 1] || "");
    if (!key || type.indexOf("바이럴") < 0) continue;
    const company = onlyUniqueMapValue_(companyByChannel, key);
    if ((row[fieldCols.company_name - 1] === "" || row[fieldCols.company_name - 1] == null) && company) {
      sheet.getRange(CONFIG.DATA_START_ROW + r, fieldCols.company_name).setValue(company);
      filledCompany++;
    } else if (!company && companyByChannel[key]) {
      ambiguous++;
    }
    const format = pricingFormatFromType_(type);
    const price = format ? onlyUniqueMapValue_(priceByChannelFormat, key + "|" + format) : null;
    if ((row[fieldCols.cost - 1] === "" || row[fieldCols.cost - 1] == null) && price !== null) {
      sheet.getRange(CONFIG.DATA_START_ROW + r, fieldCols.cost).setValue(Number(price));
      filledCost++;
    } else if (format && !price && priceByChannelFormat[key + "|" + format]) {
      ambiguous++;
    }
  }
  SpreadsheetApp.getActive().toast("가격/업체명 채움: 업체 " + filledCompany + ", 비용 " + filledCost + ", 애매함 " + ambiguous, "완료", 5);
  return true;
}

function installDailyTrigger() {
  // 기존 트리거(구버전 syncNew 포함) 제거 후 양방향 dailyAuto로 재등록
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "syncNew" || t.getHandlerFunction() === "dailyAuto")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("dailyAuto")
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .nearMinute(CONFIG.TRIGGER_MINUTE)
    .create();

  safeAlert_(`✅ 매일 오전 ${CONFIG.TRIGGER_HOUR}:${CONFIG.TRIGGER_MINUTE} (±15분) 자동 동기화를 켰습니다.\n• 시트→사이트: 전체 메타 syncAll\n• 사이트→시트: 대시보드 추가분/수집 조회수 가져오기\n• 12:20 리포트 전에 분류 동기화`);
}

function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "syncNew" || t.getHandlerFunction() === "dailyAuto");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_(`⏹ 자동 동기화를 껐습니다. (${triggers.length}개 트리거 제거)`);
}

// ═══════════════════════════════════════════════════════════════
// 💻 배너 인사이트 요청 — 업체별 채널 조회 (기존 기능)
// ═══════════════════════════════════════════════════════════════
function summarizeByCompany() {
  // [콘텐츠 대시보드 연동] 탭(gid=CONFIG.SHEET_GID)을 헤더 이름 기반으로 읽는다.
  // ⚠️ 이전엔 열 위치(D/G/I/J)·시작행(10)을 하드코딩해, 업체명 열이 삽입되며 다 어긋나 결과가 비었음(2026-07).
  //    buildFieldCols_로 헤더명(업체명·채널 분류·채널명·게시물URL) 위치를 찾아 앞으로 열이 밀려도 안 깨지게 한다.
  const sheet = getSheet_();
  const fc = buildFieldCols_(sheet);
  const cCompany = fc.company_name, cType = fc.channel_type, cChannel = fc.account_name, cUrl = fc.url;
  if (!cCompany || !cType) {
    safeAlert_("헤더에 '업체명'과 '채널 분류' 컬럼이 필요합니다. [콘텐츠 대시보드 연동] 탭 1행 헤더를 확인하세요.");
    return;
  }

  const companyMap = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= CONFIG.DATA_START_ROW) {
    const allRows = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
    for (const row of allRows) {
      if (!String(row[cType - 1] || '').includes('배너')) continue;   // 배너 채널분류만(예: '바이럴 (배너)')
      const company = String(row[cCompany - 1] || '').trim();
      if (!company) continue;
      const channel = (cChannel ? String(row[cChannel - 1] || '').trim() : '') || '(채널명 없음)';
      const url = cUrl ? String(row[cUrl - 1] || '').trim() : '';
      if (!companyMap[company]) companyMap[company] = {};
      if (!companyMap[company][channel]) companyMap[company][channel] = new Set();
      if (url) companyMap[company][channel].add(url);
    }
  }

  const dataJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(companyMap).map(([co, channels]) => [
        co,
        Object.fromEntries(
          Object.entries(channels).map(([ch, urls]) => [ch, [...urls]])
        )
      ])
    )
  );

  const companies = Object.keys(companyMap).sort();
  const companyOptions = companies.map(c => `<option value="${c}">${c}</option>`).join('');

  const html = HtmlService.createHtmlOutput(`
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Noto Sans KR', sans-serif; padding: 20px; background: #f8f9fa; margin: 0; }
  h2 { color: #1a73e8; font-size: 16px; margin-bottom: 16px; }
  label { font-size: 13px; font-weight: 600; color: #444; display: block; margin-bottom: 4px; }
  select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; margin-bottom: 14px; background: white; }
  button { width: 100%; padding: 10px; background: #1a73e8; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 16px; }
  button:hover { background: #1558b0; }
  .result-box { display: none; }
  .channel-block { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .channel-name { font-size: 13px; font-weight: 700; color: #1a73e8; margin-bottom: 6px; }
  .url-list { font-size: 12px; color: #444; line-height: 1.8; word-break: break-all; }
  .copy-btn { width: 100%; padding: 6px; background: #f1f3f4; color: #444; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; cursor: pointer; margin-top: 8px; }
  .copy-btn:hover { background: #e0e0e0; }
  .copy-all-btn { width: 100%; padding: 10px; background: #34a853; color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; margin-bottom: 12px; }
  .copy-all-btn:hover { background: #2d8f47; }
  .toast { display: none; position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #333; color: white; padding: 8px 18px; border-radius: 20px; font-size: 12px; z-index: 999; }
</style>
</head>
<body>
<h2>🏢 배너 인사이트 요청</h2>
<label>업체 선택</label>
<select id="selCompany">
  <option value="">-- 업체 선택 --</option>
  ${companyOptions}
</select>
<button onclick="showCompany()">조회하기</button>
<div class="result-box" id="resultBox">
  <button class="copy-all-btn" onclick="copyAll()">📋 전체 복사</button>
  <div id="channelList"></div>
</div>
<div class="toast" id="toast"></div>
<script>
const data = ${dataJson};
function showCompany() {
  const company = document.getElementById('selCompany').value;
  if (!company) return;
  const channels = data[company];
  if (!channels) return;
  const listEl = document.getElementById('channelList');
  listEl.innerHTML = '';
  for (const [channel, urls] of Object.entries(channels)) {
    const urlText = urls.join('\\n');
    const block = document.createElement('div');
    block.className = 'channel-block';
    block.innerHTML = \`
      <div class="channel-name">\${channel}</div>
      <div class="url-list">\${urls.join('<br>')}</div>
      <button class="copy-btn" onclick="copyText(\\\`\${channel}\\\\n\${urlText}\\\`)">📋 이 채널 복사</button>
    \`;
    listEl.appendChild(block);
  }
  document.getElementById('resultBox').style.display = 'block';
}
function copyAll() {
  const company = document.getElementById('selCompany').value;
  if (!company) return;
  const channels = data[company];
  let text = company + '\\n\\n';
  for (const [channel, urls] of Object.entries(channels)) {
    text += channel + '\\n' + urls.join('\\n') + '\\n\\n';
  }
  copyText(text.trim());
}
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('복사됐어요!'));
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2000);
}
</script>
</body>
</html>
`).setWidth(400).setHeight(580);

  SpreadsheetApp.getUi().showModalDialog(html, '배너 인사이트 요청');
}
