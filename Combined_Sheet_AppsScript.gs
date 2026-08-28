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
 * 3) (자동화) 메뉴 → "⏰ 매일 8:30 자동 추가 켜기" 1회 클릭 → 권한 승인
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
  SCHEDULE_HEARTBEAT_URL: "https://influencer-seeding-mu.vercel.app/api/ops/schedule-heartbeat",  // GitHub 크론 생존 감시(구글 스케줄러가 호출 = 크로스 프로바이더)
  COLLECT_FALLBACK_URL: "https://influencer-seeding-mu.vercel.app/api/ops/collect-fallback",      // 자정수집 누락 시 Apify 폴백 수집(비어 있을 때만 동작)
  AUDIT_FALLBACK_URL: "https://influencer-seeding-mu.vercel.app/api/ops/audit-fallback",          // 아침 수식감사 미발화 시 폴백 감사(오늘 감사 없을 때만 동작)
  ENSURE_DAILY_AUDITS_URL: "https://influencer-seeding-mu.vercel.app/api/ops/ensure-daily-audits", // 수식·제작자 감사를 함께 보장(오늘 성공한 워크플로는 건너뜀)
  ENSURE_DAILY_REPORT_URL: "https://influencer-seeding-mu.vercel.app/api/ops/ensure-daily-report", // 일일 증분 리포트 발송 보장(오늘 성공 실행 0건이면 자동 dispatch)
  COLLECTION_STATUS_URL: "https://influencer-seeding-mu.vercel.app/api/ops/collection-status", // exportStats 전 대상일 자정수집 완료 마커 확인
  DB_SHEET_SYNC_ALERT_URL: "https://influencer-seeding-mu.vercel.app/api/ops/db-sheet-sync-alert", // DB→시트 독립 동기화 실패 Slack 경고
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  STATUS_HEADER: "등록상태",
  TRIGGER_HOUR: 8,
  TRIGGER_MINUTE: 30,
  STATS_FIRST_COL: 9,        // 일자별 조회수 시작 열 (I열). 끝 열은 자동(데이터가 AE 넘어 늘어나도 OK).
  STATS_START_YEAR: 2026,    // 가장 왼쪽 날짜 열의 연도. 월이 줄면(예: 12→1) 자동으로 +1년 처리.
};

// 라이브 배포 드리프트 감시용 버전 스탬프 — importStats가 서버(stats-import)에 보고하고,
// 서버 기대값(EXPECTED_IMPORTSTATS_CLIENT)과 다르면 임포트 때마다 Slack 경고가 울린다.
// 왜: 라이브 .gs는 git 밖(수동 붙여넣기 배포)이라 stale 베이스 붙여넣기로 패치가 조용히
// 되돌아가도 흔적이 없다(2026-07-27 배너 스킵 잔존 사고 — "반영 완료" 기록과 라이브 실물 불일치).
// 규약: importStats 관련 라이브 반영 때마다 이 값과 서버 기대값을 같은 커밋에서 함께 올린다(계약테스트로 짝 강제).
const IMPORTSTATS_CLIENT_VERSION = "2026-08-25-banner-reclass-v1";

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
  "기획자": "planner",
  "제작자": "creator",
  "비용": "cost",
};

// 사이트가 허용하는 URL (인스타 / 유튜브 / 틱톡 / 페이스북 / 스레드 / X(트위터) / 카카오 숏폼 / 네이버 클립, 다단계 서브도메인 포함). 서버 필터와 동일.
const ALLOWED_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net|x\.com|twitter\.com|t\.co|kakao\.com|naver\.com)\//i;

// TikTok video/photo ID는 uint64 snowflake. 잘못 붙은 20자리 숫자가 별도 게시물로 등록돼
// DB→시트에서 조회수만 남은 고아 행을 만든 사고(2026-08-07)를 모든 시트 경로에서 차단한다.
const MAX_TIKTOK_SNOWFLAKE_ = "18446744073709551615";
function isValidTikTokSnowflake_(id) {
  var s = String(id || "");
  if (!/^\d+$/.test(s)) return false;
  s = s.replace(/^0+/, "") || "0";
  return s.length < MAX_TIKTOK_SNOWFLAKE_.length ||
    (s.length === MAX_TIKTOK_SNOWFLAKE_.length && s <= MAX_TIKTOK_SNOWFLAKE_);
}
function isInvalidTikTokPostUrl_(url) {
  var raw = String(url || "");
  if (!/tiktok\.com/i.test(raw) && !/^tt:/i.test(raw)) return false;
  var m = raw.match(/\/(?:video|photo)\/(\d+)/i) || raw.match(/^tt:(\d+)$/i);
  return !!(m && !isValidTikTokSnowflake_(m[1]));
}

// 필드 → 표시용 컬럼명 (빈칸 검사 보고용)
const FIELD_LABEL = {
  posted_at: "업로드일", url: "게시물URL", account_name: "채널명", content_summary: "캡션",
  asset_name: "소재명", channel_type: "채널 분류", project_name: "프로젝트명", product_name: "상품명", cost: "비용",
  company_name: "업체명", planner: "기획자", creator: "제작자",
};

// ═══════════════════════════════════════════════════════════════
// 메뉴
// ═══════════════════════════════════════════════════════════════
function automationMenuLabel_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const enabled = props.getProperty("AUTO_SYNC_ENABLED");
    if (enabled === "false") return "⏰ 자동화 ⏹ 꺼짐";
    if (enabled === "true") return "⏰ 자동화 ✅ 켜짐";

    // simple onOpen에서는 트리거 목록 API가 권한 오류를 내므로 호출하지 않는다.
    // 명시적 켜기/끄기 상태가 아직 없는 구버전은 최근 dailyAuto 실행 기록으로 1회 이관한다.
    const lastFinished = Date.parse(props.getProperty("DAILY_AUTO_LAST_FINISHED_AT") || "");
    if (Number.isFinite(lastFinished) && Date.now() - lastFinished < 36 * 60 * 60 * 1000) {
      return "⏰ 자동화 ✅ 켜짐";
    }
    return "⏰ 자동화 ⚠️ 상태 확인";
  } catch (err) {
    Logger.log("automationMenuLabel_: " + (err.stack || err.message));
    return "⏰ 자동화 ⚠️ 상태 확인";
  }
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const statsMenu = ui.createMenu("📊 조회수")
    .addItem("시트 → DB 조회수 반영", "importStats")
    .addItem("DB → 시트 조회수·누적·증분 반영", "exportStats");

  const metadataMenu = ui.createMenu("🔄 메타데이터 · 복구")
    .addItem("대시보드 추가분 가져오기", "pullFromDB")
    .addItem("파생정보 전체 업데이트", "refreshSheetDerivedFields")
    .addItem("시트 변경사항 DB 반영", "syncAllWithConfirm");

  const checkMenu = ui.createMenu("🔎 점검 · 정리")
    .addItem("빈칸 · 중복 URL 검사", "checkSheetIssues")
    .addItem("중복 링크 삭제", "removeDuplicateLinks");

  const automationMenu = ui.createMenu(automationMenuLabel_())
    .addItem("자동화 상태 · 최근 실행 보기", "checkSetup")
    .addItem("DB→시트 지금 동기화", "runDbPullSyncNow")
    .addItem("자동 동기화 켜기 · 복구", "installDailyTrigger")
    .addItem("자동 동기화 끄기", "removeDailyTrigger");

  ui.createMenu("🚀 광고 모니터링")
    .addItem("신규 전송 미리보기", "previewNew")
    .addItem("신규 광고 추가", "syncNew")
    .addSeparator()
    .addSubMenu(statsMenu)
    .addSubMenu(metadataMenu)
    .addSubMenu(checkMenu)
    .addSubMenu(automationMenu)
    .addToUi();

  addInsightInquiryMenu_();
}

function syncAllWithConfirm() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    "시트 변경사항 DB 반영",
    "시트 행을 URL 기준으로 비교하고 DB와 값이 다른 필드만 수정합니다.\n\n동일한 값은 건너뛰고, 시트 빈칸으로 기존 DB 값을 지우지 않습니다. 의도적인 빈칸은 '-'로 표시합니다.\n\n계속할까요?",
    ui.ButtonSet.OK_CANCEL
  );
  if (result !== ui.Button.OK) {
    SpreadsheetApp.getActive().toast("변경사항 반영을 취소했습니다.", "취소", 4);
    return;
  }
  runSync_(false);
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

const AUTO_WRITE_ACTIVE_UNTIL_PROP = "SHEET_AUTO_WRITE_ACTIVE_UNTIL";
const AUTO_WRITE_GUARD_MS = 12 * 60 * 1000;
const AUTO_WRITE_TAIL_GUARD_MS = 90 * 1000;

function isAutoWriteActive_() {
  const until = Number(PropertiesService.getScriptProperties().getProperty(AUTO_WRITE_ACTIVE_UNTIL_PROP) || 0);
  return until > Date.now();
}

function withAutoWriteGuard_(fn) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(AUTO_WRITE_ACTIVE_UNTIL_PROP, String(Date.now() + AUTO_WRITE_GUARD_MS));
  try {
    return fn();
  } finally {
    props.setProperty(AUTO_WRITE_ACTIVE_UNTIL_PROP, String(Date.now() + AUTO_WRITE_TAIL_GUARD_MS));
  }
}

function skipEditDuringAutoWrite_(name) {
  if (!isAutoWriteActive_()) return false;
  Logger.log("edit_trigger_skipped " + JSON.stringify({
    trigger: name,
    reason: "auto_write_active",
    at: new Date().toISOString(),
  }));
  return true;
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
 * @returns {{rows, rowNums, rowRefs, statusCol, skipped:number, dupCount:number, future:number, lastRow:number}}
 */
function collectRows_(onlyNew) {
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const statusCol = getStatusCol_(sheet);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const today = todayStr_();
  let skipped = 0, dupCount = 0, future = 0;
  if (lastRow < CONFIG.DATA_START_ROW) {
    return { rows: [], rowNums: [], rowRefs: [], statusCol, skipped, dupCount, future, lastRow };
  }

  const values = sheet
    .getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol)
    .getValues();

  const byKey = {}; // 정규화된 URL → 전송 객체 (첫 행 우선, 중복 제거)
  const rowNums = [];
  const rowRefs = [];

  values.forEach((row, i) => {
    const rowNum = CONFIG.DATA_START_ROW + i;
    const rawUrl = String(row[fieldCols.url - 1] || "").trim();
    if (!rawUrl) return; // URL 없는 빈 행

    const status = String(row[statusCol - 1] || "").trim();
    if (onlyNew && status) return; // 이미 추가된 행

    if (!ALLOWED_URL_RE.test(rawUrl)) { skipped++; return; } // 지원 안 되는 URL
    if (/instagram\.com/i.test(rawUrl) && !/\/(p|reels|reel|tv)\/[A-Za-z0-9_-]+/i.test(rawUrl)) { skipped++; return; }
    if (isInvalidTikTokPostUrl_(rawUrl)) { skipped++; return; }

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
    if (fieldCols.planner)         obj.planner         = String(row[fieldCols.planner - 1] || "").trim() || null;
    if (fieldCols.creator)         obj.creator         = String(row[fieldCols.creator - 1] || "").trim() || null;
    if (fieldCols.cost)            obj.cost            = toNumber_(row[fieldCols.cost - 1]);

    const key = urlKey_(rawUrl);
    if (byKey[key]) {
      dupCount++;
      rowNums.push(rowNum);
      rowRefs.push({ row: rowNum, key: key });
      return;
    } // 같은 URL 중복 → 전송 1번만, 행은 등록 처리
    byKey[key] = obj;
    rowNums.push(rowNum);
    rowRefs.push({ row: rowNum, key: key });
  });

  const rows = Object.keys(byKey).map(k => byKey[k]);
  return { rows, rowNums, rowRefs, statusCol, skipped, dupCount, future, lastRow };
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
  if (canonical) {
    if (canonical[1].toLowerCase() === "tt" && !isValidTikTokSnowflake_(canonical[2])) return "";
    return canonical[1].toLowerCase() + ":" + canonical[2];
  }
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
  var tt = u.match(/tiktok\.com\/(?:.*\/)?(?:video|photo)\/(\d+)/i)
        || u.match(/\/(?:video|photo)\/(\d+)/i);
  if (tt) return isValidTikTokSnowflake_(tt[1]) ? "tt:" + tt[1] : "";
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
  const fields = ["posted_at", "url", "account_name", "content_summary", "channel_type", "project_name", "product_name", "cost"]
    .filter(f => fieldCols[f]);
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
    count: data.upserted != null ? data.upserted : rows.length,
    created: data.created || 0,
    ended: data.ended_marked || 0,
    filled: data.meta_filled || 0,
  };
}

function markRegistered_(sheet, statusCol, rowNums) {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  rowNums.forEach(r => sheet.getRange(r, statusCol).setValue("✅ " + stamp));
}

function assertSyncRowsStable_(sheet, rowRefs, expectedLastRow) {
  assertRowCountStable_(sheet, expectedLastRow, "syncNew formula fill");
  if (!rowRefs || rowRefs.length === 0) return;
  const urlCol = buildFieldCols_(sheet).url;
  rowRefs.forEach(ref => {
    const currentKey = urlKey_(sheet.getRange(ref.row, urlCol).getValue());
    if (!currentKey || currentKey !== ref.key) {
      throw new Error("신규 등록 중 행 위치가 바뀌었습니다. 수식/상태 쓰기를 중단합니다. (" + ref.row + "행)");
    }
  });
}

function ensureMetricFormulasForRows_(sheet, rowRefs, expectedLastRow) {
  if (!rowRefs || rowRefs.length === 0) return { rows: 0, cumulative: 0, increment: 0 };
  assertSyncRowsStable_(sheet, rowRefs, expectedLastRow);
  const rows = Array.from(new Set(rowRefs.map(ref => Number(ref.row))))
    .filter(row => Number.isFinite(row) && row >= CONFIG.DATA_START_ROW)
    .sort((a, b) => a - b);
  if (rows.length === 0) return { rows: 0, cumulative: 0, increment: 0 };
  let cumulative = 0, increment = 0;
  let start = rows[0], end = rows[0];
  const flushRun = () => {
    assertRowCountStable_(sheet, expectedLastRow, "syncNew formula fill");
    const result = ensureNewRowsMetricFormulas_(sheet, start, end);
    cumulative += result.cumulative || 0;
    increment += result.increment || 0;
  };
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] === end + 1) {
      end = rows[i];
      continue;
    }
    flushRun();
    start = rows[i];
    end = rows[i];
  }
  flushRun();
  assertSyncRowsStable_(sheet, rowRefs, expectedLastRow);
  return { rows: rows.length, cumulative: cumulative, increment: increment };
}

// ═══════════════════════════════════════════════════════════════
// 메뉴 핸들러
// ═══════════════════════════════════════════════════════════════
function runSync_(onlyNew) {
  try {
    const { rows, rowNums, rowRefs, statusCol, skipped, dupCount, future, lastRow } = collectRows_(onlyNew);
    if (rows.length === 0) {
      safeAlert_((onlyNew ? "추가할 신규 광고가 없습니다." : "반영할 시트 행이 없습니다.") + noteExtra_(skipped, dupCount, future));
      return true;
    }
    const { count, created, ended, filled } = postRows_(rows);
    const sheet = getSheet_();
    const formulaResult = onlyNew
      ? ensureMetricFormulasForRows_(sheet, rowRefs, lastRow)
      : { rows: 0, cumulative: 0, increment: 0 };
    markRegistered_(sheet, statusCol, rowNums);
    let okMsg;
    if (onlyNew) {
      okMsg = `✅ 신규 광고 확인 완료\n• 비교한 행: ${count}건\n• 새로 추가: ${created}건\n• 기존 행 변경: ${filled}건`;
      okMsg += `\n• H/I 수식 보강: 누적 ${formulaResult.cumulative}칸 · 증분 ${formulaResult.increment}칸`;
    } else {
      okMsg = `✅ 시트 변경사항 DB 반영 완료\n• 비교한 행: ${count}건\n• 새로 추가: ${created}건\n• 값이 달라 수정: ${filled}건`;
    }
    if (ended) okMsg += `\n• 삭제/보관 캡션으로 종료: ${ended}건`;
    safeAlert_(okMsg + noteExtra_(skipped, dupCount, future) + blankNote_());
    return true;
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}

function syncNew()  { return withDocLock_(function() { return runSync_(true); }); }
function syncAll()  { runSync_(false); }

function companyPollutionRepairKey20260818_(url, accountName) {
  const accountKey = String(accountName == null ? "" : accountName).trim().toLowerCase().replace(/[\s._·-]/g, "");
  const cleanUrl = String(url == null ? "" : url).trim().split("?")[0];
  if (accountKey === "timeholy" && /instagram\.com\/time_holy\/reels\/?$/i.test(cleanUrl)) {
    return "url:https://instagram.com/time_holy/reels/";
  }
  return linkKey_(url);
}

function companyPollutionSource20260818_() {
  const EXPECTED_COUNT = 313;
  const APPROVED_KEY_HASHES = "00917c01d10f8c09,017922aa254ddf4d,02529e872fc54e93,0494224b0888a875,0631a43d0720ca56,069473fd2d28990c,06d67dbd797e6d82,079cd41b1b708ee8,07a3c472837d6ffa,07e4b07af3c6de8b,084db3c7d6ad3bc4,08666ee246afebf6,09d2cd554f5a5116,0a357b49b8913ea3,0b1fd2113dde428a,0c0dbe6169a250f1,0ce9a4842a94a8f4,111579f277d0e517,116e09567643f490,11cd35fd0bc6993e,133373bb240f426b,13b9ed5cd1d68648,1633255e3a798b60,16a75bdb6ef8e482,18634104a190c3f7,189ecd93f7cfee20,1b5e3037c35eae28,1b66fef25774d294,1b88ed3d2d26492e,1c44ea5a92c7e510,1d3cea91153056c9,1e8c925c30cb8da0,1f06f034a81f251c,1fa5888b42afb2b7,21aeb3ed93af74dd,21d0214bb7963f25,233869ec4b2629ff,235bc0d9240997ec,23695339acf66176,25bb32993ad09e14,26d5dab5af2ade7a,26fb582cec2ad00c,2709526c0c9c8698,28cb8c7b5e534b70,28e378b4c5dbc8f5,2916a9702144edef,2953019ad4c807b7,29745d69272ad142,29fc9699fa24a413,2ae5041446265061,2af7b07df298a060,2b723e31669a9a6f,2c5e9aded822f60c,2dbcc6f2d6b0eaf6,2df8b2754bd4f362,2e6a24cc4a405872,2eba7cf0b72eb48a,2eff6720bd56a5b5,2f081b777c2e74e5,2f3e4020acdbb4c7,3006fdba93eb03e5,31b256e49ff5d1b4,325fafad2a0e9218,329ac469b79f9f67,355ab5a28a802b20,362f7920b4616bca,3763436311746129,377ec8dc7fdb09fc,38ca54992106c3d9,38d54aefb9d382b2,38e63a455353856d,39bd438662575e8e,39dd5fbc8daee6dc,3a201c214c3be705,3b8bfa90c435a3a1,3c9b0d6345b46873,3ca699f3c50317b6,3d84f6ad244b2a43,3eb7bc1fefed64c1,3f4b8d31af2277c8,3fec8a4f79e2c3ee,41f1511eaf3d10ee,421fed02828f9000,447b04300f4df6f1,4498b479f117968e,470120c18408046a,470fbf5de6f50c96,475d23bb36c650ad,477ff602e1acdcb4,4892c64761f90fd4,4898a3ec978f6b11,48f5a5ad3c40d7dd,494da97acb98946e,49e89ee744d3e039,4a0d8c28702479e0,4a0e4a29ba9e7449,4a4752133a1ab8c7,4a9203adaa4af18f,4acb371a8c46f7af,4c5c4c43ca306653,4caed3f4789a7820,4df70570a2cd6e0f,507035f467d14440,50d5d95f0cc55b10,51006c959065567b,524b4d6f3308efcb,537c8eb74abdbc4b,53e37f01dee95722,545c8ec2cfdf0d9e,54b42bf1624edf71,55353d0809abb178,55ce79c846fdd6c2,56ad9d02a62596cd,5779aa6fecb7c276,5804e923aecc038e,58552ba90b6e7bb1,59805e5fcc686678,5a515c9935d75389,5b98a1bed9775a1d,5d5c036e29a0d0f2,5f4a11b1c73dbacc,5f9fe14fefb4d74d,61dc4596ecd055ee,620c5348978dd68b,621b0b54b75c630e,625146f0fac32189,64e2c6f16e976787,654bebd153c32ec7,65630369f40e2aec,65a28ef54373247e,65b531414e516c1c,65d7528222c0bf94,66fc31e3f816bc02,67cf5c73616ffc70,6803e865363ad5d7,691f58e18d6d5f28,6987f81bab93ac4a,6a2a2209e18bed2e,6a2a43ed910b96e0,6c6b697ce58f009e,6ca903e5c65b6dd3,6d0ded8e61d559e7,75b88344684ae839,75e34d485a9eb04f,764c2eb2b030e2cc,7771e90d71f4da51,77f5778c838fa7ef,78fe477d17946d5e,78fff5e2f117a1d4,7c786e335461e3df,7c9e39140c3630af,7caaa077fc0a5289,7da7f7cf82d78aba,808eb6ef43c5a768,828baf4be1157c36,82d894566019620d,83b6b1a053582557,848c39eef83004f7,8702c3fb73880430,876e150fc1d2fbed,8bc6d513bfd5fe88,8c42173cf3ed5bc8,8c49dda2001c1724,8c5b0a6a166a8d9e,8db762e9b06c3a87,8ea94c5fb9aa4364,90585e87e41952f7,9184b24cda048344,91e6a76410b6ca9d,925b7c1ac8d534c5,93df12b875d21ad8,94978b82dd31daa4,95af2d1d73a0d082,95e0ac0dab434cdf,97d9696ef74ef67c,980e1f01174aa63c,986b953f0c422ed6,991b034e799e922b,9940223c470bf415,99a1355b4578bde7,9ab9155cbb186ff1,9adefa1b1863093d,9b30617032866cfa,9b3c8a354eb63cba,9bc237b42ad01ed6,9d573c0f6d3ebf43,9e5cc69bb9a6f0cb,9e8c659d8cd4b3b6,9ef07b9980679a70,9f15463cd0e85987,9fbcd17c2525a6cd,a11c9c1cb04fb282,a2ea16ac90d11928,a367b445219f1d15,a47845bb78a36c28,a49f9f7b8a506f7b,a62e5e0306274926,a7600aba89eaa96c,a7d1d36d36b2d766,a85cef409fa0658f,aa4464b9074dd074,aaf14ab1eb76d6cd,aafa191b2b4ce564,ac11506aacdc18e4,acc2da971690bf84,ad00592bf9fe4999,ad46eb5b5ea57f4e,ae1e207750386fd2,ae22594373ea6cae,b17e52d7cee9bcd2,b18407cff5c67382,b1e03b28a0a82626,b1f61b02fcb7148c,b2d5ab4fc7a30417,b331b250eec7bf2d,b3872696acb3697f,b3f2f3473c38cd45,b68e82cefa1f90c4,b6b8be2738701ea8,b6c73fba281449d3,b98191878399ce49,bb833c5b195c1c2c,bbd109440dca7e8e,bbeaf86ffa1bfca6,bceccdd953d8ede1,bdb0dad196af112d,be5167ef2df67b9b,bedbddfd6fd5fe13,bf5430c77a77167e,bfd58a203d05ab3e,c01b99a85465e14c,c0a8042626c4213c,c20961c580a11690,c272dd8722e87ead,c50c71017d951c69,c74b09fe87a89a2c,c7b9473ffdfc87ae,c7f6d970bed6251c,c811fb008d7dd76b,c885d6bdd5345eea,c8f245a8fac0111a,c8f62ce65464ff00,c94c5e7a0aa8e372,c9883d10f4cea82d,ca40968249749e0d,cafe1e8d01309970,cb751dcd0b25968f,cbda8b5d9dbe388f,cc22877e8cf65f86,cc659589e65ae6ab,cd10a9c956c03ed2,cdc7d44b235f5d81,cdfc219d8b0d2ba2,ce65a44d45aa8d80,d09b4c10bc43f7b7,d4e1bbc1a191f7d7,d4fdaf98fe643e74,d5f5241485b6eb67,d727fda43ec9b8dc,dae607a30af51845,dc0cf40ad8d879ba,dc8223a9ae101a2e,dcaad5e22226ac38,dcbbe12519d132d7,dcbdfad52fab4164,dcd9da4423348f02,dd04ab1ead5cb191,de0e0a3fafc27aa5,de70c8c7c1a3073d,df31e22496bf41ac,e0007c81e9c6fba4,e006391f945acb08,e0845df97a915bc1,e2d69cffa9007589,e367a0693413d2ba,e47671aeecc7a44e,e5f95f64e6117e36,e67a7834bb5114da,e7329e64dd41fb3a,e8fc2b20e4c195c3,e98542907e5646d2,ea87ff7ddb347dd2,eaf5fa75316a72da,eb53f568588eca6b,ebfc20ecdccc6e58,ed423aefdd5979d5,edda02c39502f1e5,edfecf74493ba8c6,ee802491e7444adb,ef5e0f126686948a,ef7bebfb244bb656,f0e36e703be4bd98,f1e813f0a515f5c3,f243e8d12c3ad8f3,f2e37dc957196ec2,f41865fece3ceb47,f4edb2ee2c3a96f6,f6fa8801ee901645,f859afcd3b2b5067,f9813452bd29bb79,f98c3c535ee21290,fa0e0fa3edc95c9f,fa37f2a22823c44f,faaf488361c0db97,fb01ae26c456866f,fb63d0c3a3122512,fc10056db414aca1,fc9507f0850a843f,fce878272281c64a,fdb50d2d0582c5ad,fe65f5534bcd3454,ff2815925dd8c992,ffa9d9fc7fe604be".split(",").reduce((set, value) => {
    set[value] = true;
    return set;
  }, {});
  const EXPECTED_DISTRIBUTION = {
    "(빈칸)": 177, "굿띵투유": 47, "유머패밀리": 32, "동후작가": 25,
    "아택": 14, "루나앤코코": 11, "업크루": 6, "후마니": 1,
  };
  const companyByAccount = {
    "365hot": "굿띵투유", "365real": "굿띵투유", "anavocado12345": "동후작가",
    "chachapingzzal": "루나앤코코", "ddonutpingzzal": "루나앤코코", "eepyeong": "동후작가",
    "happingbox": "루나앤코코", "happypyeong": "동후작가", "ho1ytime": "동후작가",
    "humani3": "후마니", "humorphim": "업크루", "humorssul": "굿띵투유",
    "humoryonggari": "굿띵투유", "kutbba101": "굿띵투유", "laugh34": "굿띵투유",
    "lunahumor": "루나앤코코", "mamy014": "굿띵투유", "mukddoonge": "굿띵투유",
    "natozzal": "루나앤코코", "pangpangone": "굿띵투유", "pinkhumor25": "업크루",
    "sksk1sksk0": "굿띵투유", "smilehahas2": "아택", "smilekings2": "아택",
    "some2lve": "아택", "textpyeong": "동후작가", "timeholy": "굿띵투유",
    "todayquest": "굿띵투유", "treehumor": "루나앤코코", "tteokbokkizip": "루나앤코코",
    "twopyeong": "동후작가", "ufobrown": "유머패밀리", "ufogray": "유머패밀리",
    "ufogreen": "유머패밀리", "ufonavy": "유머패밀리", "ufonight": "유머패밀리",
    "ufoorange": "유머패밀리", "ufopink": "유머패밀리", "ufopurple": "유머패밀리",
    "uforainbow": "유머패밀리", "ufored": "유머패밀리", "ufoskyblue": "유머패밀리",
    "ufowhite": "유머패밀리", "ufoyellow": "유머패밀리", "yesjam": "굿띵투유",
    "zzalqueen": "업크루",
  };
  const normalize = value => String(value == null ? "" : value).trim();
  const canon = value => normalize(value).toLowerCase().replace(/[\s._·-]/g, "");
  const sha256Hex = value => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(byte => (byte + 256) % 256)
    .map(byte => ("0" + byte.toString(16)).slice(-2))
    .join("");
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  if (fieldCols.company_name !== 14 || !fieldCols.account_name || !fieldCols.url) {
    throw new Error("업체명 복구 대상 열 구성이 달라졌습니다.");
  }
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, 14).getValues();
  const rows = [];
  const distribution = {};
  const approvedCandidatesByKey = {};
  const ignoredCandidates = [];
  values.forEach((row, index) => {
    const sheetRow = CONFIG.DATA_START_ROW + index;
    const account = normalize(row[fieldCols.account_name - 1]);
    const company = normalize(row[fieldCols.company_name - 1]);
    const accountKey = canon(account);
    if (!company || canon(company) !== accountKey) return;
    const url = normalize(row[fieldCols.url - 1]);
    const key = companyPollutionRepairKey20260818_(url, account);
    if (!key) throw new Error(`업체명 오적재 후보의 URL이 올바르지 않습니다. url=${url}`);
    if (!APPROVED_KEY_HASHES[sha256Hex(key).slice(0, 16)]) {
      ignoredCandidates.push({ row: sheetRow, url: url, account_name: account, company_name: company, key: key });
      return;
    }
    const nextCompany = companyByAccount[accountKey] || null;
    const candidate = { row: sheetRow, repair_key: key, url: url, account_name: account, old_company: company, new_company: nextCompany };
    if (!approvedCandidatesByKey[key]) approvedCandidatesByKey[key] = [];
    approvedCandidatesByKey[key].push(candidate);
    if (approvedCandidatesByKey[key].length > 1) return;
    rows.push(candidate);
    const label = nextCompany || "(빈칸)";
    distribution[label] = (distribution[label] || 0) + 1;
  });
  const duplicateApprovedKeys = Object.keys(approvedCandidatesByKey)
    .filter(key => approvedCandidatesByKey[key].length > 1)
    .map(key => ({ key: key, rows: approvedCandidatesByKey[key] }));
  const matchedApprovedHashes = Object.keys(approvedCandidatesByKey).reduce((set, key) => {
    set[sha256Hex(key).slice(0, 16)] = true;
    return set;
  }, {});
  const approvedHashes = Object.keys(APPROVED_KEY_HASHES);
  const missingApprovedHashes = approvedHashes.filter(hash => !matchedApprovedHashes[hash]);
  Logger.log("COMPANY_REPAIR_DIAGNOSTIC " + JSON.stringify({
    approved_rows: rows.length,
    approved_unique_keys: Object.keys(approvedCandidatesByKey).length,
    duplicate_approved_keys: duplicateApprovedKeys,
    missing_approved_hashes: missingApprovedHashes,
    ignored_candidates: ignoredCandidates,
  }));
  if (rows.length !== EXPECTED_COUNT) throw new Error(`업체명 오적재 후보가 ${EXPECTED_COUNT}행이 아닙니다. actual=${rows.length}`);
  if (approvedHashes.length !== EXPECTED_COUNT || Object.keys(approvedCandidatesByKey).length !== EXPECTED_COUNT || missingApprovedHashes.length) {
    throw new Error(`업체명 오적재 승인 키 집합이 다릅니다. approved=${approvedHashes.length}, matched=${Object.keys(approvedCandidatesByKey).length}, missing=${missingApprovedHashes.length}`);
  }
  const labels = Object.keys(EXPECTED_DISTRIBUTION);
  if (Object.keys(distribution).length !== labels.length || labels.some(label => distribution[label] !== EXPECTED_DISTRIBUTION[label])) {
    throw new Error(`업체명 복구 분포가 승인본과 다릅니다. ${JSON.stringify(distribution)}`);
  }
  Logger.log("COMPANY_REPAIR_APPROVED_SET " + JSON.stringify({ approved: rows.length, ignored_candidates: ignoredCandidates.length }));
  return rows;
}

function repairCompanyPollution20260818DryRun() {
  const result = repairCompanyPollution20260818({
    signature: "company-pollution-2026-08-18",
    apply: false,
    rows: companyPollutionSource20260818_(),
  });
  Logger.log("COMPANY_REPAIR_DRY_RUN " + JSON.stringify(result));
  return result;
}

function repairCompanyPollution20260818Apply() {
  const result = repairCompanyPollution20260818({
    signature: "company-pollution-2026-08-18",
    apply: true,
    rows: companyPollutionSource20260818_(),
  });
  Logger.log("COMPANY_REPAIR_APPLY " + JSON.stringify(result));
  return result;
}

function companyPollutionBackupRows20260818_() {
  const EXPECTED_COUNT = 313;
  const SIGNATURE = "company-pollution-2026-08-18";
  const backup = getSheet_().getParent().getSheetByName("_codex_company_backup_20260818");
  if (!backup || backup.getLastRow() !== EXPECTED_COUNT + 1) {
    throw new Error("업체명 복구 백업 탭이 없거나 행 수가 다릅니다.");
  }
  const values = backup.getRange(1, 1, EXPECTED_COUNT + 1, 6).getValues();
  if (String(values[0][0] || "").trim() !== SIGNATURE) throw new Error("업체명 복구 백업 마커가 다릅니다.");
  const rows = values.slice(1).map(row => ({
    sheet_row: Number(row[1]),
    url: String(row[2] || "").trim(),
    account_name: String(row[3] || "").trim(),
    old_company: String(row[4] || "").trim() || null,
    new_company: String(row[5] || "").trim() || null,
  }));
  if (rows.some(row => !row.sheet_row || !row.url || !row.account_name || !row.old_company)) {
    throw new Error("업체명 복구 백업에 필수값이 비어 있습니다.");
  }
  const keys = {};
  rows.forEach(row => {
    const key = companyPollutionRepairKey20260818_(row.url, row.account_name);
    if (!key || keys[key]) throw new Error(`업체명 복구 백업 키가 없거나 중복입니다. key=${key}`);
    keys[key] = true;
  });
  return rows;
}

function syncCompanyPollutionBackupToDb20260818() {
  const rows = companyPollutionBackupRows20260818_();
  const result = postRows_(rows.map(row => ({
    url: row.url,
    account_name: row.account_name,
    company_name: row.new_company,
  })));
  Logger.log("COMPANY_REPAIR_DB_SYNC " + JSON.stringify({ requested: rows.length, result: result }));
  return result;
}

function auditCompanyPollutionDb20260818() {
  const expectedRows = companyPollutionBackupRows20260818_();
  const res = UrlFetchApp.fetch(CONFIG.LIST_API_URL, {
    method: "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error(`API ${res.getResponseCode()}: ${res.getContentText()}`);
  const posts = (JSON.parse(res.getContentText()).posts) || [];
  const byKey = {};
  posts.forEach(post => {
    const key = companyPollutionRepairKey20260818_(post.url, post.account_name);
    if (key) byKey[key] = post;
  });
  const mismatches = expectedRows.filter(row => {
    const post = byKey[companyPollutionRepairKey20260818_(row.url, row.account_name)];
    return !post || String(post.company_name || "").trim() !== String(row.new_company || "").trim();
  });
  const result = { ok: mismatches.length === 0, checked: expectedRows.length, mismatches: mismatches.slice(0, 20) };
  Logger.log("COMPANY_REPAIR_DB_AUDIT " + JSON.stringify(result));
  if (!result.ok) throw new Error(`업체명 DB 정합 불일치 ${mismatches.length}건`);
  return result;
}

// 2026-08-18 업체명=계정명 오적재 313행 일회성 복구.
// Script Execution API에서만 호출하며, 대상 수·열·URL·현재값을 전부 확인한 뒤 N열만 수정한다.
function repairCompanyPollution20260818(payload) {
  const SIGNATURE = "company-pollution-2026-08-18";
  const EXPECTED_COUNT = 313;
  const EXPECTED_SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
  const EXPECTED_COMPANY_COL = 14; // N
  const BACKUP_SHEET_NAME = "_codex_company_backup_20260818";
  const normalizeText = value => String(value == null ? "" : value).trim();
  const canonAccount = value => normalizeText(value).toLowerCase().replace(/[\s._·-]/g, "");
  const sameNullable = (left, right) => normalizeText(left) === normalizeText(right);

  if (!payload || payload.signature !== SIGNATURE) throw new Error("업체명 복구 서명이 올바르지 않습니다.");
  if (!Array.isArray(payload.rows) || payload.rows.length !== EXPECTED_COUNT) {
    throw new Error(`업체명 복구 대상은 정확히 ${EXPECTED_COUNT}행이어야 합니다.`);
  }
  if (payload.apply !== true && payload.apply !== false) throw new Error("apply는 true/false여야 합니다.");

  const sourceKeys = {};
  payload.rows.forEach((item, index) => {
    const key = item && item.repair_key || companyPollutionRepairKey20260818_(item && item.url, item && item.account_name);
    if (!key) throw new Error(`복구 소스 URL이 올바르지 않습니다. index=${index}`);
    if (sourceKeys[key]) throw new Error(`복구 소스 URL 키가 중복입니다. key=${key}`);
    sourceKeys[key] = item;
  });

  const sheet = getSheet_();
  if (sheet.getParent().getId() !== EXPECTED_SHEET_ID) throw new Error("복구 대상 스프레드시트가 아닙니다.");
  const fieldCols = buildFieldCols_(sheet);
  if (fieldCols.company_name !== EXPECTED_COMPANY_COL) {
    throw new Error(`업체명 열이 N열이 아닙니다. actual=${fieldCols.company_name}`);
  }
  if (!fieldCols.account_name || !fieldCols.url) throw new Error("채널명/게시물URL 헤더가 없습니다.");

  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, EXPECTED_COMPANY_COL).getValues();
  const sheetRowsByKey = {};
  values.forEach((row, index) => {
    const key = companyPollutionRepairKey20260818_(row[fieldCols.url - 1], row[fieldCols.account_name - 1]);
    if (!key || !sourceKeys[key]) return;
    if (!sheetRowsByKey[key]) sheetRowsByKey[key] = [];
    sheetRowsByKey[key].push({
      row: CONFIG.DATA_START_ROW + index,
      url: normalizeText(row[fieldCols.url - 1]),
      account_name: normalizeText(row[fieldCols.account_name - 1]),
      company_name: normalizeText(row[EXPECTED_COMPANY_COL - 1]),
    });
  });

  const matched = [];
  const edits = [];
  const distribution = {};
  payload.rows.forEach(item => {
    const key = item.repair_key || companyPollutionRepairKey20260818_(item.url, item.account_name);
    const matches = sheetRowsByKey[key] || [];
    const current = Number.isInteger(item.row)
      ? matches.find(match => match.row === item.row)
      : (matches.length === 1 ? matches[0] : null);
    if (!current) throw new Error(`시트 URL·행 매칭이 유일하지 않습니다. key=${key}, row=${item.row || "없음"}, count=${matches.length}`);
    if (canonAccount(current.account_name) !== canonAccount(item.account_name)) {
      throw new Error(`시트 채널명이 소스와 다릅니다. row=${current.row}, key=${key}`);
    }
    if (!sameNullable(current.company_name, item.old_company) && !sameNullable(current.company_name, item.new_company)) {
      throw new Error(`시트 업체명이 예상 범위를 벗어났습니다. row=${current.row}, key=${key}`);
    }
    const nextCompany = normalizeText(item.new_company);
    matched.push({
      key: key,
      row: current.row,
      url: current.url,
      account_name: current.account_name,
      old_company: current.company_name,
      new_company: nextCompany,
    });
    if (!sameNullable(current.company_name, nextCompany)) edits.push({ row: current.row, value: nextCompany });
    const label = nextCompany || "(빈칸)";
    distribution[label] = (distribution[label] || 0) + 1;
  });

  if (matched.length !== EXPECTED_COUNT) throw new Error(`시트 매칭 수가 ${EXPECTED_COUNT}행이 아닙니다.`);
  const result = {
    ok: true,
    mode: payload.apply ? "apply" : "dry-run",
    matched: matched.length,
    changes: edits.length,
    distribution: distribution,
    company_column: "N",
  };
  if (!payload.apply) return result;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    assertRowCountStable_(sheet, lastRow, "repairCompanyPollution20260818");
    const lockedValues = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, EXPECTED_COMPANY_COL).getValues();
    matched.forEach(item => {
      const lockedRow = lockedValues[item.row - CONFIG.DATA_START_ROW];
      if (companyPollutionRepairKey20260818_(lockedRow[fieldCols.url - 1], lockedRow[fieldCols.account_name - 1]) !== item.key) {
        throw new Error(`실행 중 행 순서가 바뀌어 중단했습니다. row=${item.row}`);
      }
      if (canonAccount(lockedRow[fieldCols.account_name - 1]) !== canonAccount(item.account_name)) {
        throw new Error(`실행 중 채널명이 바뀌어 중단했습니다. row=${item.row}`);
      }
      const lockedCompany = lockedRow[EXPECTED_COMPANY_COL - 1];
      if (!sameNullable(lockedCompany, item.old_company) && !sameNullable(lockedCompany, item.new_company)) {
        throw new Error(`실행 중 업체명이 바뀌어 중단했습니다. row=${item.row}`);
      }
    });
    const ss = sheet.getParent();
    let backup = ss.getSheetByName(BACKUP_SHEET_NAME);
    const backupHeader = ["backup_marker", "sheet_row", "url", "account_name", "old_company", "new_company"];
    if (!backup) {
      backup = ss.insertSheet(BACKUP_SHEET_NAME);
      const backupValues = [[SIGNATURE].concat(backupHeader.slice(1))]
        .concat(matched.map(item => [SIGNATURE, item.row, item.url, item.account_name, item.old_company, item.new_company]));
      backup.getRange(1, 1, backupValues.length, backupHeader.length).setValues(backupValues);
      backup.hideSheet();
    } else {
      const marker = normalizeText(backup.getRange(1, 1).getValue());
      if (marker !== SIGNATURE || backup.getLastRow() !== EXPECTED_COUNT + 1) {
        throw new Error("기존 업체명 복구 백업 탭이 예상 형식과 다릅니다.");
      }
    }

    result.written = writeColumnRuns_(sheet, EXPECTED_COMPANY_COL, edits, lastRow);
    SpreadsheetApp.flush();
    const verifyValues = sheet.getRange(CONFIG.DATA_START_ROW, EXPECTED_COMPANY_COL, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
    let verified = 0;
    matched.forEach(item => {
      const actual = verifyValues[item.row - CONFIG.DATA_START_ROW][0];
      if (!sameNullable(actual, item.new_company)) throw new Error(`업체명 쓰기 검증 실패 row=${item.row}`);
      verified++;
    });
    result.verified = verified;
    result.backup_sheet = BACKUP_SHEET_NAME;
    return result;
  } finally {
    lock.releaseLock();
  }
}

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

function assertRowCountStable_(sheet, expectedLastRow, label) {
  const actualLastRow = sheet.getLastRow();
  if (actualLastRow !== expectedLastRow) {
    throw new Error(`${label}: 실행 중 행 수가 ${expectedLastRow} → ${actualLastRow}로 변경되어 중단했습니다.`);
  }
}

function countColumnRuns_(edits) {
  if (!edits || edits.length === 0) return 0;
  const sorted = edits.slice().sort((a, b) => a.row - b.row);
  let runs = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].row !== sorted[i - 1].row + 1) runs++;
  }
  return runs;
}

function writeColumnRuns_(sheet, col, edits, expectedLastRow) {
  if (!edits || edits.length === 0) return 0;
  const sorted = edits.slice().sort((a, b) => a.row - b.row);
  const stableLastRow = expectedLastRow == null ? sheet.getLastRow() : expectedLastRow;
  let written = 0;
  let startRow = sorted[0].row;
  let values = [[sorted[0].value]];
  for (let i = 1; i < sorted.length; i++) {
    const edit = sorted[i];
    if (edit.row === startRow + values.length) {
      values.push([edit.value]);
      continue;
    }
    assertRowCountStable_(sheet, stableLastRow, "writeColumnRuns");
    sheet.getRange(startRow, col, values.length, 1).setValues(values);
    written += values.length;
    startRow = edit.row;
    values = [[edit.value]];
  }
  assertRowCountStable_(sheet, stableLastRow, "writeColumnRuns");
  sheet.getRange(startRow, col, values.length, 1).setValues(values);
  return written + values.length;
}

function metricDateColumns_(sheet) {
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cols = [];
  let year = CONFIG.STATS_START_YEAR;
  let prevMonth = null;
  for (let col = CONFIG.STATS_FIRST_COL; col <= headers.length; col++) {
    const md = parseMonthDay_(headers[col - 1]);
    if (!md) continue;
    if (prevMonth !== null && md.mo < prevMonth) year++;
    prevMonth = md.mo;
    const date = year + "-" + ("0" + md.mo).slice(-2) + "-" + ("0" + md.da).slice(-2);
    cols.push({ col: col, date: date, day: new Date(date + "T00:00:00+09:00").getDay() });
  }
  return cols;
}

function metricCumulativeFormula_(row, firstLetter, lastLetter) {
  return "=IF(COUNT(" + firstLetter + row + ":" + lastLetter + row + ")=0,\"\",MAX(" + firstLetter + row + ":" + lastLetter + row + "))";
}

function metricIncrementFormula_(row, firstLetter, lastLetter) {
  const rangeRef = "$" + firstLetter + row + ":$" + lastLetter + row;
  const firstCellRef = "$" + firstLetter + row;
  return "=IFERROR(LET(rng," + rangeRef
    + ",cols,SEQUENCE(1,COLUMNS(rng),COLUMN(" + firstCellRef + "),1)"
    + ",lastC,MAX(FILTER(cols,rng>0))"
    + ",lastV,INDEX(rng,1,lastC-COLUMN(" + firstCellRef + ")+1)"
    + ",prev,FILTER(rng,cols<lastC,rng>0)"
    + ',IFERROR(MAX(0,lastV-MAX(prev)),lastV)),"")';
}

function metricFormulaText_(formula) {
  return String(formula || "").replace(/\s+/g, "").toUpperCase();
}

function metricColumnNumber_(letter) {
  const text = String(letter || "").toUpperCase();
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 65 || code > 90) return 0;
    col = col * 26 + code - 64;
  }
  return col;
}

function standardCumulativeFormulaEnd_(formula, row, firstLetter) {
  const text = metricFormulaText_(formula);
  const prefix = new RegExp(
    "^=IF\\(COUNT\\(" + firstLetter + row + ":([A-Z]+)" + row + "\\)=0,"
  );
  const match = text.match(prefix);
  if (!match) return "";
  const endLetter = match[1];
  return text === metricFormulaText_(metricCumulativeFormula_(row, firstLetter, endLetter))
    ? endLetter
    : "";
}

function standardIncrementFormulaEnd_(formula, row, firstLetter) {
  const text = metricFormulaText_(formula);
  const prefix = new RegExp(
    "^=IFERROR\\(LET\\(RNG,\\$" + firstLetter + row + ":\\$([A-Z]+)" + row + ","
  );
  const match = text.match(prefix);
  if (!match) return "";
  const endLetter = match[1];
  return text === metricFormulaText_(metricIncrementFormula_(row, firstLetter, endLetter))
    ? endLetter
    : "";
}

// 수동으로 우측 날짜열을 삽입하면 기존 행의 명시적 끝열은 자동 확장되지 않는다.
// 표준 H/I 수식만 최신 날짜열로 늘리고, 수기값·종료 최종값·백로그(="")·미러링 수식은 보존한다.
function repairStaleMetricFormulaRanges_(sheet) {
  const targetSheet = sheet || getSheet_();
  const dateCols = metricDateColumns_(targetSheet);
  const lastRow = targetSheet.getLastRow();
  const result = {
    rows: Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1),
    first_col: null,
    last_col: null,
    cumulative: 0,
    increment: 0,
  };
  if (!dateCols.length || result.rows === 0) return result;

  const firstCol = Math.min.apply(null, dateCols.map(function(item) { return item.col; }));
  const lastCol = Math.max.apply(null, dateCols.map(function(item) { return item.col; }));
  const firstLetter = colLetter_(firstCol);
  const lastLetter = colLetter_(lastCol);
  const cumulativeCol = findHeaderCol_(targetSheet, ["누적 조회수", "누적조회수"]);
  const incrementCol = getIncrementCol_(targetSheet);
  result.first_col = firstLetter;
  result.last_col = lastLetter;

  const cumulativeEdits = [];
  if (cumulativeCol) {
    const formulas = targetSheet.getRange(CONFIG.DATA_START_ROW, cumulativeCol, result.rows, 1).getFormulas();
    for (let i = 0; i < result.rows; i++) {
      const row = CONFIG.DATA_START_ROW + i;
      const currentEnd = standardCumulativeFormulaEnd_(formulas[i][0], row, firstLetter);
      if (currentEnd && metricColumnNumber_(currentEnd) < lastCol) {
        cumulativeEdits.push({ row: row, value: metricCumulativeFormula_(row, firstLetter, lastLetter) });
      }
    }
  }

  const incrementEdits = [];
  if (incrementCol) {
    const formulas = targetSheet.getRange(CONFIG.DATA_START_ROW, incrementCol, result.rows, 1).getFormulas();
    for (let i = 0; i < result.rows; i++) {
      const row = CONFIG.DATA_START_ROW + i;
      const currentEnd = standardIncrementFormulaEnd_(formulas[i][0], row, firstLetter);
      if (currentEnd && metricColumnNumber_(currentEnd) < lastCol) {
        incrementEdits.push({ row: row, value: metricIncrementFormula_(row, firstLetter, lastLetter) });
      }
    }
  }

  result.cumulative = cumulativeCol
    ? writeColumnRuns_(targetSheet, cumulativeCol, cumulativeEdits, lastRow)
    : 0;
  result.increment = incrementCol
    ? writeColumnRuns_(targetSheet, incrementCol, incrementEdits, lastRow)
    : 0;
  if (result.cumulative || result.increment) SpreadsheetApp.flush();
  Logger.log("metric_formula_range_repair " + JSON.stringify(result));
  return result;
}

function ensureNewRowsMetricFormulas_(sheet, startRow, endRow) {
  if (!sheet || startRow > endRow) return { cumulative: 0, increment: 0 };
  const dateCols = metricDateColumns_(sheet);
  if (!dateCols.length) return { cumulative: 0, increment: 0 };
  const firstCol = Math.min.apply(null, dateCols.map(x => x.col));
  const lastCol = Math.max.apply(null, dateCols.map(x => x.col));
  const firstLetter = colLetter_(firstCol);
  const lastLetter = colLetter_(lastCol);
  const cumulativeCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  const incrementCol = getIncrementCol_(sheet);
  let cumulative = 0, increment = 0;
  for (let row = startRow; row <= endRow; row++) {
    if (cumulativeCol) {
      const cell = sheet.getRange(row, cumulativeCol);
      if (!cell.getFormula() && String(cell.getValue() == null ? "" : cell.getValue()).trim() === "") {
        cell.setFormula("=IF(COUNT(" + firstLetter + row + ":" + lastLetter + row + ")=0,\"\",MAX(" + firstLetter + row + ":" + lastLetter + row + "))");
        cumulative++;
      }
    }
    if (incrementCol) {
      const cell = sheet.getRange(row, incrementCol);
      if (!cell.getFormula() && String(cell.getValue() == null ? "" : cell.getValue()).trim() === "") {
        const rangeRef = "$" + firstLetter + row + ":$" + lastLetter + row;
        const firstRef = "$" + firstLetter + row;
        cell.setFormula(
          "=IFERROR(LET(rng," + rangeRef +
          ",cols,SEQUENCE(1,COLUMNS(rng),COLUMN(" + firstRef + "),1)" +
          ",lastC,MAX(FILTER(cols,rng>0))" +
          ",lastV,INDEX(rng,1,lastC-COLUMN(" + firstRef + ")+1)" +
          ",prev,FILTER(rng,cols<lastC,rng>0)" +
          ",IFERROR(MAX(0,lastV-MAX(prev)),lastV)),\"\")"
        );
        increment++;
      }
    }
  }
  SpreadsheetApp.flush();
  const result = { start_row: startRow, end_row: endRow, cumulative: cumulative, increment: increment };
  Logger.log("new_row_metric_formulas " + JSON.stringify(result));
  return result;
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
        const key = u ? linkKey_(u) : "";
        if (key) rowByKey[key] = CONFIG.DATA_START_ROW + i;   // shortcode/영상ID 기준 — /p/·/reel/ 등 경로만 달라도 같은 글로 인식
      });
    }

    // 채울 필드(시트에 해당 헤더가 있는 것만)
    const fillFields = ["posted_at", "account_name", "company_name", "content_summary", "asset_name", "channel_type", "project_name", "product_name", "planner", "creator", "cost"];

    // 성능(2026-07-24): 셀단위 getValue 반복(≈행수×필드수 왕복)이 30분 실행한도를 초과시켜 dailyAuto가 타임아웃되던 문제.
    // 데이터 블록을 1회만 읽어 메모리에서 빈칸 판정한다. 쓰기는 기존대로 빈 셀만 개별 setValue(수식·조회수 열 보존).
    const _pfN = (lastRow >= CONFIG.DATA_START_ROW) ? (lastRow - CONFIG.DATA_START_ROW + 1) : 0;
    const _pfBlock = _pfN > 0 ? sheet.getRange(CONFIG.DATA_START_ROW, 1, _pfN, sheet.getLastColumn()).getValues() : [];

    let added = 0, filled = 0, rejectedInvalid = 0;
    const pendingRows = [];
    const pendingKeys = {};
    // 기존 행 빈칸 채움을 모아 열 단위로 1회씩 쓴다(개별 setValue 왕복 제거).
    const fillEdits = [];
    const lastCol = sheet.getLastColumn();
    posts.forEach(p => {
      const rawUrl = String(p.url || "").trim();
      // shortcode 없는 IG 프로필 URL은 append 안 함 — 시트↔DB 재추가 루프 방지(2026-08-25 one_star_video 사고).
      if (isInvalidTikTokPostUrl_(rawUrl) || (/instagram\.com/i.test(rawUrl) && !/\/(p|reels|reel|tv)\/[A-Za-z0-9_-]+/i.test(rawUrl))) { rejectedInvalid++; return; }
      const key = linkKey_(rawUrl);   // 시트 인덱스와 동일 기준 — DB /p/ ↔ 시트 /reel/ 매칭되어 재추가 안 됨
      if (!key || pendingKeys[key]) return;
      if (rowByKey[key]) {
        // 기존 행 — 빈 칸만 DB값으로 채움(수동 편집 보존)
        const rowNum = rowByKey[key];
        fillFields.forEach(f => {
          if (!fieldCols[f]) return;
          const val = fmtVal_(f, p[f]);
          if (val === "") return;
          const _pfBi = rowNum - CONFIG.DATA_START_ROW, _pfCi = fieldCols[f] - 1;
          if (_pfBi < 0 || _pfBi >= _pfBlock.length) return;
          const _pfCur = _pfBlock[_pfBi][_pfCi];
          if (String(_pfCur == null ? "" : _pfCur).trim() !== "") return;
          // 🚨 2026-08-26 WATCHDOG_TIMEOUT 재발방지: 빈 칸마다 setValue()를 부르면
          //    시트 성장에 따라 왕복이 선형 증가해 20~30분 한도를 넘긴다(3,216행 × 11필드).
          //    여기서는 메모리 블록만 갱신하고, 실제 쓰기는 아래에서 **열 단위 1회**로 모은다.
          _pfBlock[_pfBi][_pfCi] = val;
          fillEdits.push({ col: fieldCols[f], row: rowNum, value: val });
          filled++;
        });
      } else {
        // 신규 글은 URL→메타를 셀별로 쓰지 않고 한 행 전체를 원자적으로 기록한다.
        // 중간 실패/동시 정렬로 URL만 사라지고 날짜값만 남는 고아 행을 만들지 않는다.
        const newRow = Array(lastCol).fill("");
        newRow[urlCol - 1] = rawUrl;
        fillFields.forEach(f => {
          if (!fieldCols[f]) return;
          const val = fmtVal_(f, p[f]);
          if (val !== "") newRow[fieldCols[f] - 1] = val;
        });
        pendingRows.push({ key: key, url: rawUrl, values: newRow });
        pendingKeys[key] = true;
      }
    });

    // 모아둔 기존 행 빈칸 채움을 **열 단위로 1회씩** 쓴다.
    // 개별 setValue()는 시트가 커질수록 왕복이 선형 증가해 Apps Script 실행 한도를 넘겼다
    // (2026-08-26 WATCHDOG_TIMEOUT: 3,216행 × fillFields 11개 → 최악 3.5만 회 왕복).
    // writeColumnRuns_는 연속 구간을 묶어 쓰고 행 수 안정성까지 검증한다(고아 행 방지).
    if (fillEdits.length > 0) {
      const byCol = {};
      fillEdits.forEach(e => { (byCol[e.col] = byCol[e.col] || []).push(e); });
      Object.keys(byCol).forEach(col => {
        writeColumnRuns_(sheet, Number(col), byCol[col], lastRow);
      });
    }

    if (pendingRows.length > 0) {
      assertRowCountStable_(sheet, lastRow, "pullFromDB append");
      const startRow = lastRow + 1;
      const appendRange = sheet.getRange(startRow, 1, pendingRows.length, lastCol);
      appendRange.setValues(pendingRows.map(x => x.values));
      SpreadsheetApp.flush();

      // 쓰기 직후 URL-key를 다시 확인한다. 하나라도 어긋나면 방금 쓴 범위를 지우고 실패 처리해
      // 메타와 조회수의 행 분리를 차단한다(문서락 안에서 실행돼 다른 쓰기와 섞이지 않음).
      const writtenUrls = sheet.getRange(startRow, urlCol, pendingRows.length, 1).getValues();
      const mismatches = [];
      for (let i = 0; i < pendingRows.length; i++) {
        if (linkKey_(String(writtenUrls[i][0] || "")) !== pendingRows[i].key) mismatches.push(startRow + i);
      }
      if (mismatches.length > 0) {
        appendRange.clearContent();
        throw new Error("pullFromDB 신규 행 URL 검증 실패 — 롤백 행: " + mismatches.join(", "));
      }
      added = pendingRows.length;
      ensureNewRowsMetricFormulas_(sheet, startRow, startRow + added - 1);
    }

    safeAlert_(`⬇️ DB→시트 반영 완료\n• 신규 행 추가: ${added}건\n• 기존 행 빈칸 채움: ${filled}건` +
      (rejectedInvalid ? `\n• 잘못된 TikTok ID 차단: ${rejectedInvalid}건` : ""));
    return true;
  } catch (e) {
    safeAlert_("❌ DB→시트 반영 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}

// 기존 URL 행만 DB 메타데이터로 보강한다. pullFromDB처럼 신규 행을 추가하지 않는다.
function fillExistingMetadataFromDB_(silent) {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const urlCol = fieldCols.url;
    if (!urlCol) throw new Error("게시글URL 열을 찾을 수 없습니다.");

    const lastRow = sheet.getLastRow();
    const n = (lastRow >= CONFIG.DATA_START_ROW) ? (lastRow - CONFIG.DATA_START_ROW + 1) : 0;
    if (n <= 0) return true;

    const res = UrlFetchApp.fetch(CONFIG.LIST_API_URL, {
      method: "get",
      headers: authHeaders_(),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error(`API ${res.getResponseCode()}: ${res.getContentText()}`);
    const posts = (JSON.parse(res.getContentText()).posts) || [];
    const postByKey = {};
    posts.forEach(p => {
      const key = linkKey_(String(p.url || ""));
      if (key) postByKey[key] = p;
    });

    const fillFields = ["account_name", "company_name", "cost"];
    const data = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, sheet.getLastColumn()).getValues();
    const formulasByField = {};
    fillFields.forEach(f => {
      if (fieldCols[f]) {
        formulasByField[f] = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols[f], n, 1).getFormulas();
      }
    });

    const editsByField = {};
    fillFields.forEach(f => editsByField[f] = []);
    const blankDbByField = {};
    fillFields.forEach(f => blankDbByField[f] = 0);
    let matchedRows = 0, missingPostRows = 0;
    const missingSamples = [], blankSamples = [];

    for (let i = 0; i < n; i++) {
      const key = linkKey_(String(data[i][urlCol - 1] || ""));
      const post = key ? postByKey[key] : null;
      if (!post) {
        if (key) {
          missingPostRows++;
          if (missingSamples.length < 5) missingSamples.push(String(data[i][urlCol - 1] || ""));
        }
        continue;
      }
      matchedRows++;
      fillFields.forEach(f => {
        const col = fieldCols[f];
        if (!col) return;
        const val = fmtVal_(f, post[f]);
        const cur = data[i][col - 1];
        const hasFormula = formulasByField[f] && formulasByField[f][i] && formulasByField[f][i][0];
        if (hasFormula) return;
        if (String(cur == null ? "" : cur).trim() !== "") return;
        if (val === "") {
          blankDbByField[f]++;
          if (blankSamples.length < 5) blankSamples.push(`${f}: ${String(data[i][urlCol - 1] || "")}`);
          return;
        }
        editsByField[f].push({ row: CONFIG.DATA_START_ROW + i, value: val });
      });
    }

    assertRowCountStable_(sheet, lastRow, "fillExistingMetadataFromDB");
    const filledAccount = writeColumnRuns_(sheet, fieldCols.account_name, editsByField.account_name, lastRow);
    const filledCompany = writeColumnRuns_(sheet, fieldCols.company_name, editsByField.company_name, lastRow);
    const filledCost = writeColumnRuns_(sheet, fieldCols.cost, editsByField.cost, lastRow);
    Logger.log("fillExistingMetadataFromDB_result " + JSON.stringify({
      matched_rows: matchedRows,
      missing_post_rows: missingPostRows,
      account_name_cells: filledAccount,
      company_name_cells: filledCompany,
      cost_cells: filledCost,
      blank_db_account_name: blankDbByField.account_name,
      blank_db_company_name: blankDbByField.company_name,
      blank_db_cost: blankDbByField.cost,
      missing_samples: missingSamples,
      blank_samples: blankSamples,
    }));
    return true;
  } catch (e) {
    if (!silent) safeAlert_("❌ 기존 행 DB 메타데이터 보강 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}

function refreshSheetDerivedFields() {
  const steps = [
    ["채널명/DB 메타", function() { return fillExistingMetadataFromDB_(true); }],
    ["바이럴 채널명", function() { return overwriteViralHandles_(true); }],
    ["트래킹 상태", syncStatus],
    ["누적 조회수", refreshCumulativeViews],
    ["제작자", syncCreators],
    ["업체명/비용", syncPricing],
  ];
  const failed = [];
  steps.forEach(([name, fn]) => {
    const startedMs = Date.now();
    Logger.log("refreshSheetDerivedFields_step_start " + name);
    try {
      if (fn() === false) failed.push(name);
    } catch (e) {
      failed.push(name);
      Logger.log(`refreshSheetDerivedFields_${name}_error ` + (e.stack || e.message));
    } finally {
      Logger.log("refreshSheetDerivedFields_step_end " + JSON.stringify({
        name: name,
        duration_ms: Date.now() - startedMs,
        failed: failed.indexOf(name) >= 0,
      }));
    }
  });
  if (failed.length) {
    SpreadsheetApp.getActive().toast(`일부 업데이트 실패: ${failed.join(", ")}`, "확인 필요", 8);
  } else {
    SpreadsheetApp.getActive().toast("채널명, 트래킹 상태, 누적 조회수, 제작자, 업체명/비용 업데이트 완료", "완료", 5);
  }
}

// ═══════════════════════════════════════════════════════════════
// 바이럴 채널명 → DB 핸들 일괄 덮어쓰기 (시트에 잔존한 표시명 정정)
// ═══════════════════════════════════════════════════════════════
// 배경: pullFromDB는 '빈칸만' 채워서, 시트에 한 번 들어간 표시명(예: '유미패밀리 skyblue')을
//       DB 정본 핸들(예: 'ufo__skyblue')로 못 바꾼다. 이 함수는 그 잔존 표시명을 정정한다.
// 안전장치: ① '바이럴' 행만  ② 채널명(account_name) 열만  ③ DB값이 비면 유지(빈칸 덮어쓰기 금지)
//           ④ 동일하면 no-op  ⑤ 다른 열·수식·조회수·비바이럴 행 무손상(해당 열 1회 배치 되쓰기).
//   ※ DB가 정본이라 의도적 라벨(예: '신기+템(인스타)')은 DB에도 그대로 있어 그 값으로 유지된다.
function overwriteViralHandles_(silent) {
  try {
    const sheet = getSheet_();
    const fieldCols = buildFieldCols_(sheet);
    const accCol = fieldCols.account_name, typeCol = fieldCols.channel_type, urlCol = fieldCols.url;
    if (!accCol || !typeCol || !urlCol) throw new Error("채널명/채널분류/URL 열을 찾지 못함");

    const res = UrlFetchApp.fetch(CONFIG.LIST_API_URL, { method: "get", headers: authHeaders_(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error(`API ${res.getResponseCode()}: ${res.getContentText()}`);
    const posts = (JSON.parse(res.getContentText()).posts) || [];
    const handleByKey = {};
    posts.forEach(p => {
      const key = linkKey_(String(p.url || ""));
      const name = String(p.account_name || "").trim();
      if (key && name) handleByKey[key] = name;   // DB 정본 채널명
    });

    const lastRow = sheet.getLastRow();
    const n = (lastRow >= CONFIG.DATA_START_ROW) ? (lastRow - CONFIG.DATA_START_ROW + 1) : 0;
    if (n <= 0) { safeAlert_("데이터 행이 없습니다."); return true; }

    const urls  = sheet.getRange(CONFIG.DATA_START_ROW, urlCol,  n, 1).getValues();
    const types = sheet.getRange(CONFIG.DATA_START_ROW, typeCol, n, 1).getValues();
    const accs  = sheet.getRange(CONFIG.DATA_START_ROW, accCol,  n, 1).getValues();  // 이 배열만 수정 후 1회 되쓰기

    let changed = 0; const samples = [];
    for (let i = 0; i < n; i++) {
      if (String(types[i][0] || "").indexOf("바이럴") < 0) continue;   // 바이럴 행만
      const key = linkKey_(String(urls[i][0] || ""));
      if (!key) continue;
      const dbName = handleByKey[key];
      if (!dbName) continue;                       // DB에 값 없으면 유지(빈칸 덮어쓰기 금지)
      const cur = String(accs[i][0] || "").trim();
      if (cur === dbName) continue;                // 동일 → no-op
      if (samples.length < 15) samples.push(`'${cur}' → '${dbName}'`);
      accs[i][0] = dbName;                         // 메모리 배열만 수정(비바이럴/동일 행은 원값 유지)
      changed++;
    }
    if (changed > 0) sheet.getRange(CONFIG.DATA_START_ROW, accCol, n, 1).setValues(accs);
    if (!silent) {
      safeAlert_(`🔤 바이럴 채널명 → DB 핸들 정정 완료\n• 변경: ${changed}건\n${samples.join("\n")}`);
    }
    return true;
  } catch (e) {
    if (!silent) safeAlert_("❌ 바이럴 채널명 정정 오류\n" + e.message);
    Logger.log(e.stack || e.message);
    return false;
  }
}
function overwriteViralHandles() { return overwriteViralHandles_(false); }

function cleanAssetCaption_(raw) {
  return String(raw || "")
    .replace(/\s*\.디자인\s*\d*(?:\.[xX])?\s*$/, "")
    .replace(/\.(x|X)$/, "")
    .replace(/\.+\s*$/, "")
    .trim();
}

/**
 * 바이럴 소재명은 포맷 표식과 꼬리의 YYMMDD를 함께 확인해야만 캡션으로 인정한다.
 * 캡션 안에도 밑줄이 들어갈 수 있어 날짜에서 고정 칸 수를 빼는 방식은 쓰지 않는다.
 * 포맷을 확정할 수 없는 옛 바이럴 소재명은 추측하지 않고 빈 값으로 반환한다.
 */
function captionFromAssetName_(assetName, channelType) {
  const parts = String(assetName || "").split("_");
  const type = String(channelType || "");
  const isViral = type.indexOf("바이럴") >= 0;
  if (!isViral) return cleanAssetCaption_(parts[8] || "");

  var dateIdx = -1;
  for (var i = parts.length - 1; i >= 0; i--) {
    if (/^\d{6}$/.test(parts[i])) { dateIdx = i; break; }
  }
  if (dateIdx < 0) return "";

  const isBanner = type.indexOf("배너") >= 0;
  const markerRe = isBanner
    ? /(?:^|\.)배너(?:\.|$)/
    : /(?:^|\.)(?:렉카|릴스|숏츠|쇼츠|영상)(?:\.|$)/;
  var markerIdx = -1;
  for (var j = 0; j < dateIdx; j++) {
    if (markerRe.test(String(parts[j] || "").trim())) markerIdx = j;
  }
  if (markerIdx < 0) return "";

  var endExclusive = dateIdx - 1;
  if (!isBanner) {
    const productToken = String(parts[dateIdx - 2] || "").trim();
    if (!/^(?:\d+|파인트|스틱바)P$/.test(productToken)) return "";
    endExclusive = dateIdx - 2;
  }
  if (endExclusive <= markerIdx + 1) return "";

  const body = parts.slice(markerIdx + 1, endExclusive);
  while (body.length && String(body[body.length - 1] || "").trim() === "") body.pop();
  return cleanAssetCaption_(body.join("_"));
}

function fillCaptionFromAsset_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const assetCol = findHeaderCol_(sheet, ["소재명"]);
  const capCol = findHeaderCol_(sheet, ["캡션"]);
  const typeCol = findHeaderCol_(sheet, ["채널분류"]);
  if (!assetCol || !capCol || !typeCol) return true;

  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const assets = sheet.getRange(CONFIG.DATA_START_ROW, assetCol, n, 1).getValues();
  const caps = sheet.getRange(CONFIG.DATA_START_ROW, capCol, n, 1).getValues();
  const types = sheet.getRange(CONFIG.DATA_START_ROW, typeCol, n, 1).getValues();
  const edits = [];
  for (let i = 0; i < n; i++) {
    const currentCaption = String(caps[i][0] || "");
    const channelType = String(types[i][0] || "");
    const isViral = channelType.indexOf("바이럴") >= 0;

    if (isViral) {
      const desiredCaption = captionFromAssetName_(assets[i][0], channelType);
      // 사용자 확정(2026-08-24): Instagram 원문 스크랩이 확실한 해시태그 캡션은
      // 소재명 파생 캡션으로 전부 교체한다. 해시태그가 없는 기존 수기 캡션은 보존한다.
      const mayDerive = currentCaption.trim() === "" || currentCaption.indexOf("#") >= 0;
      if (mayDerive && desiredCaption && desiredCaption !== currentCaption) {
        edits.push({ row: CONFIG.DATA_START_ROW + i, value: desiredCaption });
      }
      continue;
    }

    if (currentCaption.trim() !== "") {
      // 라이브와 동일하게 기존 캡션도 파일명 버전 접미사만 자가치유한다.
      // 앞의 점(.)이 필수라 일반 문장 속 "디자인" 단어는 건드리지 않는다.
      // 줄바꿈 → 띄어쓰기 한 칸(2026-08-11): 스크랩 원문 캡션이 들어온 행은 셀이 여러 줄로 벌어진다.
      // 이 분기(캡션이 이미 차 있음)에 없으면 영원히 안 고쳐진다 — 아래 소재명 파생 분기는 빈 칸에만 돈다.
      const normalizedCaption = currentCaption
        .replace(/[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)+/g, " ")
        .replace(/\s*\.디자인\s*\d*\s*$/, "")
        .replace(/\.+\s*$/, "")
        .trim();
      if (normalizedCaption !== currentCaption) {
        edits.push({ row: CONFIG.DATA_START_ROW + i, value: normalizedCaption });
      }
      continue;
    }
    const caption = captionFromAssetName_(assets[i][0], channelType);
    if (caption) edits.push({ row: CONFIG.DATA_START_ROW + i, value: caption });
  }
  const written = writeColumnRuns_(sheet, capCol, edits, lastRow);
  Logger.log("caption_from_asset " + JSON.stringify({ changed: written }));
  return true;
}

// 캡션 열만 수동 재적용할 때 사용하는 공개 실행 진입점.
function backfillViralCaptionsFromAsset() {
  return withDocLock_(function() { return fillCaptionFromAsset_(); });
}

// 매일 자동: 시트→DB(전체 syncAll) + 시트 날짜값→DB(importStats) + DB→시트(대시보드 추가분 가져오기)를 함께 수행.
// syncNew(신규만)→syncAll 변경(2026-07-06): 기존 행의 시트 수정(업로드일 정정 등)이 DB로
// 전파되지 않아 시트·DB 게시일이 어긋나던 문제 해소(640행 7/2↔7/4 사례).
// 서버(bulk)가 '비어있지 않은 값만 덮기 + manual_fields 보존'이라 전체 재전송도 안전.
//
// 운영 관측:
// - 각 단계의 시작/종료/소요시간/오류를 Script Properties + 실행 로그에 남긴다.
// - importStats/exportStats만 실패 시 7분 뒤 실패 단계만 1회 재시도한다.
// - pullFromDB는 3시간 독립 트리거로 분리해 일일 작업 시간초과와 신규글 동기화 지연을 격리한다.
// - 재시도도 실패하면 더 예약하지 않고 오류를 남겨 무한 트리거 생성을 막는다.
const DAILY_AUTO_RETRY_DELAY_MS_ = 7 * 60 * 1000;
const DAILY_AUTO_RETRYABLE_STAGES_ = ["importStats"];
const EXPORT_STATS_GATE_RETRY_DELAY_MS_ = 15 * 60 * 1000;
const EXPORT_STATS_GATE_MAX_ATTEMPTS_ = 16; // 08:30 실행이 4시간가량 지연된 수집도 따라잡는다.
const EXPORT_STATS_GATE_PENDING_PROP_ = "EXPORT_STATS_COLLECTION_GATE_PENDING_JSON";

function shiftDateStr_(dateStr, days) {
  const parts = String(dateStr || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some(function(v) { return !isFinite(v); })) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0)));
  return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
}

function collectionTargetDate_() {
  return shiftDateStr_(todayStr_(), -1);
}

function fetchCollectionStatus_(targetDate, notify, reason) {
  const url = CONFIG.COLLECTION_STATUS_URL
    + "?target_date=" + encodeURIComponent(targetDate)
    + (reason ? "&reason=" + encodeURIComponent(reason) : "");
  const res = UrlFetchApp.fetch(url, {
    method: notify ? "post" : "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) throw new Error("collection-status API " + code + ": " + text.slice(0, 300));
  const data = JSON.parse(text);
  if (typeof data.completed !== "boolean") throw new Error("collection-status 응답에 completed가 없습니다.");
  return data;
}

function removeExportStatsGateTriggers_() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === "exportStatsAfterCollection_"; });
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  return triggers.length;
}

function clearExportStatsGatePending_() {
  removeExportStatsGateTriggers_();
  PropertiesService.getScriptProperties().deleteProperty(EXPORT_STATS_GATE_PENDING_PROP_);
}

function scheduleExportStatsAfterCollection_(targetDate, attempt, sourceStartedAt, reason) {
  const props = PropertiesService.getScriptProperties();
  removeExportStatsGateTriggers_();
  props.setProperty(EXPORT_STATS_GATE_PENDING_PROP_, JSON.stringify({
    target_date: targetDate,
    attempt: attempt,
    source_started_at: sourceStartedAt || new Date().toISOString(),
    scheduled_at: new Date().toISOString(),
    reason: String(reason || "collection_not_complete").slice(0, 300),
  }));
  props.setProperties({
    EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "DEFERRED",
    EXPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE: targetDate,
    EXPORT_STATS_COLLECTION_GATE_LAST_ATTEMPT: String(attempt),
    EXPORT_STATS_COLLECTION_GATE_LAST_REASON: String(reason || "collection_not_complete").slice(0, 500),
  }, false);
  ScriptApp.newTrigger("exportStatsAfterCollection_")
    .timeBased()
    .after(EXPORT_STATS_GATE_RETRY_DELAY_MS_)
    .create();
  Logger.log("exportStats_collection_gate_deferred " + JSON.stringify({
    target_date: targetDate,
    attempt: attempt,
    retry_after_ms: EXPORT_STATS_GATE_RETRY_DELAY_MS_,
    reason: reason,
  }));
  return true;
}

function notifyExportStatsGateTimeout_(targetDate, reason) {
  try {
    fetchCollectionStatus_(targetDate, true, reason); // POST는 미완료/반복실패를 Slack에 알린다.
  } catch (e) {
    Logger.log("exportStats_collection_gate_alert_error " + dailyAutoErrorText_(e));
  }
}

function runExportStatsCollectionGate_(source, pending) {
  const props = PropertiesService.getScriptProperties();
  const targetDate = (pending && pending.target_date) || collectionTargetDate_();
  const attempt = Number((pending && pending.attempt) || 0);
  const sourceStartedAt = (pending && pending.source_started_at) || new Date().toISOString();
  let status;
  try {
    status = fetchCollectionStatus_(targetDate, false);
  } catch (e) {
    const reason = "lookup_failed: " + dailyAutoErrorText_(e);
    if (attempt < EXPORT_STATS_GATE_MAX_ATTEMPTS_) {
      return scheduleExportStatsAfterCollection_(targetDate, attempt + 1, sourceStartedAt, reason);
    }
    clearExportStatsGatePending_();
    props.setProperties({
      EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "LOOKUP_TIMEOUT",
      EXPORT_STATS_COLLECTION_GATE_LAST_REASON: reason.slice(0, 500),
    }, false);
    notifyExportStatsGateTimeout_(targetDate, "gate_timeout");
    Logger.log("exportStats_collection_gate_timeout " + JSON.stringify({ target_date: targetDate, attempt: attempt, reason: reason }));
    return true; // 시트에 부분값을 쓰지 않고 사람 확인으로 넘긴다.
  }

  if (!status.completed) {
    const reason = "collection_not_complete";
    if (attempt < EXPORT_STATS_GATE_MAX_ATTEMPTS_) {
      return scheduleExportStatsAfterCollection_(targetDate, attempt + 1, sourceStartedAt, reason);
    }
    clearExportStatsGatePending_();
    props.setProperties({
      EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "COLLECTION_TIMEOUT",
      EXPORT_STATS_COLLECTION_GATE_LAST_REASON: reason,
    }, false);
    notifyExportStatsGateTimeout_(targetDate, "gate_timeout");
    Logger.log("exportStats_collection_gate_timeout " + JSON.stringify({ target_date: targetDate, attempt: attempt, reason: reason }));
    return true;
  }

  clearExportStatsGatePending_();
  let exported = false;
  try {
    exported = withDocLock_(function() {
      const ok = exportStats();
      if (ok === false) return false;
      repairStaleMetricFormulaRanges_(getSheet_());
      return true;
    });
  } catch (e) {
    const reason = "export_failed: " + dailyAutoErrorText_(e);
    if (attempt < EXPORT_STATS_GATE_MAX_ATTEMPTS_) {
      return scheduleExportStatsAfterCollection_(targetDate, attempt + 1, sourceStartedAt, reason);
    }
    props.setProperties({
      EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "EXPORT_ERROR",
      EXPORT_STATS_COLLECTION_GATE_LAST_REASON: reason.slice(0, 500),
    }, false);
    notifyExportStatsGateTimeout_(targetDate, "export_failed");
    Logger.log("exportStats_collection_gate_export_error " + JSON.stringify({ target_date: targetDate, attempt: attempt, reason: reason }));
    return true;
  }
  if (!exported) {
    const reason = "exportStats returned false";
    if (attempt < EXPORT_STATS_GATE_MAX_ATTEMPTS_) {
      return scheduleExportStatsAfterCollection_(targetDate, attempt + 1, sourceStartedAt, reason);
    }
    props.setProperties({
      EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "EXPORT_ERROR",
      EXPORT_STATS_COLLECTION_GATE_LAST_REASON: reason,
    }, false);
    notifyExportStatsGateTimeout_(targetDate, "export_failed");
    return true;
  }

  props.setProperties({
    EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "OK",
    EXPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE: targetDate,
    EXPORT_STATS_COLLECTION_GATE_LAST_ATTEMPT: String(attempt),
    EXPORT_STATS_COLLECTION_GATE_LAST_FINISHED_AT: new Date().toISOString(),
    EXPORT_STATS_COLLECTION_GATE_LAST_REASON: "collection_complete",
  }, false);
  Logger.log("exportStats_collection_gate_result " + JSON.stringify({
    status: "OK",
    source: source,
    target_date: targetDate,
    attempt: attempt,
    run: status.run || null,
  }));
  return true;
}

function exportStatsDailyGate_() {
  return runExportStatsCollectionGate_("dailyAuto", null);
}

function exportStatsAfterCollection_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(EXPORT_STATS_GATE_PENDING_PROP_);
  removeExportStatsGateTriggers_();
  if (!raw) {
    Logger.log("exportStats_collection_gate_skip: pending 없음");
    return true;
  }
  let pending;
  try {
    pending = JSON.parse(raw);
  } catch (e) {
    props.deleteProperty(EXPORT_STATS_GATE_PENDING_PROP_);
    throw new Error("exportStats collection gate payload 파싱 실패: " + e.message);
  }
  return withAutoWriteGuard_(function() {
    return runExportStatsCollectionGate_("collection_retry", pending);
  });
}

function dailyAutoErrorText_(e) {
  // Script Properties 단일 값 제한을 넘지 않도록 스택은 단계당 700자로 제한한다.
  return String((e && (e.stack || e.message)) || e).slice(0, 700);
}

function dailyAutoStageDefs_() {
  return [
    ["fillCaptionFromAsset", fillCaptionFromAsset_],
    ["syncAll", function() { return runSync_(false); }],
    ["syncPricing", syncPricing],
    ["importStats", function() { return importStats("daily_auto"); }],
    ["exportStats", exportStatsDailyGate_],
    ["syncStatus", syncStatus],
    ["refreshCumulativeViews", refreshCumulativeViews],
    ["repairMetricFormulaRanges", function() { return repairStaleMetricFormulaRanges_(getSheet_()); }],
    ["syncCreators", syncCreators],
    ["overwriteViralHandles", function() { return overwriteViralHandles_(true); }],
  ];
}

function runDailyAutoStage_(name, fn) {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  try {
    const result = fn();
    if (result === false) throw new Error(name + " returned false");
    const finishedMs = Date.now();
    const stage = {
      name: name,
      status: "OK",
      started_at: startedAt,
      finished_at: new Date(finishedMs).toISOString(),
      duration_ms: finishedMs - startedMs,
    };
    Logger.log("dailyAuto_stage " + JSON.stringify(stage));
    return stage;
  } catch (e) {
    const finishedMs = Date.now();
    const stage = {
      name: name,
      status: "ERROR",
      started_at: startedAt,
      finished_at: new Date(finishedMs).toISOString(),
      duration_ms: finishedMs - startedMs,
      error: dailyAutoErrorText_(e),
    };
    Logger.log("dailyAuto_stage " + JSON.stringify(stage));
    return stage;
  }
}

function removeDailyAutoRetryTriggers_() {
  const retryTriggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "dailyAutoRetry_");
  retryTriggers.forEach(t => ScriptApp.deleteTrigger(t));
  return retryTriggers.length;
}

function scheduleDailyAutoRetry_(failedStageNames, sourceStartedAt) {
  const retryable = DAILY_AUTO_RETRYABLE_STAGES_
    .filter(name => failedStageNames.indexOf(name) >= 0);
  const props = PropertiesService.getScriptProperties();
  removeDailyAutoRetryTriggers_();
  if (!retryable.length) {
    props.deleteProperty("DAILY_AUTO_RETRY_PENDING_JSON");
    return [];
  }
  props.setProperty("DAILY_AUTO_RETRY_PENDING_JSON", JSON.stringify({
    source_started_at: sourceStartedAt,
    stages: retryable,
    scheduled_at: new Date().toISOString(),
    attempt: 1,
  }));
  ScriptApp.newTrigger("dailyAutoRetry_")
    .timeBased()
    .after(DAILY_AUTO_RETRY_DELAY_MS_)
    .create();
  Logger.log("dailyAuto_retry_scheduled " + JSON.stringify(retryable));
  return retryable;
}

function dailyAutoRetry_() {
  return withAutoWriteGuard_(function() {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty("DAILY_AUTO_RETRY_PENDING_JSON");
    removeDailyAutoRetryTriggers_();
    props.deleteProperty("DAILY_AUTO_RETRY_PENDING_JSON");
    if (!raw) {
      Logger.log("dailyAuto_retry_skip: pending stages 없음");
      return true;
    }

    let pending;
    try {
      pending = JSON.parse(raw);
    } catch (e) {
      throw new Error("dailyAuto retry payload 파싱 실패: " + e.message);
    }
    const wanted = DAILY_AUTO_RETRYABLE_STAGES_
      .filter(name => (pending.stages || []).indexOf(name) >= 0);
    const defs = {};
    dailyAutoStageDefs_().forEach(pair => { defs[pair[0]] = pair[1]; });
    const startedAt = new Date().toISOString();
    const stages = wanted.map(name => runDailyAutoStage_(name, defs[name]));
    const errors = stages.filter(stage => stage.status !== "OK");
    const status = errors.length
      ? "ERROR: " + errors.map(stage => stage.name + ": " + stage.error).join(" | ")
      : "OK";
    props.setProperties({
      DAILY_AUTO_LAST_RETRY_STARTED_AT: startedAt,
      DAILY_AUTO_LAST_RETRY_FINISHED_AT: new Date().toISOString(),
      DAILY_AUTO_LAST_RETRY_STATUS: status,
      DAILY_AUTO_LAST_RETRY_STAGES_JSON: JSON.stringify(stages),
    }, false);
    Logger.log("dailyAuto_retry_result " + JSON.stringify({
      source_started_at: pending.source_started_at || null,
      status: status,
      stages: stages,
    }));
    if (errors.length) throw new Error(status);
    return true;
  });
}

function dailyAuto() {
  return withAutoWriteGuard_(function() {
    const props = PropertiesService.getScriptProperties();
    const startedAt = new Date().toISOString();
    props.setProperties({
      AUTO_SYNC_ENABLED: "true",
      DAILY_AUTO_LAST_STARTED_AT: startedAt,
      DAILY_AUTO_LAST_STATUS: "RUNNING",
    }, false);

    const stages = dailyAutoStageDefs_()
      .map(pair => runDailyAutoStage_(pair[0], pair[1]));
    const errors = stages.filter(stage => stage.status !== "OK");
    const failedNames = errors.map(stage => stage.name);
    let retryScheduled = [];
    try {
      retryScheduled = scheduleDailyAutoRetry_(failedNames, startedAt);
    } catch (e) {
      const retryScheduleStage = {
        name: "scheduleRetry",
        status: "ERROR",
        duration_ms: 0,
        error: dailyAutoErrorText_(e),
      };
      stages.push(retryScheduleStage);
      errors.push(retryScheduleStage);
      Logger.log("dailyAuto_retry_schedule_error " + JSON.stringify(retryScheduleStage));
    }
    const finishedAt = new Date().toISOString();
    const status = errors.length
      ? "ERROR: " + errors.map(stage => stage.name + ": " + stage.error).join(" | ")
      : "OK";
    props.setProperties({
      DAILY_AUTO_LAST_FINISHED_AT: finishedAt,
      DAILY_AUTO_LAST_STATUS: status,
      DAILY_AUTO_LAST_STAGES_JSON: JSON.stringify(stages),
      DAILY_AUTO_LAST_RETRY_SCHEDULED_JSON: JSON.stringify(retryScheduled),
    }, false);
    Logger.log("dailyAuto_result " + JSON.stringify({
      status: status,
      started_at: startedAt,
      finished_at: finishedAt,
      retry_scheduled: retryScheduled,
      stages: stages,
    }));
    if (errors.length) throw new Error(status);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════
// DB→시트 독립 동기화 — 3시간 주기 + 1회 재시도 + 시간초과 워치독
// dailyAuto에 묶이면 전체 실행이 30분 제한을 넘을 때 신규글 반영까지 함께 멈춘다.
// Apps Script 트리거 자체가 강제 종료되면 catch/finally가 실행되지 않으므로, 시작 전에 별도
// watchdog을 예약하고 성공 시 제거한다. watchdog은 원 실행과 겹쳐 쓰지 않고 30분 이후에만 재시도한다.
// ═══════════════════════════════════════════════════════════════
const DB_PULL_SYNC_INTERVAL_HOURS_ = 3;
const DB_PULL_SYNC_RETRY_DELAY_MS_ = 7 * 60 * 1000;
// 🚨 2026-08-26: 20분이던 워치독이 **본 실행보다 먼저 울려** 성공한 실행도 실패로 알렸다.
//    Apps Script 실행 한도는 30분이므로, 워치독은 그 뒤에 울려야 "완료 기록 없음"이 실제 실패를 뜻한다.
//    32분 = 30분 한도 + 마무리(프로퍼티 기록·flush) 여유 2분.
const DB_PULL_SYNC_WATCHDOG_DELAY_MS_ = 32 * 60 * 1000;
const DB_PULL_SYNC_TIMEOUT_RETRY_DELAY_MS_ = 5 * 60 * 1000;

function removeDbPullSyncTriggersByHandler_(handlers) {
  const wanted = handlers || [];
  const triggers = ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return wanted.indexOf(trigger.getHandlerFunction()) >= 0; });
  triggers.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  return triggers.length;
}

function dbPullSyncErrorText_(error) {
  return String((error && (error.stack || error.message)) || error).slice(0, 700);
}

function notifyDbPullSyncFailure_(payload) {
  try {
    const res = UrlFetchApp.fetch(CONFIG.DB_SHEET_SYNC_ALERT_URL, {
      method: "post",
      headers: authHeaders_(),
      contentType: "application/json",
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) Logger.log("dbPullSync alert HTTP " + code + ": " + res.getContentText().slice(0, 300));
  } catch (error) {
    Logger.log("dbPullSync alert error: " + dbPullSyncErrorText_(error));
  }
}

function scheduleDbPullSyncRetry_(pending, delayMs) {
  removeDbPullSyncTriggersByHandler_(["dbPullSyncRetry_"]);
  PropertiesService.getScriptProperties().setProperty("DB_PULL_SYNC_PENDING_JSON", JSON.stringify(pending));
  ScriptApp.newTrigger("dbPullSyncRetry_")
    .timeBased()
    .after(delayMs)
    .create();
}

function runDbPullSyncAttempt_(source, attempt) {
  return withAutoWriteGuard_(function() {
    return withDocLock_(function() {
      const props = PropertiesService.getScriptProperties();
      const startedAt = new Date().toISOString();
      const runId = startedAt + ":" + String(Math.floor(Math.random() * 1000000));
      const pending = { run_id: runId, source: source, attempt: attempt, started_at: startedAt };

      removeDbPullSyncTriggersByHandler_(["dbPullSyncWatchdog_"]);
      props.setProperties({
        DB_PULL_SYNC_LAST_STARTED_AT: startedAt,
        DB_PULL_SYNC_LAST_FINISHED_AT: "",
        DB_PULL_SYNC_LAST_STATUS: "RUNNING",
        DB_PULL_SYNC_LAST_SOURCE: source,
        DB_PULL_SYNC_PENDING_JSON: JSON.stringify(pending),
      }, false);
      ScriptApp.newTrigger("dbPullSyncWatchdog_")
        .timeBased()
        .after(DB_PULL_SYNC_WATCHDOG_DELAY_MS_)
        .create();

      try {
        const ok = pullFromDB();
        if (ok === false) throw new Error("pullFromDB returned false");
        const finishedAt = new Date().toISOString();
        removeDbPullSyncTriggersByHandler_(["dbPullSyncWatchdog_", "dbPullSyncRetry_"]);
        props.deleteProperty("DB_PULL_SYNC_PENDING_JSON");
        props.setProperties({
          DB_PULL_SYNC_LAST_FINISHED_AT: finishedAt,
          DB_PULL_SYNC_LAST_STATUS: "OK",
          DB_PULL_SYNC_LAST_ERROR: "",
        }, false);
        Logger.log("dbPullSync_result " + JSON.stringify({ status: "OK", source: source, attempt: attempt, started_at: startedAt, finished_at: finishedAt }));
        return true;
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const errorText = dbPullSyncErrorText_(error);
        removeDbPullSyncTriggersByHandler_(["dbPullSyncWatchdog_"]);
        props.setProperties({
          DB_PULL_SYNC_LAST_FINISHED_AT: finishedAt,
          DB_PULL_SYNC_LAST_STATUS: "ERROR",
          DB_PULL_SYNC_LAST_ERROR: errorText,
        }, false);
        const willRetry = attempt < 1;
        if (willRetry) {
          scheduleDbPullSyncRetry_({
            run_id: runId,
            source: source,
            attempt: 1,
            started_at: startedAt,
            reason: "caught_error",
          }, DB_PULL_SYNC_RETRY_DELAY_MS_);
        } else {
          props.deleteProperty("DB_PULL_SYNC_PENDING_JSON");
        }
        notifyDbPullSyncFailure_({
          status: "ERROR",
          source: source,
          attempt: attempt,
          started_at: startedAt,
          finished_at: finishedAt,
          retry_scheduled: willRetry,
          error: errorText,
        });
        Logger.log("dbPullSync_result " + JSON.stringify({ status: "ERROR", source: source, attempt: attempt, retry_scheduled: willRetry, error: errorText }));
        throw error;
      }
    });
  });
}

function scheduledDbPullSync_() {
  return runDbPullSyncAttempt_("scheduled", 0);
}

function runDbPullSyncNow() {
  return runDbPullSyncAttempt_("manual", 0);
}

function dbPullSyncRetry_() {
  removeDbPullSyncTriggersByHandler_(["dbPullSyncRetry_"]);
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("DB_PULL_SYNC_PENDING_JSON");
  if (!raw) {
    Logger.log("dbPullSync_retry_skip: pending 없음");
    return true;
  }
  let pending;
  try { pending = JSON.parse(raw); } catch (error) { pending = {}; }
  return runDbPullSyncAttempt_("retry", Number(pending.attempt || 1));
}

function dbPullSyncWatchdog_() {
  removeDbPullSyncTriggersByHandler_(["dbPullSyncWatchdog_"]);
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("DB_PULL_SYNC_PENDING_JSON");
  if (!raw) return true;
  let pending;
  try { pending = JSON.parse(raw); } catch (error) { pending = {}; }
  const lastFinished = Date.parse(props.getProperty("DB_PULL_SYNC_LAST_FINISHED_AT") || "");
  const pendingStarted = Date.parse(pending.started_at || "");
  if (Number.isFinite(lastFinished) && Number.isFinite(pendingStarted) && lastFinished >= pendingStarted) {
    props.deleteProperty("DB_PULL_SYNC_PENDING_JSON");
    return true;
  }

  // 워치독은 실행 한도(30분)를 넘긴 뒤에 울린다 → 이 시점의 "완료 기록 없음"은 실제 실패다.
  // 재시도는 5분 뒤로 둔다(원 실행은 이미 종료돼 있어 동시 시트 쓰기 위험이 없다).
  const message = "Apps Script 32분 경과 후에도 완료 기록 없음(실행 한도 초과)";
  scheduleDbPullSyncRetry_({
    run_id: pending.run_id || "",
    source: pending.source || "scheduled",
    attempt: 1,
    started_at: pending.started_at || "",
    reason: "watchdog_timeout",
  }, DB_PULL_SYNC_TIMEOUT_RETRY_DELAY_MS_);
  props.setProperty("DB_PULL_SYNC_LAST_STATUS", "WATCHDOG_TIMEOUT");
  props.setProperty("DB_PULL_SYNC_LAST_ERROR", message);
  notifyDbPullSyncFailure_({
    status: "WATCHDOG_TIMEOUT",
    source: pending.source || "scheduled",
    attempt: Number(pending.attempt || 0),
    started_at: pending.started_at || "",
    retry_scheduled: true,
    error: message,
  });
  return true;
}

function installDbPullSyncTrigger_() {
  removeDbPullSyncTriggersByHandler_(["scheduledDbPullSync_", "dbPullSyncRetry_", "dbPullSyncWatchdog_"]);
  PropertiesService.getScriptProperties().deleteProperty("DB_PULL_SYNC_PENDING_JSON");
  ScriptApp.newTrigger("scheduledDbPullSync_")
    .timeBased()
    .everyHours(DB_PULL_SYNC_INTERVAL_HOURS_)
    .create();
}

// ═══════════════════════════════════════════════════════════════
// 수집 조회수 → 시트 I열~ 역채움 (대시보드 자동수집분을 시트로 내림)
// importStats(시트→DB)의 반대. 새 날짜는 우측에 열 자동 추가 후, 수집값 있는 날짜 칸만 갱신
// (없으면 기존값 유지=수동 입력 보존). dailyAuto(매일 8:30)에 연결돼 자동 확장·갱신.
// ═══════════════════════════════════════════════════════════════
function fetchCollectedStats_() {
  const res = UrlFetchApp.fetch(CONFIG.STATS_EXPORT_API_URL, {
    method: "get",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error(`API ${code}: ${res.getContentText()}`);
  return (JSON.parse(res.getContentText()).posts) || []; // [{url, key, ended_at, stats:[[date,metric],...]}] — 종료·통계없음 글은 stats:[]
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
    const finalMetricByKey = {};
    const allDatesSet = {};
    const today = todayStr_();
    fetchCollectedStats_().forEach(p => {
      const k = linkKey_(String(p.key || p.url || ""));
      if (!k) return;
      if (p.ended_at) endedByKey[k] = String(p.ended_at).slice(0, 10);
      const m = byKey[k] || (byKey[k] = {});
      (p.stats || []).forEach(pair => {
        const metric = Number(pair[1]);
        const measuredAt = String(pair[0]).slice(0, 10);
        if (!(metric > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(measuredAt)) return; // 0·음수·비숫자 방어 — 시트에 0 찍힘/기존값 덮음/빈 열 추가 방지(엔드포인트도 >0만 반환)
        m[measuredAt] = metric; allDatesSet[measuredAt] = true;
        if (measuredAt < today && (!(finalMetricByKey[k] > 0) || metric > finalMetricByKey[k])) {
          finalMetricByKey[k] = metric;
        }
      });
    });

    // ── 우측 날짜열 자동 추가 ──
    // 수집 데이터의 날짜 중 '기존 마지막 날짜열보다 뒤(우측)이고 오늘(KST) 이하'인 날짜만 새 열로 삽입.
    // (중간 백필용 열 삽입은 안 함 — 우측으로만 확장. 헤더/등록상태는 이름 기반 조회라 열 삽입에도 안 깨짐)
    const existingSet = {};
    dateCols.forEach(dc => existingSet[dc.date] = true);
    const maxExisting = dateCols.length ? dateCols[dateCols.length - 1].date : null;
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
    const keyRowCounts = {};
    const postedAtByRow = new Array(nRows);
    for (let i = 0; i < nRows; i++) {
      postedAtByRow[i] = toDateStr_(postedVals[i][0]);
      const url = String(urlVals[i][0] || "").trim();
      if (!url) { rowMap[i] = null; rowKeys[i] = null; continue; }
      const key = linkKey_(url);
      rowKeys[i] = key;
      if (key) keyRowCounts[key] = (keyRowCounts[key] || 0) + 1;
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
    // 변경된 날짜 열만 URL-key로 기록한다. URL열·날짜블록을 쓰기 직전 각각 한 번만
    // 다시 읽어 현재 URL→행 위치를 만든다(날짜열마다 재조회하지 않아 왕복 폭증 방지).
    // 계산 뒤 사람이 정렬해도 현재 URL 위치로 쓰며, 중복 URL은 안전하게 건너뛴다.
    const latestLastRowForDates = sheet.getLastRow();
    if (latestLastRowForDates !== lastRow) {
      safeAlert_(`⚠️ 실행 중 행 수가 ${lastRow}→${latestLastRowForDates}로 바뀌어 날짜값 쓰기를 중단했습니다. 잠시 후 다시 실행됩니다.`);
      return false;
    }
    const latestUrlsForDates = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, nRows, 1).getValues();
    const latestDateBlock = sheet.getRange(CONFIG.DATA_START_ROW, firstCol, nRows, width).getValues();
    const latestRowByKey = {}, latestKeyCounts = {};
    for (let i = 0; i < nRows; i++) {
      const key = linkKey_(String(latestUrlsForDates[i][0] || "").trim());
      if (!key) continue;
      latestKeyCounts[key] = (latestKeyCounts[key] || 0) + 1;
      latestRowByKey[key] = i;
    }
    const finalDateBlock = latestDateBlock.map(function(row) { return row.slice(); });
    let dateKeyWrites = 0, dateKeyConflicts = 0, concurrentCellSkips = 0;
    dateCols.forEach(dc => {
      const bi = dc.col - firstCol;
      for (let i = 0; i < nRows; i++) {
        const key = rowKeys[i];
        if (!key || newBlock[i][bi] === block[i][bi]) continue;
        if (keyRowCounts[key] > 1 || latestKeyCounts[key] > 1) { dateKeyConflicts++; continue; }
        const latestIndex = latestRowByKey[key];
        if (latestIndex === undefined) { concurrentCellSkips++; continue; }
        const current = latestDateBlock[latestIndex][bi];
        // 계산 이후 사람이 같은 셀을 수정했다면 그 최신 수기값을 보존한다.
        if (current !== block[i][bi]) { concurrentCellSkips++; continue; }
        if (current !== newBlock[i][bi]) {
          finalDateBlock[latestIndex][bi] = newBlock[i][bi];
          dateKeyWrites++;
        }
      }
    });

    // 쓰기 직전 URL 순서를 한 번 더 확인한다. 바뀌었으면 한 칸도 쓰지 않고 재시도한다.
    const preWriteUrls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, nRows, 1).getValues();
    let preWriteOrderChanged = false;
    for (let i = 0; i < nRows; i++) {
      if (linkKey_(String(preWriteUrls[i][0] || "").trim()) !== linkKey_(String(latestUrlsForDates[i][0] || "").trim())) {
        preWriteOrderChanged = true; break;
      }
    }
    if (preWriteOrderChanged) {
      safeAlert_("⚠️ 날짜값 쓰기 직전 행 정렬이 감지돼 전체 쓰기를 취소했습니다. 잠시 후 다시 실행됩니다.");
      return false;
    }

    // 날짜열은 보통 하나의 연속 블록이다. 비-날짜 열이 끼어 있어도 그 열은 건드리지 않도록
    // 연속 날짜열 그룹별로 한 번만 setValues한다(2,000행×97열도 수십 번이 아닌 1~2회 쓰기).
    const dateColGroups = [];
    for (let i = 0; i < dateCols.length; i++) {
      const col = dateCols[i].col;
      const prev = dateColGroups.length ? dateColGroups[dateColGroups.length - 1] : null;
      if (!prev || col !== prev.end + 1) dateColGroups.push({ start: col, end: col });
      else prev.end = col;
    }
    dateColGroups.forEach(function(group) {
      const startBi = group.start - firstCol;
      const groupWidth = group.end - group.start + 1;
      let changed = false;
      for (let i = 0; i < nRows && !changed; i++) {
        for (let j = 0; j < groupWidth; j++) {
          if (finalDateBlock[i][startBi + j] !== latestDateBlock[i][startBi + j]) { changed = true; break; }
        }
      }
      if (!changed) return;
      assertRowCountStable_(sheet, latestLastRowForDates, "exportStats.dateBlock");
      const values = finalDateBlock.map(function(row) { return row.slice(startBi, startBi + groupWidth); });
      sheet.getRange(CONFIG.DATA_START_ROW, group.start, nRows, groupWidth).setValues(values);
    });

    const incrementCol = getIncrementCol_(sheet);
    let incWritten = 0;
    if (incrementCol) {
      // 증분 수식은 아직 행번호를 참조하는 3단계 대상이다. 날짜값은 이미 URL-key로
      // 안전하게 썼지만, 계산 중 정렬이 있었다면 수식은 쓰지 않고 다음 재시도로 넘긴다.
      const formulaLastRow = sheet.getLastRow();
      if (formulaLastRow !== lastRow) {
        safeAlert_(`⚠️ 실행 중 행 수가 ${lastRow}→${formulaLastRow}로 바뀌어 증분 수식 쓰기를 중단했습니다. 날짜값은 URL 기준으로 안전하게 반영됐으며 잠시 후 다시 실행됩니다.`);
        return false;
      }
      const formulaUrls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, nRows, 1).getValues();
      let urlOrderChanged = false;
      for (let i = 0; i < nRows; i++) {
        const latestKey = linkKey_(String(formulaUrls[i][0] || "").trim());
        const originalKey = rowKeys[i] || ""; // 빈 URL: 초기 null과 재조회 ""를 같은 값으로 취급
        if (latestKey !== originalKey) { urlOrderChanged = true; break; }
      }
      if (urlOrderChanged) {
        safeAlert_("⚠️ 실행 중 행 정렬이 감지돼 증분 수식 쓰기를 중단했습니다. 날짜값은 URL 기준으로 안전하게 반영됐으며 잠시 후 다시 실행됩니다.");
        return false;
      }
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
          // DB 참조가 아직 없는 /photo/·미러링 행도 시트 날짜값으로 증분을 계산한다.
          // 날짜값이 전혀 없으면 IFERROR가 빈 결과를 내므로 수식 복구 가능 상태도 유지된다.
          const rngRef = "$" + colLetter_(firstCol) + rowNum + ":$" + colLetter_(firstCol + width - 1) + rowNum;
          const firstCellRef = "$" + colLetter_(firstCol) + rowNum;
          incFormulas.push([
            "=IFERROR(LET(rng," + rngRef +
            ",cols,SEQUENCE(1,COLUMNS(rng),COLUMN(" + firstCellRef + "),1)" +
            ",lastC,MAX(FILTER(cols,rng>0))" +
            ",lastV,INDEX(rng,1,lastC-COLUMN(" + firstCellRef + ")+1)" +
            ",prev,FILTER(rng,cols<lastC,rng>0)" +
            ',IFERROR(MAX(0,lastV-MAX(prev)),lastV)),"")'
          ]);
          incWritten++;
          continue;
        }
        // 백로그 첫 측정(게시 7일 초과)만 빈칸 — 스파이크 방지 규칙 유지(판정은 DB 측정일 기반).
        if (refs.length === 1 && postedAt) {
          const gapDays = (Date.parse(refs[0].date) - Date.parse(String(postedAt).slice(0, 10))) / 86400000;
          if (gapDays > 7) { incFormulas.push(['=""']); continue; }  // 표시 빈칸이되 수식 유지(복구 가능 칸 규약)
        }
        // V2(행-범위 수식, 2026-07-29): 기존 셀주소 목록(MAX({CE743,...}))은 참조한 날짜 '열'이
        // 삭제/삽입되면 #REF!로 전멸했다(7/27 저녁 실사고. 정렬 자체는 상대참조가 행을 따라감을
        // 운영 시트 실측으로 확인 — H열 V4가 팀 정렬 수차례 후에도 1,278행 정합 유지).
        // 범위 참조는 열 증감에 자동 적응하고 행과 함께 이동한다. 의미는 기존과 동일:
        // 마지막 유효값 − 그 이전 최대(음수는 0), 유효값 1개면 전액.
        // (부수 개선: 오늘 열에 수기값이 들어오면 그 값이 최신으로 잡혀 증분이 즉시 반영됨)
        const rngRef = "$" + colLetter_(firstCol) + rowNum + ":$" + colLetter_(firstCol + width - 1) + rowNum;
        const firstCellRef = "$" + colLetter_(firstCol) + rowNum;
        incFormulas.push([
          "=IFERROR(LET(rng," + rngRef +
          ",cols,SEQUENCE(1,COLUMNS(rng),COLUMN(" + firstCellRef + "),1)" +
          ",lastC,MAX(FILTER(cols,rng>0))" +
          ",lastV,INDEX(rng,1,lastC-COLUMN(" + firstCellRef + ")+1)" +
          ",prev,FILTER(rng,cols<lastC,rng>0)" +
          ',IFERROR(MAX(0,lastV-MAX(prev)),lastV)),"")'
        ]);
        incWritten++;
      }
      sheet.getRange(CONFIG.DATA_START_ROW, incrementCol, nRows, 1).setFormulas(incFormulas);
      try { refreshCumulativeViews(); } catch (e) { Logger.log(e); }
    }

    // 종료글 최종값 보존: 날짜열에 표시 가능한 실측이 없어 H가 빈칸이더라도,
    // DB에 양수 조회수/도달수 이력이 있으면 "최종 누적 조회수" 값만 H열에 보존한다.
    // 날짜별 히스토리 칸에 소급 기입하면 측정일을 왜곡하므로 H열 빈칸만 채운다.
    let endedFinalFilled = 0, endedFinalNoMetric = 0;
    const cumulativeCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
    if (cumulativeCol) {
      const cumRange = sheet.getRange(CONFIG.DATA_START_ROW, cumulativeCol, nRows, 1);
      const cumVals = cumRange.getValues();
      const cumFormulas = cumRange.getFormulas();
      const cumOut = cumVals.map(row => [row[0]]);
      let cumChanged = false;
      for (let i = 0; i < nRows; i++) {
        const key = rowKeys[i];
        if (!key || !endedByKey[key]) continue;
        const hasFormula = cumFormulas[i][0] !== "";
        const cur = cumVals[i][0];
        const hasValue = cur !== "" && cur != null;
        if (hasFormula || hasValue) continue;
        const finalMetric = finalMetricByKey[key];
        if (finalMetric > 0) {
          cumOut[i][0] = finalMetric;
          cumChanged = true;
          endedFinalFilled++;
        } else {
          endedFinalNoMetric++;
        }
      }
      if (cumChanged) cumRange.setValues(cumOut);
    }

    let msg = `✅ 수집 조회수를 시트에 반영했습니다.\n새 날짜 열 ${addedCols}개 추가 · URL-key 날짜 쓰기 ${dateKeyWrites}칸 · 실측 갱신 ${filled}칸 · 공백 이어받기 ${carried}칸 · 업로드 전 값 삭제 ${prePostedCleared}칸 · 종료 이후 값 삭제 ${endedCleared}칸 · 증분 수식 ${incWritten}행 · 기존값 보존 ${preserved}칸 · 매칭 게시물 ${matched}개 · 날짜 열 ${dateCols.length}개`;
    if (endedFinalFilled) msg += `\n🛑 트래킹 종료글 H열 빈칸 ${endedFinalFilled}행에 DB 최종 누적값을 보존했습니다.`;
    if (endedFinalNoMetric) msg += `\n⚠️ 트래킹 종료됐지만 DB 조회수/도달수 이력이 없는 행 ${endedFinalNoMetric}개는 최종값을 채울 수 없습니다.`;
    if (shortcodeFormatMatched) msg += `\n🔁 /reel·/tv 잔재 URL ${shortcodeFormatMatched}개는 shortcode 기준으로 정상 매칭했습니다.`;
    if (missing) msg += `\n⚠️ 시트엔 있으나 대시보드에 수집기록이 없는 URL ${missing}개(아직 수집 전이거나 미등록).`;
    if (futureCleared) msg += `\n🗓️ 오늘·미래(수집일-1 이후) 날짜칸 ${futureCleared}개를 비웠습니다.`;
    if (dateKeyConflicts) msg += `\n⚠️ 중복 URL 키의 변경 ${dateKeyConflicts}칸은 어느 행이 정본인지 불명확해 쓰지 않았습니다.`;
    if (concurrentCellSkips) msg += `\n🛡️ 계산 뒤 사람이 수정한 ${concurrentCellSkips}칸은 최신 수기값을 보존했습니다.`;
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
  } else if (typeof label === "number" && label >= 44000 && label <= 48000) {
    const serialDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(label) * 86400000);
    mo = serialDate.getUTCMonth() + 1; da = serialDate.getUTCDate();
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

function importStats(source) {
  try {
    // 메뉴에서 직접 실행하면 수기 확정값, dailyAuto에서 호출하면 자동 동기화값이다.
    // 서버가 이 출처를 기준으로 manual 플래그와 기존 수기행 보존 정책을 적용한다.
    const importSource = source === "daily_auto" ? "daily_auto" : "manual_sheet";
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
        if (fieldCols.planner)         p.planner         = String(row[fieldCols.planner - 1] || "").trim() || null;
        if (fieldCols.creator)         p.creator         = String(row[fieldCols.creator - 1] || "").trim() || null;
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

    // ⚠️ Vercel 서버리스 함수 요청 본문 한도(~4.5MB). 시트가 커지면서 posts+stats 전체를 한 번에
    //    POST하면 413(FUNCTION_PAYLOAD_TOO_LARGE)로 거부된다(2026-08-20 발생). → 게시물 단위로 배치 전송.
    //    한 게시물의 조회수 이력은 반드시 같은 배치에 함께 보내야 서버의 누적-역행 가드(dropped_decrease)가
    //    배치 경계에서 오작동하지 않는다. 데이터 계약·payload 모양은 동일 → 서버/Vercel 변경 불필요.
    const statsByKey = {};
    stats.forEach(function (s) { const k = urlKey_(s.url); (statsByKey[k] = statsByKey[k] || []).push(s); });

    const POSTS_PER_BATCH = 300; // 300 게시물/배치 ≈ 본문 수백KB (4.5MB 대비 충분한 여유). 필요시 조정.
    const keys = Object.keys(postByKey);
    const res = { missing_sample: [], dropped_sample: [] };
    const AGG = ["inserted", "created_posts", "matched_urls", "banner_reach_inserted",
                 "meta_filled", "ended_marked", "future_date_skipped", "pre_posted_skipped",
                 "dropped_decrease", "missing_urls", "preserved_manual", "overwrote_manual"];
    AGG.forEach(function (f) { res[f] = 0; });
    let _batches = 0;
    for (let i = 0; i < keys.length; i += POSTS_PER_BATCH) {
      const keyBatch = keys.slice(i, i + POSTS_PER_BATCH);
      const postBatch = keyBatch.map(function (k) { return postByKey[k]; });
      const statBatch = [];
      keyBatch.forEach(function (k) { (statsByKey[k] || []).forEach(function (s) { statBatch.push(s); }); });
      const r = postStats_({
        posts: postBatch,
        stats: statBatch,
        client_version: IMPORTSTATS_CLIENT_VERSION,
        source: importSource,
      });
      _batches++;
      AGG.forEach(function (f) { res[f] += (r[f] || 0); });
      if (Array.isArray(r.missing_sample)) r.missing_sample.forEach(function (x) { if (res.missing_sample.length < 20) res.missing_sample.push(x); });
      if (Array.isArray(r.dropped_sample)) r.dropped_sample.forEach(function (x) { if (res.dropped_sample.length < 8) res.dropped_sample.push(x); });
    }
    Logger.log(JSON.stringify({ event: "importStats_batched", batches: _batches, posts: keys.length, stats: stats.length, posts_per_batch: POSTS_PER_BATCH }));
    Logger.log(JSON.stringify({
      event: "importStats_result",
      inserted: res.inserted || 0,
      banner_reach_inserted: res.banner_reach_inserted || 0,
      future_date_skipped: res.future_date_skipped || 0,
      missing_urls: res.missing_urls || 0,
      dropped_decrease: res.dropped_decrease || 0,
      source: importSource,
      preserved_manual: res.preserved_manual || 0,
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
      .filter(t => ["syncNew", "dailyAuto", "scheduledDbPullSync_"].indexOf(t.getHandlerFunction()) >= 0);
    const dailyAutoCount = triggers.filter(t => t.getHandlerFunction() === "dailyAuto").length;
    const midnightSyncNewCount = triggers.filter(t => t.getHandlerFunction() === "syncNew").length;
    const dbPullSyncCount = triggers.filter(t => t.getHandlerFunction() === "scheduledDbPullSync_").length;
    const props = PropertiesService.getScriptProperties();
    const lastStarted = props.getProperty("DAILY_AUTO_LAST_STARTED_AT") || "-";
    const lastFinished = props.getProperty("DAILY_AUTO_LAST_FINISHED_AT") || "-";
    const lastStatus = props.getProperty("DAILY_AUTO_LAST_STATUS") || "기록 없음";
    const dbPullLastStarted = props.getProperty("DB_PULL_SYNC_LAST_STARTED_AT") || "-";
    const dbPullLastFinished = props.getProperty("DB_PULL_SYNC_LAST_FINISHED_AT") || "-";
    const dbPullLastStatus = props.getProperty("DB_PULL_SYNC_LAST_STATUS") || "기록 없음";
    const scriptTimezone = Session.getScriptTimeZone();
    const kstToday = todayStr_();
    safeAlert_(
      `✅ 설정 정상\n` +
      `탭: ${sheet.getName()}\n` +
      `인식된 필드: ${Object.keys(fieldCols).join(", ")}\n\n` +
      `🕘 스크립트 시간대: ${scriptTimezone} / KST 오늘: ${kstToday}\n` +
      `⏰ 자동 동기화 상태: ${dailyAutoCount === 1 && midnightSyncNewCount === 1 && dbPullSyncCount === 1 ? "✅ 켜짐" : "⚠️ 복구 필요"}\n` +
      `트리거: dailyAuto ${dailyAutoCount}개, 자정 syncNew ${midnightSyncNewCount}개, DB→시트 3시간 ${dbPullSyncCount}개\n` +
      `예정: DB→시트 3시간 간격 / 일일 작업 ${CONFIG.TRIGGER_HOUR}:${CONFIG.TRIGGER_MINUTE} KST 전후\n` +
      `마지막 dailyAuto 시작: ${lastStarted}\n` +
      `마지막 dailyAuto 종료: ${lastFinished}\n` +
      `마지막 dailyAuto 상태: ${lastStatus}\n\n` +
      `마지막 DB→시트 시작: ${dbPullLastStarted}\n` +
      `마지막 DB→시트 종료: ${dbPullLastFinished}\n` +
      `마지막 DB→시트 상태: ${dbPullLastStatus}`
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
// 자동 트리거 (매일 8:30, dailyAuto 실행: syncAll → syncPricing → importStats → exportStats)
// DB→시트 pullFromDB는 3시간 독립 트리거로 실행한다.
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
    if (skipEditDuringAutoWrite_("onStatusEdit_")) return;
    const sheet = e.range.getSheet();
    if (sheet.getSheetId() !== CONFIG.SHEET_GID) return;
    const hasInputIssue = validateLinkedSheetInputOnEdit_(e, sheet);  // 잘못된 단일 입력·다중셀 붙여넣기 즉시 경고(기존 값 자동삭제 금지)
    sanitizeAssetNameOnEdit_(e, sheet);  // 소재명 뒤 파일 목록(.mp4, 2. 속지 …) 재유입 즉시 제거
    healCumulativeOnEdit_(e, sheet);  // 누적(H) 열이 편집됐으면 즉시 자가치유 — 다중셀 붙여넣기도 잡아야 하므로 단일셀 제한보다 앞에서
    if (!hasInputIssue) warnDateColumnEdit_(e, sheet);  // 검증 오류가 없을 때만 오늘 날짜열 안내(오류 토스트 덮어쓰기 방지)
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

// ═══════════════════════════════════════════════════════════════
// 연동 시트 입력 검증 — 값은 자동 수정/삭제하지 않고, 잘못된 입력을 거부하거나 즉시 알린다.
// A: 실제 날짜, B: URL, F: 대문자 영문+한글 상품명, G: 숫자, J/K: 한글 사람 이름.
// O 이후는 '날짜 제목이 붙은 열'만 조회수 영역으로 취급한다. 등록상태 등 관리 열은 제외한다.
// 조회수는 숫자만 허용하며, 해당 행 업로드일 전이나 KST 오늘 이후 날짜 열에는 입력할 수 없다.
const LINKED_INPUT_FIRST_DATE_COL_ = 15;  // O열

function isBlankLinkedInput_(value) {
  return value === "" || value == null;
}

function isValidLinkedDateValue_(value) {
  return isBlankLinkedInput_(value)
    || (value instanceof Date && !isNaN(value.getTime()));
}

function isValidLinkedUrlValue_(value) {
  return isBlankLinkedInput_(value)
    || /^https?:\/\/\S+$/i.test(String(value).trim());
}

function isValidLinkedProductValue_(value) {
  if (isBlankLinkedInput_(value)) return true;
  const text = String(value).trim();
  if (text === "-") return true;
  return /[A-Z]/.test(text) && /[가-힣]/.test(text);
}

function isValidLinkedPersonName_(value) {
  return isBlankLinkedInput_(value) || /^[가-힣]+$/.test(String(value).trim());
}

function dateKeyFromLinkedValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.KST_TIMEZONE, "yyyy-MM-dd");
  }
  return "";
}

function linkedDateColumns_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < LINKED_INPUT_FIRST_DATE_COL_) return {};
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const statusCol = headers.findIndex(function(value) {
    return norm_(value) === norm_(CONFIG.STATUS_HEADER);
  }) + 1;
  const endCol = statusCol > 0 ? statusCol - 1 : lastCol;
  const out = {};
  for (let col = LINKED_INPUT_FIRST_DATE_COL_; col <= endCol; col++) {
    const key = dateKeyFromLinkedValue_(headers[col - 1]);
    if (key) out[col] = key;
  }
  return out;
}

function validateLinkedSheetInputOnEdit_(e, sheet) {
  try {
    const range = e.range;
    if (range.getLastRow() < CONFIG.DATA_START_ROW) return false;

    const rowStart = Math.max(range.getRow(), CONFIG.DATA_START_ROW);
    const rowEnd = range.getLastRow();
    const colStart = range.getColumn();
    const colEnd = range.getLastColumn();
    const values = sheet.getRange(rowStart, colStart, rowEnd - rowStart + 1, colEnd - colStart + 1).getValues();
    const uploadDates = sheet.getRange(rowStart, 1, rowEnd - rowStart + 1, 1).getValues();
    const dateColumns = linkedDateColumns_(sheet);
    const fieldCols = buildFieldCols_(sheet);
    const personCols = {};
    [fieldCols.planner, fieldCols.creator].forEach(function(col) {
      if (col) personCols[col] = true;
    });
    const today = todayStr_();
    const issues = [];
    let totalIssues = 0;

    function addIssue(row, col, reason) {
      totalIssues++;
      if (issues.length < 12) issues.push(colLetter_(col) + row + " " + reason);
    }

    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const value = values[r - rowStart][c - colStart];
        if (c === 1 && !isValidLinkedDateValue_(value)) {
          addIssue(r, c, "업로드일은 실제 날짜만 가능합니다.");
        } else if (c === 2 && !isValidLinkedUrlValue_(value)) {
          addIssue(r, c, "http(s) URL만 가능합니다.");
        } else if (c === 6 && !isValidLinkedProductValue_(value)) {
          addIssue(r, c, "상품명은 '-' 또는 대문자 영문과 한글을 모두 포함해야 합니다.");
        } else if (c === 7 && !isBlankLinkedInput_(value) && !(typeof value === "number" && isFinite(value))) {
          addIssue(r, c, "비용은 숫자만 가능합니다.");
        } else if (personCols[c] && !isValidLinkedPersonName_(value)) {
          addIssue(r, c, "기획자·제작자는 한글 이름만 가능합니다.");
        }

        const statDate = dateColumns[c];
        if (!statDate || isBlankLinkedInput_(value)) continue;
        if (!(typeof value === "number" && isFinite(value))) {
          addIssue(r, c, "날짜열에는 숫자만 가능합니다.");
          continue;
        }
        const uploadDate = dateKeyFromLinkedValue_(uploadDates[r - rowStart][0]);
        if (!uploadDate) addIssue(r, c, "업로드일이 실제 날짜가 아니어서 입력일을 검증할 수 없습니다.");
        else if (statDate < uploadDate) addIssue(r, c, "업로드일(" + uploadDate + ") 이전에는 입력할 수 없습니다.");
        if (statDate > today) addIssue(r, c, "오늘(" + today + ")보다 미래에는 입력할 수 없습니다.");
      }
    }

    if (issues.length) {
      SpreadsheetApp.getActive().toast(
        issues.slice(0, 5).join("\n") + (totalIssues > 5 ? "\n외 " + (totalIssues - 5) + "건" : ""),
        "⚠️ 입력 규칙 위반",
        10
      );
      Logger.log("linked_input_validation " + JSON.stringify({
        range: range.getA1Notation(),
        issue_count: totalIssues,
        issues: issues,
      }));
    }
    return totalIssues > 0;
  } catch (err) {
    Logger.log("validateLinkedSheetInputOnEdit_: " + (err.stack || err.message));
    return false;
  }
}

function linkedValidationRule_(formula, helpText) {
  return SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(formula)
    .setAllowInvalid(false)
    .setHelpText(helpText)
    .build();
}

function applyDateInputValidation_(sheet, startCol, numCols) {
  if (numCols <= 0) return;
  const rowCount = Math.max(1, sheet.getMaxRows() - CONFIG.DATA_START_ROW + 1);
  const topLeft = colLetter_(startCol) + CONFIG.DATA_START_ROW;
  const formula = '=OR(' + topLeft + '="",AND(ISNUMBER(' + topLeft + '),'
    + colLetter_(startCol) + '$1<=TODAY(),ISNUMBER($A' + CONFIG.DATA_START_ROW + '),'
    + colLetter_(startCol) + '$1>=$A' + CONFIG.DATA_START_ROW + '))';
  sheet.getRange(CONFIG.DATA_START_ROW, startCol, rowCount, numCols).setDataValidation(
    linkedValidationRule_(formula, "숫자만 입력할 수 있습니다. 업로드일 이전 및 오늘 이후 날짜에는 입력할 수 없습니다.")
  );
}

function applyLinkedSheetInputValidation_() {
  const sheet = getSheet_();
  const rowCount = Math.max(1, sheet.getMaxRows() - CONFIG.DATA_START_ROW + 1);
  const fieldCols = buildFieldCols_(sheet);
  const cpvCol = findHeaderCol_(sheet, ["CPV", "cpv"]);
  const rules = [
    [1, '=OR(A2="",AND(ISNUMBER(A2),A2>0))', "업로드일은 실제 날짜만 입력하세요."],
    [2, '=OR(B2="",REGEXMATCH(TO_TEXT(B2),"^https?://[^[:space:]]+$"))', "http(s) URL만 입력하세요."],
    [6, '=OR(F2="",F2="-",AND(REGEXMATCH(TO_TEXT(F2),"[A-Z]"),REGEXMATCH(TO_TEXT(F2),"[가-힣]")))', "상품명은 '-' 또는 대문자 영문과 한글을 모두 포함한 값만 입력하세요."],
    [7, '=OR(G2="",ISNUMBER(G2))', "비용은 숫자만 입력하세요."],
  ];
  if (cpvCol) {
    const cpvCell = colLetter_(cpvCol) + CONFIG.DATA_START_ROW;
    rules.push([cpvCol, '=OR(' + cpvCell + '="",' + cpvCell + '="?",ISNUMBER(' + cpvCell + '))', "CPV는 숫자, ?, 또는 빈칸만 입력하세요."]);
  }
  [fieldCols.planner, fieldCols.creator].forEach(function(col) {
    if (!col) return;
    const cell = colLetter_(col) + CONFIG.DATA_START_ROW;
    rules.push([col, '=OR(' + cell + '="",REGEXMATCH(TO_TEXT(' + cell + '),"^[가-힣]+$"))', "한글로만 된 사람 이름을 입력하세요."]);
  });
  rules.forEach(function(item) {
    sheet.getRange(CONFIG.DATA_START_ROW, item[0], rowCount, 1)
      .setDataValidation(linkedValidationRule_(item[1], item[2]));
  });

  const dateColumns = linkedDateColumns_(sheet);
  const cols = Object.keys(dateColumns).map(Number).sort(function(a, b) { return a - b; });
  if (cols.length) {
    let runStart = cols[0], previous = cols[0];
    for (let i = 1; i <= cols.length; i++) {
      const col = cols[i];
      if (i < cols.length && col === previous + 1) {
        previous = col;
        continue;
      }
      applyDateInputValidation_(sheet, runStart, previous - runStart + 1);
      runStart = col;
      previous = col;
    }
  }
  return true;
}

function installLinkedSheetInputValidation() {
  applyLinkedSheetInputValidation_();
  safeAlert_("✅ 입력 검증을 적용했습니다. 잘못된 입력은 거부하고, 다중셀 붙여넣기 위반은 즉시 알립니다.");
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
  const statusByKey = {};
  urls.forEach(r => {
    const url = String(r[0] || "").trim();
    if (!url) return;
    const k = linkKey_(url);
    if (!k) return;
    const uu = url.toLowerCase();
    if (uu.indexOf("instagram.com") >= 0 && !/\/(p|reels|reel|tv)\/[a-z0-9_-]+/i.test(uu)) {
      statusByKey[k] = "오류";
      return;
    }
    statusByKey[k] = (k in ended) ? (ended[k] ? "트래킹 종료" : "트래킹 중") : "";
  });
  // URL을 쓰기 직전에 다시 읽어 현재 행 위치를 찾아 기록한다. 정렬·행삽입 후에도 이웃 행에 상태가 밀리지 않는다.
  const changed = writeColumnByKey_(
    sheet,
    CONFIG.DATA_START_ROW,
    fieldCols.url,
    statusCol,
    statusByKey,
    linkKey_
  );
  // URL을 지운 행은 key가 없으므로 별도 최신행 스냅샷에서 기존 자동 상태를 정리한다.
  // 이 쓰기도 최신 행 번호를 다시 읽은 뒤 연속 구간만 기록해 행 이동 창을 최소화한다.
  const latestLastRow = sheet.getLastRow();
  const latestN = Math.max(0, latestLastRow - CONFIG.DATA_START_ROW + 1);
  const clearedEdits = [];
  if (latestN > 0) {
    const latestUrls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, latestN, 1).getValues();
    const latestStatuses = sheet.getRange(CONFIG.DATA_START_ROW, statusCol, latestN, 1).getValues();
    for (let i = 0; i < latestN; i++) {
      if (String(latestUrls[i][0] || "").trim() !== "") continue;
      if (String(latestStatuses[i][0] || "").trim() === "") continue;
      clearedEdits.push({ row: CONFIG.DATA_START_ROW + i, value: "" });
    }
  }
  const cleared = writeColumnRuns_(sheet, statusCol, clearedEdits, latestLastRow);
  SpreadsheetApp.getActive().toast(
    "상태 동기화 완료: 변경 " + changed + "행, 빈 URL 정리 " + cleared + "행",
    "완료",
    4
  );
  return true;
}

// 날짜열 수기 입력 안내: 미래 열은 무조건 실수라 경고, 오늘 열은 입력 규칙 리마인드만.
// 값은 절대 건드리지 않는다(무결성 절대규칙: 자동 보정 금지, 감지 알림만) — 배너 도달수의
// 당일 입력은 stats-import가 공식 허용하는 워크플로라 막으면 안 됨. 2026-07-27 "금일 도달수
// 랜덤 기재" 신고의 원인이 규칙 공백(수기 입력 날짜열 기준 부재)이어서 안내로 재발 차단.
function warnDateColumnEdit_(e, sheet) {
  try {
    if (e.range.getRow() < CONFIG.DATA_START_ROW) return;
    const c1 = e.range.getColumn(), c2 = e.range.getLastColumn();
    if (c2 < CONFIG.STATS_FIRST_COL) return;  // 날짜열 영역 밖
    const lastCol = sheet.getLastColumn();
    const header = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    // exportStats/importStats와 동일 규칙으로 열→날짜 매핑(월 줄면 +1년)
    let year = CONFIG.STATS_START_YEAR, prevMonth = null;
    const dateByCol = {};
    for (let c = CONFIG.STATS_FIRST_COL; c <= lastCol; c++) {
      const md = parseMonthDay_(header[c - 1]);
      if (!md) continue;
      if (prevMonth !== null && md.mo < prevMonth) year++;
      prevMonth = md.mo;
      dateByCol[c] = `${year}-${("0" + md.mo).slice(-2)}-${("0" + md.da).slice(-2)}`;
    }
    const today = todayStr_();
    let future = null, isToday = false;
    for (let c = Math.max(c1, CONFIG.STATS_FIRST_COL); c <= c2; c++) {
      const d = dateByCol[c];
      if (!d) continue;
      if (d > today && (!future || d < future)) future = d;
      else if (d === today) isToday = true;
    }
    if (future) {
      SpreadsheetApp.getActive().toast(
        "⚠️ 미래 날짜(" + future + ") 열에 값을 입력했습니다. 열 위치를 확인하세요 — 미래 값은 리포트·DB 동기화에서 무시되거나 오염됩니다.",
        "날짜열 확인", 8);
    } else if (isToday) {
      SpreadsheetApp.getActive().toast(
        "오늘(" + today + ") 열에 입력했습니다. '지금 확인한 최신 누적'이면 맞고, 어제 기준 값이면 어제 열로 옮겨주세요. (자동수집은 어제까지만 채워 오늘 열은 수기 전용입니다)",
        "날짜열 안내", 8);
    }
  } catch (err) {
    Logger.log("warnDateColumnEdit_: " + (err.stack || err.message));
  }
}

// 누적(H) 열 편집 감지 → 앵커 수식 소실/스필 차단을 그 자리에서 복구.
// H는 H2 배열수식 하나가 열 전체를 채우는 구조라, 앵커 삭제나 아래쪽 셀 수기 입력(#REF! 차단) 한 번이면
// 열 전체가 사라진다(2026-07-27 실사고). 다음날 09:30까지 기다리지 않고 편집 즉시 치유한다.
function healCumulativeOnEdit_(e, sheet) {
  try {
    const cumCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
    if (!cumCol) return;
    if (e.range.getLastColumn() < cumCol || e.range.getColumn() > cumCol) return;  // H열 미포함 편집
    refreshCumulativeViews();  // 마커·스필 상태 점검 후 필요할 때만 재설치(멱등)
  } catch (err) {
    Logger.log("healCumulativeOnEdit_: " + (err.stack || err.message));
  }
}

function refreshCumulativeViews() {
  // V4(행별 수식, 2026-07-27 사용자 지시): H는 행마다 =IF(COUNT(첫날짜{r}:끝날짜{r})=0,"",MAX(...)) 개별 수식.
  // 스필(BYROW 앵커) 폐기 이유: 앵커 삭제(오전)·경로 한 칸 값 유입(#REF, 저녁)만으로 열 전체가 비는
  // 사고가 하루 2번 발생. 팀이 수기 입력·정렬·행 붙여넣기를 일상적으로 하는 시트라
  // '한 점 고장 = 전체 고장' 구조 자체를 제거한다. 행별 수식은 그 행만 영향받고(1행 붙여넣기 무해),
  // 상대참조라 정렬을 따라가며, 지워진 칸은 다음 갱신 때 그 행만 재충전된다.
  // 수동 입력 공식 허용: 수식 아닌 '값'이 든 칸은 절대 덮지 않는다. 단 값==그 행 날짜열 MAX면
  // (스필 마이그레이션 잔값/자동값과 동일한 중복 수기) 수식으로 환원해 자동 갱신을 복원한다
  // — 실제 정정(값≠MAX)만 수동 입력으로 취급해 보존.
  const sheet = getSheet_();
  const lastCol = sheet.getLastColumn();
  const cumCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  if (!cumCol) return true;
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const dateCols = [];
  const dateRe = /^\s*(?:\d{2,4}\s*[.]\s*)?\d{1,2}\s*[.]\s*\d{1,2}\s*[.]?\s*(\s|\(|$)/;
  for (let i = CONFIG.STATS_FIRST_COL - 1; i < headers.length; i++) {
    const header = headers[i];
    // ⚠️ 날짜 헤더가 '날짜 서식'이 풀려 숫자(serial 46238≈2026-08)로 저장된 열도 인식해야 한다.
    //    (2026-08-06 사고: serial 헤더 81개를 놓쳐 H 수식이 마지막 16열만 참조→1,765행 H 빈칸)
    const isSerialDate = typeof header === "number" && header >= 44000 && header <= 48000;
    if (header instanceof Date || isSerialDate || dateRe.test(String(header))) dateCols.push(i + 1);
  }
  if (!dateCols.length) return true;

  const firstDateCol = Math.min.apply(null, dateCols);
  const lastDateCol = Math.max.apply(null, dateCols);
  const firstDate = colLetter_(firstDateCol);
  const lastDate = colLetter_(lastDateCol);
  const lastRow = sheet.getLastRow();
  const n = Math.max(0, lastRow - CONFIG.DATA_START_ROW + 1);
  if (!n) return true;
  const range = sheet.getRange(CONFIG.DATA_START_ROW, cumCol, n, 1);
  const values = range.getValues();     // 스필 표시값·수동값 모두 값으로 읽힘(마이그레이션 겸용)
  const formulas = range.getFormulas();
  const daily = sheet.getRange(CONFIG.DATA_START_ROW, firstDateCol, n, lastDateCol - firstDateCol + 1).getValues();

  const out = [];
  let wrote = 0, manualKept = 0;
  for (let i = 0; i < n; i++) {
    const r = CONFIG.DATA_START_ROW + i;
    const hasFormula = formulas[i][0] !== "";
    const cur = values[i][0];
    const hasValue = cur !== "" && cur != null;
    let rowMax = null;
    for (let j = 0; j < daily[i].length; j++) {
      const v = daily[i][j];
      if (typeof v === "number" && v > 0 && (rowMax === null || v > rowMax)) rowMax = v;
    }
    if (rowMax !== null) {
      // 진짜 수동 정정(값이 있고 수식이 아니며 자동 MAX와 다름)만 보존
      if (!hasFormula && hasValue && Number(cur) !== rowMax) { out.push([cur]); manualKept++; continue; }
      out.push(["=IF(COUNT(" + firstDate + r + ":" + lastDate + r + ")=0,\"\",MAX(" + firstDate + r + ":" + lastDate + r + "))"]);
      wrote++;
      continue;
    }
    // 날짜 실측이 없는 행: 값이 있으면(구 legacy 3건·수기 전용 트래킹) 값 그대로 보존.
    // 값이 없으면 빈 결과 수식을 깔아 "데이터 없음"과 "수식 파손"을 구분한다.
    if (!hasFormula && hasValue) { out.push([cur]); manualKept++; }
    else {
      out.push(["=IF(COUNT(" + firstDate + r + ":" + lastDate + r + ")=0,\"\",MAX(" + firstDate + r + ":" + lastDate + r + "))"]);
      wrote++;
    }
  }
  range.setValues(out);  // '='로 시작하는 문자열은 수식으로 들어감 — 값·수식 혼합 1회 배치 쓰기

  SpreadsheetApp.getActive().toast(
    "누적 조회수 행별 수식 " + wrote + "행 갱신 · 수동/레거시 값 보존 " + manualKept + "건",
    "완료",
    4
  );
  return true;
}

function auditLinkedSheetFormulas_() {
  const sheet = getSheet_();
  const fieldCols = buildFieldCols_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) {
    const emptyResult = {
      url_rows: 0,
      cumulative_blank_no_formula: 0,
      increment_blank_no_formula: 0,
      cumulative_ref_errors: 0,
      increment_ref_errors: 0,
      cumulative_value_increment_blank: 0,
      orphan_metric_rows: 0,
    };
    Logger.log("linked_sheet_formula_audit " + JSON.stringify(emptyResult));
    return emptyResult;
  }

  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const incrementCol = getIncrementCol_(sheet);
  const cumulativeCol = incrementCol ? incrementCol - 1 : null;
  if (!incrementCol || !cumulativeCol) throw new Error("H/I metric columns not found");

  const urls = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, n, 1).getValues();
  const cumulativeValues = sheet.getRange(CONFIG.DATA_START_ROW, cumulativeCol, n, 1).getDisplayValues();
  const cumulativeFormulas = sheet.getRange(CONFIG.DATA_START_ROW, cumulativeCol, n, 1).getFormulas();
  const incrementValues = sheet.getRange(CONFIG.DATA_START_ROW, incrementCol, n, 1).getDisplayValues();
  const incrementFormulas = sheet.getRange(CONFIG.DATA_START_ROW, incrementCol, n, 1).getFormulas();
  const metricCols = metricDateColumns_(sheet);
  const firstMetricCol = metricCols.length ? Math.min.apply(null, metricCols.map(x => x.col)) : null;
  const lastMetricCol = metricCols.length ? Math.max.apply(null, metricCols.map(x => x.col)) : null;
  const metricValues = firstMetricCol
    ? sheet.getRange(CONFIG.DATA_START_ROW, firstMetricCol, n, lastMetricCol - firstMetricCol + 1).getValues()
    : Array(n).fill([]);

  const samples = [];
  const result = {
    url_rows: 0,
    cumulative_blank_no_formula: 0,
    increment_blank_no_formula: 0,
    cumulative_ref_errors: 0,
    increment_ref_errors: 0,
    cumulative_value_increment_blank: 0,
    orphan_metric_rows: 0,
    samples: samples,
  };

  for (let i = 0; i < n; i++) {
    const url = String(urls[i][0] || "").trim();
    const row = CONFIG.DATA_START_ROW + i;
    const h = String(cumulativeValues[i][0] || "").trim();
    const hFormula = String(cumulativeFormulas[i][0] || "");
    const inc = String(incrementValues[i][0] || "").trim();
    const incFormula = String(incrementFormulas[i][0] || "");
    if (!url) {
      const hasMetric = (metricValues[i] || []).some(v => typeof v === "number" && v > 0);
      if (h || inc || hasMetric) {
        result.orphan_metric_rows++;
        if (samples.length < 8) samples.push("row " + row + " orphan: URL blank, H=" + (h || "blank") + ", I=" + (inc || "blank"));
      }
      continue;
    }
    result.url_rows++;
    if (!h && !hFormula) {
      result.cumulative_blank_no_formula++;
      if (samples.length < 8) samples.push("H" + row + " blank/no-formula " + url);
    }
    if (!inc && !incFormula) {
      result.increment_blank_no_formula++;
      if (samples.length < 8) samples.push("I" + row + " blank/no-formula " + url);
    }
    if (h.indexOf("#REF!") >= 0) {
      result.cumulative_ref_errors++;
      if (samples.length < 8) samples.push("H" + row + " #REF " + url);
    }
    if (inc.indexOf("#REF!") >= 0) {
      result.increment_ref_errors++;
      if (samples.length < 8) samples.push("I" + row + " #REF " + url);
    }
    if (h && !inc) result.cumulative_value_increment_blank++;
  }

  Logger.log("linked_sheet_formula_audit " + JSON.stringify(result));
  return result;
}

function auditLinkedSheetFormulas() {
  const result = auditLinkedSheetFormulas_();
  safeAlert_(
    "Sheet H/I formula audit\n" +
    "URL rows: " + result.url_rows + "\n" +
    "H blank/no formula: " + result.cumulative_blank_no_formula + "\n" +
    "I blank/no formula: " + result.increment_blank_no_formula + "\n" +
    "H #REF: " + result.cumulative_ref_errors + "\n" +
    "I #REF: " + result.increment_ref_errors + "\n" +
    "H value + I blank: " + result.cumulative_value_increment_blank + "\n" +
    "URL blank + metric orphan rows: " + result.orphan_metric_rows + "\n" +
    (result.samples && result.samples.length ? "\nSamples:\n" + result.samples.join("\n") : "")
  );
  return result;
}

function creatorSourceText_(value) {
  return String(value || "").trim().replace(/^[⠿●■◆◇★☆⭐\s]+/, "");
}

function isCreatorDateToken_(value) {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(String(value || "").trim());
  if (!match) return false;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function plannerBeforeDateToken_(parts) {
  // 제작자까지 포함한 정식 파일명 레이아웃만 파싱한다. 짧은 레거시 이름은 추정하지 않는다.
  if (parts.length <= 13) return "";
  let dateIndex = -1;
  let dateCount = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!isCreatorDateToken_(parts[i])) continue;
    dateIndex = i;
    dateCount++;
  }
  if (dateCount !== 1 || dateIndex < 1) return "";
  return String(parts[dateIndex - 1] || "").trim();
}

function parseCreator_(name) {
  const result = { mk: "", pd: "" };
  const source = creatorSourceText_(name);
  if (!source || source.charAt(0) !== "[") return result;
  const parts = source.split("_");
  result.mk = plannerBeforeDateToken_(parts);
  if (parts.length > 13) {
    const tail = parts.slice(13).join("_").trim().replace(/\.(mp4|mov|png|jpe?g|gif|webp|zip|pdf)$/i, "");
    result.pd = (tail.split("_").pop() || "").trim().replace(/\s*\(\d+\)\s*$/, "").trim();
  }
  return result;
}

function isCreatorParseSource_(value) {
  const source = creatorSourceText_(value);
  return !!source && source.charAt(0) === "[";
}

function auditCreatorAssetIntegrity_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) {
    return { issue_count: 0, missing_planner_count: 0, missing_creator_count: 0, samples: [] };
  }
  const fieldCols = buildFieldCols_(sheet);
  const sourceCol = findHeaderCol_(sheet, ["소재명"]);
  const plannerCol = findHeaderCol_(sheet, ["기획자"]);
  const makerCol = findHeaderCol_(sheet, ["제작자", "PD", "디자이너"]);
  if (!sourceCol || !plannerCol || !makerCol) {
    return { issue_count: 0, missing_planner_count: 0, missing_creator_count: 0, samples: [] };
  }

  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
  const issues = [];
  const missingPlanners = [];
  const missingCreators = [];
  for (let i = 0; i < n; i++) {
    const row = CONFIG.DATA_START_ROW + i;
    const asset = String(values[i][sourceCol - 1] || "").trim();
    const planner = String(values[i][plannerCol - 1] || "").trim();
    const maker = String(values[i][makerCol - 1] || "").trim();
    const url = fieldCols.url ? String(values[i][fieldCols.url - 1] || "").trim() : "";
    if (isCreatorParseSource_(asset)) {
      const parsed = parseCreator_(asset);
      if (!planner && parsed.mk && isValidLinkedPersonName_(parsed.mk)) {
        missingPlanners.push({ row: row, expected: parsed.mk, asset: asset, url: url });
      }
      if (!maker && parsed.pd && isValidLinkedPersonName_(parsed.pd)) {
        missingCreators.push({ row: row, expected: parsed.pd, asset: asset, url: url });
      }
      continue;
    }
    if (!planner && !maker) continue;
    issues.push({ row: row, planner: planner, maker: maker, asset: asset, url: url });
  }

  const result = {
    issue_count: issues.length,
    missing_planner_count: missingPlanners.length,
    missing_creator_count: missingCreators.length,
    samples: issues.slice(0, 20).map(function(item) {
      return {
        row: item.row,
        planner: item.planner,
        maker: item.maker,
        asset: item.asset,
        url: item.url,
      };
    }),
    missing_planner_samples: missingPlanners.slice(0, 20),
    missing_creator_samples: missingCreators.slice(0, 20),
  };
  if (issues.length || missingPlanners.length || missingCreators.length) {
    Logger.log("creator_asset_integrity_issue " + JSON.stringify(result));
    SpreadsheetApp.getActive().toast(
      "오적재 " + issues.length + " · 기획자 빈칸 " + missingPlanners.length + " · 제작자 빈칸 " + missingCreators.length,
      "⚠️ 담당자 정합 점검",
      8
    );
  } else {
    Logger.log("creator_asset_integrity_ok " + JSON.stringify(result));
  }
  return result;
}

function auditCreatorAssetIntegrity() {
  return auditCreatorAssetIntegrity_();
}

function clearInvalidCreatorsWithBackup() {
  return withAutoWriteGuard_(function() {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) return { cleared: 0, remaining_creator_issues: 0 };
    const fieldCols = buildFieldCols_(sheet);
    const sourceCol = findHeaderCol_(sheet, ["소재명"]);
    const makerCol = findHeaderCol_(sheet, ["제작자", "PD", "디자이너"]);
    if (!fieldCols.url || !sourceCol || !makerCol) throw new Error("URL/소재명/제작자 열을 찾지 못했습니다.");

    const n = lastRow - CONFIG.DATA_START_ROW + 1;
    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
    const edits = [];
    const backupRows = [["row", "url", "asset_name", "creator_before"]];
    for (let i = 0; i < n; i++) {
      const row = CONFIG.DATA_START_ROW + i;
      const asset = String(values[i][sourceCol - 1] || "").trim();
      const maker = String(values[i][makerCol - 1] || "").trim();
      if (!maker) continue;
      if (isCreatorParseSource_(asset)) continue;
      const url = String(values[i][fieldCols.url - 1] || "").trim();
      backupRows.push([row, url, asset, maker]);
      edits.push({ row: row, value: "" });
    }

    if (!edits.length) {
      const result = { cleared: 0, remaining_creator_issues: 0 };
      Logger.log("clear_invalid_creators_result " + JSON.stringify(result));
      SpreadsheetApp.getActive().toast("정리할 제작자 오적재가 없습니다.", "완료", 4);
      return result;
    }

    const stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    const backupName = "_codex_invalid_creator_backup_" + stamp;
    const ss = SpreadsheetApp.getActive();
    const backup = ss.insertSheet(backupName);
    backup.getRange(1, 1, backupRows.length, backupRows[0].length).setValues(backupRows);
    backup.hideSheet();

    const expectedLastRow = sheet.getLastRow();
    const cleared = writeColumnRuns_(sheet, makerCol, edits, expectedLastRow);
    SpreadsheetApp.flush();

    const after = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
    let remaining = 0;
    for (let i = 0; i < n; i++) {
      const asset = String(after[i][sourceCol - 1] || "").trim();
      const maker = String(after[i][makerCol - 1] || "").trim();
      if (maker && !isCreatorParseSource_(asset)) remaining++;
    }
    const result = { cleared: cleared, backup_sheet: backupName, remaining_creator_issues: remaining };
    Logger.log("clear_invalid_creators_result " + JSON.stringify(result));
    SpreadsheetApp.getActive().toast(
      "제작자 오적재 " + cleared + "칸 정리 · 백업 " + backupName + " · 잔여 " + remaining + "건",
      "완료",
      8
    );
    return result;
  });
}

function clearInvalidPlannersWithBackup() {
  return withAutoWriteGuard_(function() {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) return { cleared: 0, remaining_planner_issues: 0 };
    const fieldCols = buildFieldCols_(sheet);
    const sourceCol = findHeaderCol_(sheet, ["소재명"]);
    const plannerCol = findHeaderCol_(sheet, ["기획자"]);
    if (!fieldCols.url || !sourceCol || !plannerCol) throw new Error("URL/소재명/기획자 열을 찾지 못했습니다.");

    const n = lastRow - CONFIG.DATA_START_ROW + 1;
    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
    const edits = [];
    const backupRows = [["row", "url", "asset_name", "planner_before"]];
    for (let i = 0; i < n; i++) {
      const row = CONFIG.DATA_START_ROW + i;
      const asset = String(values[i][sourceCol - 1] || "").trim();
      const planner = String(values[i][plannerCol - 1] || "").trim();
      if (!planner) continue;
      if (isCreatorParseSource_(asset)) continue;
      const url = String(values[i][fieldCols.url - 1] || "").trim();
      backupRows.push([row, url, asset, planner]);
      edits.push({ row: row, value: "" });
    }

    if (!edits.length) {
      const result = { cleared: 0, remaining_planner_issues: 0 };
      Logger.log("clear_invalid_planners_result " + JSON.stringify(result));
      SpreadsheetApp.getActive().toast("정리할 기획자 오적재가 없습니다.", "완료", 4);
      return result;
    }

    const stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    const backupName = "_codex_invalid_planner_backup_" + stamp;
    const ss = SpreadsheetApp.getActive();
    const backup = ss.insertSheet(backupName);
    backup.getRange(1, 1, backupRows.length, backupRows[0].length).setValues(backupRows);
    backup.hideSheet();

    const expectedLastRow = sheet.getLastRow();
    const cleared = writeColumnRuns_(sheet, plannerCol, edits, expectedLastRow);
    SpreadsheetApp.flush();

    const after = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, lastCol).getValues();
    let remaining = 0;
    for (let i = 0; i < n; i++) {
      const asset = String(after[i][sourceCol - 1] || "").trim();
      const planner = String(after[i][plannerCol - 1] || "").trim();
      if (planner && !isCreatorParseSource_(asset)) remaining++;
    }
    const result = { cleared: cleared, backup_sheet: backupName, remaining_planner_issues: remaining };
    Logger.log("clear_invalid_planners_result " + JSON.stringify(result));
    SpreadsheetApp.getActive().toast(
      "기획자 오적재 " + cleared + "칸 정리 · 백업 " + backupName + " · 잔여 " + remaining + "건",
      "완료",
      8
    );
    return result;
  });
}

function syncCreators() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const fieldCols = buildFieldCols_(sheet);
  const sourceCol = findHeaderCol_(sheet, ["소재명"]);
  const plannerCol = findHeaderCol_(sheet, ["기획자"]);
  const makerCol = findHeaderCol_(sheet, ["제작자", "PD", "디자이너"]);
  if (!fieldCols.url || !sourceCol || !plannerCol || !makerCol) return true;
  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const source = sheet.getRange(CONFIG.DATA_START_ROW, sourceCol, n, 1).getValues();
  const planners = sheet.getRange(CONFIG.DATA_START_ROW, plannerCol, n, 1).getValues();
  const makers = sheet.getRange(CONFIG.DATA_START_ROW, makerCol, n, 1).getValues();
  const plannerEdits = [];
  const makerEdits = [];
  let invalidPlannerSkipped = 0;
  let invalidMakerSkipped = 0;
  let nonFileNameSkipped = 0;
  for (let i = 0; i < n; i++) {
    const asset = String(source[i][0] || "").trim();
    if (!isCreatorParseSource_(asset)) {
      nonFileNameSkipped++;
      continue;
    }
    const parsed = parseCreator_(asset);
    if (parsed.mk) {
      if (isValidLinkedPersonName_(parsed.mk)) {
        const currentPlanner = planners[i][0];
        if ((currentPlanner === "" || currentPlanner == null) && currentPlanner !== parsed.mk) {
          plannerEdits.push({ row: CONFIG.DATA_START_ROW + i, value: parsed.mk });
        }
      }
      else invalidPlannerSkipped++;
    }
    if (parsed.pd) {
      if (isValidLinkedPersonName_(parsed.pd)) {
        const currentMaker = makers[i][0];
        if ((currentMaker === "" || currentMaker == null) && currentMaker !== parsed.pd) {
          makerEdits.push({ row: CONFIG.DATA_START_ROW + i, value: parsed.pd });
        }
      }
      else invalidMakerSkipped++;
    }
  }

  // 자기 행 소재명에서 파싱된 값만 자기 행의 빈칸에 쓴다. URL key 기반 전파 금지.
  const expectedLastRow = sheet.getLastRow();
  const plannerFilled = writeColumnRuns_(sheet, plannerCol, plannerEdits, expectedLastRow);
  const makerFilled = writeColumnRuns_(sheet, makerCol, makerEdits, expectedLastRow);
  SpreadsheetApp.flush();
  const audit = auditCreatorAssetIntegrity_();
  SpreadsheetApp.getActive().toast(
    "기획자/제작자 빈칸 채움: " + (plannerFilled + makerFilled) + "칸",
    "완료",
    4
  );
  const result = {
    planner_filled: plannerFilled,
    maker_filled: makerFilled,
    invalid_planner_skipped: invalidPlannerSkipped,
    invalid_maker_skipped: invalidMakerSkipped,
    non_file_name_skipped: nonFileNameSkipped,
    audit: audit,
  };
  Logger.log("syncCreators_result " + JSON.stringify(result));
  return result;
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
  const startedMs = Date.now();
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return true;
  const fieldCols = buildFieldCols_(sheet);
  if (!fieldCols.account_name || !fieldCols.channel_type || !fieldCols.company_name || !fieldCols.cost) return true;
  const pricing = getPricingSheet_();
  if (!pricing) throw new Error("가격/업체명 매핑 시트를 찾을 수 없습니다.");

  const n = lastRow - CONFIG.DATA_START_ROW + 1;
  const data = sheet.getRange(CONFIG.DATA_START_ROW, 1, n, sheet.getLastColumn()).getValues();
  const companyFormulas = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.company_name, n, 1).getFormulas();
  const costFormulas = sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.cost, n, 1).getFormulas();
  const accountLetter = colLetter_(fieldCols.account_name);
  const typeLetter = colLetter_(fieldCols.channel_type);
  const mapName = "'" + String(pricing.getName()).replace(/'/g, "''") + "'";
  const norm_ = (s) => 'REGEXREPLACE(REGEXREPLACE(LOWER(' + s + '),"\\s+",""),"_+","_")';
  const mapKeyRange = 'ARRAYFORMULA(' + norm_(mapName + '!$A$2:$A&' + mapName + '!$C$2:$C') + ')';
  const companyEdits = [];
  const costEdits = [];

  for (let r = 0; r < n; r++) {
    const row = data[r];
    const type = String(row[fieldCols.channel_type - 1] || "");
    const account = String(row[fieldCols.account_name - 1] || "").trim();
    const rowNum = CONFIG.DATA_START_ROW + r;
    const company = row[fieldCols.company_name - 1];
    const cost = row[fieldCols.cost - 1];

    if (type === "위성채널" || type === "온드미디어") {
      if ((company !== "" && company != null) || companyFormulas[r][0]) {
        companyEdits.push({ row: rowNum, value: "" });
      }
      if (cost === "" || cost == null || Number(cost) !== 0 || costFormulas[r][0]) {
        costEdits.push({ row: rowNum, value: 0 });
      }
      continue;
    }

    if (!account || type.indexOf("바이럴") < 0) continue;

    const formatExpr = 'IF(REGEXMATCH($' + typeLetter + rowNum + ',"배너"),"배너",IF(REGEXMATCH($'
      + typeLetter + rowNum + ',"영상|릴스|숏폼"),"릴스",""))';
    const lookupExpr = norm_('$' + accountLetter + rowNum + '&' + formatExpr);

    if ((company === "" || company == null) && !companyFormulas[r][0]) {
      companyEdits.push({
        row: rowNum,
        value: '=IFERROR(XLOOKUP(' + lookupExpr + ',' + mapKeyRange + ',' + mapName + '!$B$2:$B),"")',
      });
    }

    if ((cost === "" || cost == null) && !costFormulas[r][0]) {
      costEdits.push({
        row: rowNum,
        value: '=IFERROR(XLOOKUP(' + lookupExpr + ',' + mapKeyRange + ',' + mapName + '!$D$2:$D),"")',
      });
    }
  }

  // 계산 중 행 삽입/삭제가 있었으면 잘못된 행에 쓰지 않고 다음 실행으로 넘긴다.
  assertRowCountStable_(sheet, lastRow, "syncPricing");
  const companyRuns = countColumnRuns_(companyEdits);
  const costRuns = countColumnRuns_(costEdits);
  const filledCompany = writeColumnRuns_(sheet, fieldCols.company_name, companyEdits, lastRow);
  const filledCost = writeColumnRuns_(sheet, fieldCols.cost, costEdits, lastRow);
  const durationMs = Date.now() - startedMs;
  Logger.log("syncPricing_result " + JSON.stringify({
    duration_ms: durationMs,
    company_cells: filledCompany,
    company_runs: companyRuns,
    cost_cells: filledCost,
    cost_runs: costRuns,
  }));
  SpreadsheetApp.getActive().toast(
    "가격/업체명 배치 반영: 업체 " + filledCompany + ", 비용 " + filledCost
      + " · " + durationMs + "ms",
    "완료",
    5
  );
  return true;
}

const DATE_HEADER_FORMAT_ = "yy.m.d.(ddd)";

function dateFromHeaderValue_(value, fallbackYear) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  const text = String(value == null ? "" : value).trim();
  const ymd = text.match(/^(\d{2}|\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (ymd) {
    let year = Number(ymd[1]);
    if (year < 100) year += 2000;
    const month = Number(ymd[2]), day = Number(ymd[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return Utilities.parseDate(
        year + "-" + ("0" + month).slice(-2) + "-" + ("0" + day).slice(-2),
        CONFIG.KST_TIMEZONE,
        "yyyy-MM-dd"
      );
    }
  }
  const md = parseMonthDay_(value);
  if (!md) return null;
  return Utilities.parseDate(
    fallbackYear + "-" + ("0" + md.mo).slice(-2) + "-" + ("0" + md.da).slice(-2),
    CONFIG.KST_TIMEZONE,
    "yyyy-MM-dd"
  );
}

function fillInsertedDateHeadersOnChange_(e) {
  if (!e || e.changeType !== "INSERT_COLUMN") return;
  const ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (!sheet || sheet.getSheetId() !== CONFIG.SHEET_GID) return;

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const statusCol = headers.findIndex(function(value) {
    return norm_(value) === norm_(CONFIG.STATUS_HEADER);
  }) + 1;
  if (!statusCol) return;

  let lastDateCol = statusCol - 1;
  while (lastDateCol >= LINKED_INPUT_FIRST_DATE_COL_
    && String(headers[lastDateCol - 1] == null ? "" : headers[lastDateCol - 1]).trim() === "") {
    lastDateCol--;
  }
  const insertedCount = statusCol - lastDateCol - 1;
  if (insertedCount <= 0) return;

  let year = CONFIG.STATS_START_YEAR, previousMonth = null, lastDate = null;
  for (let col = LINKED_INPUT_FIRST_DATE_COL_; col <= lastDateCol; col++) {
    const value = headers[col - 1];
    const parsed = dateFromHeaderValue_(value, year);
    if (!parsed) continue;
    const month = parsed.getMonth() + 1;
    if (!(value instanceof Date) && previousMonth !== null && month < previousMonth) {
      year++;
      lastDate = dateFromHeaderValue_(value, year);
    } else {
      lastDate = parsed;
      year = parsed.getFullYear();
    }
    previousMonth = month;
  }
  if (!lastDate) return;

  const nextDates = [];
  for (let i = 1; i <= insertedCount; i++) nextDates.push(new Date(lastDate.getTime() + i * 86400000));
  sheet.getRange(CONFIG.HEADER_ROW, lastDateCol + 1, 1, insertedCount)
    .setValues([nextDates])
    .setNumberFormat(DATE_HEADER_FORMAT_);
  applyDateInputValidation_(sheet, lastDateCol + 1, insertedCount);
  if (typeof styleLinkedSheetDateColumns_ === "function") {
    styleLinkedSheetDateColumns_(sheet, lastDateCol + 1, insertedCount);
  }
  repairStaleMetricFormulaRanges_(sheet);
}

function fillInsertedDateHeadersOnChange(e) {
  return fillInsertedDateHeadersOnChange_(e);
}

function ensureDateHeaderChangeTrigger_() {
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === "fillInsertedDateHeadersOnChange";
  });
  triggers.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  if (triggers.length) return false;
  ScriptApp.newTrigger("fillInsertedDateHeadersOnChange")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onChange()
    .create();
  return true;
}

function installDateHeaderChangeTrigger() {
  const created = ensureDateHeaderChangeTrigger_();
  safeAlert_(created
    ? "✅ 우측 날짜열 자동 생성 기능을 켰습니다."
    : "✅ 우측 날짜열 자동 생성 기능이 이미 켜져 있습니다.");
}

// ═══════════════════════════════════════════════════════════════
// GitHub 스케줄 하트비트 — 구글(Apps Script) 시간 트리거가 호출한다.
// 2026-07-30 사고: GitHub Actions 스케줄이 두 repo 모두 전면 정지했는데, 감시자(cron-watchdog)도
// 같은 GitHub 스케줄러에 실려 있어 경보가 못 떴다(사람이 먼저 발견). 감시자는 반드시 다른
// 제공자의 스케줄러에서 돌아야 하므로, 구글 트리거가 Vercel 라우트를 호출해 판정·Slack 통보한다.
// 이상 없으면 조용하고, 미발화/주기초과·조회실패일 때만 Slack이 온다.
// ═══════════════════════════════════════════════════════════════
function scheduleHeartbeat() {
  const res = UrlFetchApp.fetch(CONFIG.SCHEDULE_HEARTBEAT_URL, {
    method: "post",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log("[scheduleHeartbeat] HTTP " + code + " " + body.slice(0, 500));
  if (code !== 200) {
    // 라우트 자체가 죽은 경우도 침묵하면 안 되니 로그에 남기고 실패로 끝낸다(트리거 실패 기록됨).
    throw new Error("scheduleHeartbeat HTTP " + code + ": " + body.slice(0, 200));
  }
  return true;
}

function installScheduleHeartbeatTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "scheduleHeartbeat")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("scheduleHeartbeat").timeBased().everyHours(2).create();
  safeAlert_("✅ GitHub 스케줄 하트비트(2시간 간격, 구글 트리거)를 설치했습니다.");
}

function removeScheduleHeartbeatTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "scheduleHeartbeat");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_("스케줄 하트비트 트리거를 제거했습니다. (" + triggers.length + "개)");
}

// 자정수집 폴백 — 구글 트리거가 새벽 05:00 KST에 호출한다(GitHub의 00:41·02:41·04:41 시도 이후).
// 그날 자동수집 행이 비어 있을 때만 서버가 Apify 폴백을 시작하므로, GitHub 수집이 정상이면 무동작이다.
// (2026-07-30 GitHub 스케줄 전면 정지 사고 대비 — 데이터가 비는 것을 원천 차단)
function collectFallback() {
  const res = UrlFetchApp.fetch(CONFIG.COLLECT_FALLBACK_URL, {
    method: "post",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log("[collectFallback] HTTP " + code + " " + body.slice(0, 500));
  if (code !== 200) throw new Error("collectFallback HTTP " + code + ": " + body.slice(0, 200));
  return true;
}

function installCollectFallbackTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "collectFallback")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("collectFallback").timeBased().atHour(5).everyDays(1).create();
  safeAlert_("✅ 자정수집 폴백 트리거(매일 05시 KST, 구글 스케줄러)를 설치했습니다.");
}

function removeCollectFallbackTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "collectFallback");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_("자정수집 폴백 트리거를 제거했습니다. (" + triggers.length + "개)");
}

// 아침 감사 보장 — GitHub cron이 늦거나 누락되면 수식감사·제작자감사를 직접 dispatch한다.
// 서버가 KST 오늘의 성공 실행을 먼저 확인하므로 정상 발화한 워크플로는 중복 실행하지 않는다.
function ensureDailyAudits() {
  const res = UrlFetchApp.fetch(CONFIG.ENSURE_DAILY_AUDITS_URL, {
    method: "post",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log("[ensureDailyAudits] HTTP " + code + " " + body.slice(0, 500));
  if (code !== 200) throw new Error("ensureDailyAudits HTTP " + code + ": " + body.slice(0, 200));
  return true;
}

// 기존 설치형 트리거가 교체 전 잠깐 실행돼도 새 통합 경로를 사용한다.
function auditFallback() {
  return ensureDailyAudits();
}

function installEnsureDailyAuditsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => ["auditFallback", "ensureDailyAudits"].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("ensureDailyAudits")
    .timeBased()
    .atHour(9)
    .nearMinute(40)
    .everyDays(1)
    .create();
  safeAlert_("✅ 아침 감사 보장 트리거(매일 09:40 KST 전후)를 설치했습니다.\n수식·제작자감사 중 오늘 성공한 작업은 건너뜁니다.");
}

function installAuditFallbackTrigger() {
  return installEnsureDailyAuditsTrigger();
}

// 리포트 결과 워치독 — GitHub cron이 일일 증분 리포트 발송을 누락하면 서버가 직접 dispatch한다.
// 서버가 KST 오늘의 성공 실행을 먼저 확인하므로 정상 발송된 날은 무동작(중복 발송 없음).
function ensureDailyReport() {
  const res = UrlFetchApp.fetch(CONFIG.ENSURE_DAILY_REPORT_URL, {
    method: "post",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log("[ensureDailyReport] HTTP " + code + " " + body.slice(0, 500));
  if (code !== 200) throw new Error("ensureDailyReport HTTP " + code + ": " + body.slice(0, 200));
  return true;
}

// 다중화 트리거 2개(GitHub 크론 불안정 대비 — 시각은 구글이 보장):
//   ① 정시 12:35 KST — GHA 크론이 안 돌았으면 즉시 발송(정시 도달). 돌았으면 무동작.
//   ② 백업 16:10 KST — 그때까지도 안 나갔으면 최후 발송. (둘 다 DEDUP으로 중복 방지)
function installEnsureDailyReportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "ensureDailyReport")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("ensureDailyReport")
    .timeBased().atHour(12).nearMinute(35).everyDays(1).create();  // 정시
  ScriptApp.newTrigger("ensureDailyReport")
    .timeBased().atHour(16).nearMinute(10).everyDays(1).create();  // 백업
  safeAlert_("✅ 리포트 발송 보장 트리거 2개(매일 12:35·16:10 KST 전후)를 설치했습니다.\n그 시각까지 오늘 리포트가 안 나갔으면 자동 발송합니다(이미 나간 날은 무동작, DEDUP으로 중복 없음).");
}

function removeEnsureDailyReportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "ensureDailyReport")
    .forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_("리포트 발송 보장 트리거를 제거했습니다.");
}

function removeEnsureDailyAuditsTrigger() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => ["auditFallback", "ensureDailyAudits"].indexOf(t.getHandlerFunction()) >= 0);
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  safeAlert_("아침 감사 보장 트리거를 제거했습니다. (" + triggers.length + "개)");
}

function removeAuditFallbackTrigger() {
  return removeEnsureDailyAuditsTrigger();
}

function installDailyTrigger() {
  // 기존 트리거(구버전 syncNew·남은 1회 재시도 포함) 제거 후 일일 작업과 DB→시트 독립 동기화를 재등록
  ScriptApp.getProjectTriggers()
    .filter(t => ["syncNew", "dailyAuto", "dailyAutoRetry_", "exportStatsAfterCollection_", "scheduledDbPullSync_", "dbPullSyncRetry_", "dbPullSyncWatchdog_"].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteProperty("DAILY_AUTO_RETRY_PENDING_JSON");
  PropertiesService.getScriptProperties().deleteProperty(EXPORT_STATS_GATE_PENDING_PROP_);
  PropertiesService.getScriptProperties().deleteProperty("DB_PULL_SYNC_PENDING_JSON");
  PropertiesService.getScriptProperties().setProperty("AUTO_SYNC_ENABLED", "true");
  ensureDateHeaderChangeTrigger_();
  applyLinkedSheetInputValidation_();

  ScriptApp.newTrigger("dailyAuto")
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .nearMinute(CONFIG.TRIGGER_MINUTE)
    .create();

  // 자정 수집(00:41 KST) 직전(자정~오전 1시 창)에 당일 신규 행을 DB에 등록해 수집 누락을 막는다.
  // (2026-07-24 사용자 지시로 23시→자정 00:00으로 이동. 라이브 트리거는 트리거 UI로 이미 00:00 반영.)
  ScriptApp.newTrigger("syncNew")
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .create();

  installDbPullSyncTrigger_();

  safeAlert_(`✅ 자동 동기화를 켰습니다.\n• 3시간 간격: DB→시트 신규글 반영(실패 시 1회 재시도)\n• 매일 자정(00:00~01:00): 신규 광고 syncNew\n• 매일 오전 ${CONFIG.TRIGGER_HOUR}:${CONFIG.TRIGGER_MINUTE} (±15분): 나머지 일일 작업\n• 12:20 리포트 전에 분류 동기화`);
}

function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => ["syncNew", "dailyAuto", "dailyAutoRetry_", "exportStatsAfterCollection_", "scheduledDbPullSync_", "dbPullSyncRetry_", "dbPullSyncWatchdog_"].indexOf(t.getHandlerFunction()) >= 0);
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteProperty("DAILY_AUTO_RETRY_PENDING_JSON");
  PropertiesService.getScriptProperties().deleteProperty(EXPORT_STATS_GATE_PENDING_PROP_);
  PropertiesService.getScriptProperties().deleteProperty("DB_PULL_SYNC_PENDING_JSON");
  PropertiesService.getScriptProperties().setProperty("AUTO_SYNC_ENABLED", "false");
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

// 2026-08-25 영상 포함 매거진 캐러셀 4건을 명시적 배너(도달수)로 전환한다.
// Script Execution API 전용. URL·계정·게시일·8/10 값·행 수를 모두 확인하고 D열만 바꾼 뒤,
// 같은 4건만 bulk + stats-import로 전송한다. 행번호를 소스로 쓰지 않아 정렬·행삽입에도 안전하다.
function repairMagazineCarouselBanner20260825(payload) {
  const SIGNATURE = "magazine-carousel-banner-2026-08-25";
  const EXPECTED_SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
  const MEASURED_AT = "2026-08-10";
  const OLD_TYPE = "협찬 (파워채널/매거진)";
  const NEW_TYPE = "협찬 (파워채널/매거진 배너)";
  const BACKUP_SHEET_NAME = "_codex_magazine_banner_backup_20260825";
  const TARGETS = [
    { key: "ig:DbutARtkWS8", account: "오늘의 메뉴", posted_at: "2026-08-07", value: 45795 },
    { key: "ig:Dbu3SZMEkue", account: "millionego", posted_at: "2026-08-07", value: 74236 },
    { key: "ig:DbxEAhCE2vR", account: "띵크서울", posted_at: "2026-08-08", value: 27438 },
    { key: "ig:Db0ERW8Gqsr", account: "요매거진", posted_at: "2026-08-09", value: 66920 },
  ];
  const normalizeText = value => String(value == null ? "" : value).trim();
  const normalizeType = value => normalizeText(value).replace(/\s+\(/g, "(");
  const normalizeAccount = value => normalizeText(value).toLowerCase().replace(/[\s._·-]/g, "");

  if (!payload || payload.signature !== SIGNATURE) throw new Error("매거진 배너 전환 서명이 올바르지 않습니다.");
  if (payload.apply !== true && payload.apply !== false) throw new Error("apply는 true/false여야 합니다.");

  const sheet = getSheet_();
  const ss = sheet.getParent();
  if (ss.getId() !== EXPECTED_SHEET_ID) throw new Error("매거진 배너 전환 대상 스프레드시트가 아닙니다.");
  const fieldCols = buildFieldCols_(sheet);
  if (!fieldCols.url || !fieldCols.channel_type || !fieldCols.account_name || !fieldCols.posted_at) {
    throw new Error("업로드일/게시물URL/채널명/채널분류 헤더가 없습니다.");
  }
  const hCol = findHeaderCol_(sheet, ["누적 조회수", "누적조회수"]);
  const iCol = findHeaderCol_(sheet, ["증분값", "증분"]);
  if (!hCol || !iCol) throw new Error("누적 조회수/증분값 헤더가 없습니다.");
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const dateMatches = [];
  for (let col = iCol + 1; col <= lastCol; col++) {
    const date = dateFromHeaderValue_(headers[col - 1], CONFIG.STATS_START_YEAR);
    if (date && Utilities.formatDate(date, CONFIG.KST_TIMEZONE, "yyyy-MM-dd") === MEASURED_AT) dateMatches.push(col);
  }
  if (dateMatches.length !== 1) throw new Error(`8/10 날짜 열이 유일하지 않습니다. count=${dateMatches.length}`);
  const dateCol = dateMatches[0];

  function readTargets_() {
    const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getValues();
    const formulas = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getFormulas();
    const byKey = {};
    values.forEach((row, index) => {
      const key = linkKey_(row[fieldCols.url - 1]);
      if (!TARGETS.some(target => target.key === key)) return;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({ row: CONFIG.DATA_START_ROW + index, values: row, formulas: formulas[index] });
    });
    return TARGETS.map(target => {
      const matches = byKey[target.key] || [];
      if (matches.length !== 1) throw new Error(`대상 URL 매칭이 유일하지 않습니다. key=${target.key}, count=${matches.length}`);
      const found = matches[0];
      const account = normalizeText(found.values[fieldCols.account_name - 1]);
      const postedAt = toDateStr_(found.values[fieldCols.posted_at - 1]);
      const currentType = normalizeText(found.values[fieldCols.channel_type - 1]);
      const metric = toNumber_(found.values[dateCol - 1]);
      if (normalizeAccount(account) !== normalizeAccount(target.account)) throw new Error(`채널명이 다릅니다. key=${target.key}`);
      if (postedAt !== target.posted_at) throw new Error(`게시일이 다릅니다. key=${target.key}, actual=${postedAt}`);
      if (normalizeType(currentType) !== normalizeType(OLD_TYPE) && normalizeType(currentType) !== normalizeType(NEW_TYPE)) {
        throw new Error(`채널분류가 예상 범위를 벗어났습니다. key=${target.key}, actual=${currentType}`);
      }
      if (metric !== target.value) throw new Error(`8/10 값이 다릅니다. key=${target.key}, actual=${metric}`);
      const post = { url: normalizeText(found.values[fieldCols.url - 1]), channel_type: NEW_TYPE };
      if (fieldCols.posted_at) post.posted_at = postedAt;
      if (fieldCols.account_name) post.account_name = account || null;
      if (fieldCols.company_name) post.company_name = normalizeText(found.values[fieldCols.company_name - 1]) || null;
      if (fieldCols.content_summary) post.content_summary = normalizeText(found.values[fieldCols.content_summary - 1]) || null;
      if (fieldCols.asset_name) post.asset_name = normalizeText(found.values[fieldCols.asset_name - 1]) || null;
      if (fieldCols.project_name) post.project_name = normalizeText(found.values[fieldCols.project_name - 1]) || null;
      if (fieldCols.product_name) post.product_name = normalizeText(found.values[fieldCols.product_name - 1]) || null;
      if (fieldCols.planner) post.planner = normalizeText(found.values[fieldCols.planner - 1]) || null;
      if (fieldCols.creator) post.creator = normalizeText(found.values[fieldCols.creator - 1]) || null;
      if (fieldCols.cost) post.cost = toNumber_(found.values[fieldCols.cost - 1]);
      return {
        key: target.key, row: found.row, url: post.url, account_name: account, posted_at: postedAt,
        old_type: currentType, new_type: NEW_TYPE, measured_at: MEASURED_AT, value: metric,
        h_value: found.values[hCol - 1], i_value: found.values[iCol - 1],
        h_formula: found.formulas[hCol - 1], i_formula: found.formulas[iCol - 1], post: post,
      };
    });
  }

  const before = readTargets_();
  const dryRun = {
    ok: true, mode: payload.apply ? "apply-ready" : "dry-run", matched: before.length,
    changes: before.filter(item => normalizeType(item.old_type) !== normalizeType(NEW_TYPE)).length,
    channel_type_column: colLetter_(fieldCols.channel_type), metric_column: colLetter_(dateCol), measured_at: MEASURED_AT,
    targets: before.map(item => ({
      key: item.key, row: item.row, url: item.url, account_name: item.account_name, posted_at: item.posted_at,
      old_type: item.old_type, new_type: item.new_type, value: item.value, h_value: item.h_value, i_value: item.i_value,
      h_formula: item.h_formula, i_formula: item.i_formula,
    })),
  };
  if (!payload.apply) return dryRun;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    assertRowCountStable_(sheet, lastRow, "repairMagazineCarouselBanner20260825");
    const locked = readTargets_();
    let backup = ss.getSheetByName(BACKUP_SHEET_NAME);
    if (!backup) {
      backup = ss.insertSheet(BACKUP_SHEET_NAME);
      const backupValues = [["signature", "sheet_row", "url", "account_name", "posted_at", "old_type", "new_type", "measured_at", "value", "h_value", "i_value", "h_formula", "i_formula"]]
        .concat(locked.map(item => [SIGNATURE, item.row, item.url, item.account_name, item.posted_at, item.old_type, item.new_type, item.measured_at, item.value, item.h_value, item.i_value, item.h_formula, item.i_formula]));
      backup.getRange(1, 1, backupValues.length, backupValues[0].length).setValues(backupValues);
      backup.hideSheet();
    } else if (backup.getLastRow() !== TARGETS.length + 1 || normalizeText(backup.getRange(2, 1).getValue()) !== SIGNATURE) {
      throw new Error("기존 매거진 배너 백업 탭이 예상과 다릅니다.");
    }

    locked.forEach(item => {
      const cell = sheet.getRange(item.row, fieldCols.channel_type);
      const rule = cell.getDataValidation();
      if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
        const args = rule.getCriteriaValues();
        const choices = (args[0] || []).slice();
        if (choices.indexOf(NEW_TYPE) === -1) choices.push(NEW_TYPE);
        cell.setDataValidation(rule.copy().withCriteria(SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST, [choices, args[1]]).build());
      }
      cell.setValue(NEW_TYPE);
    });
    SpreadsheetApp.flush();
    const afterSheet = readTargets_();
    afterSheet.forEach((item, index) => {
      if (normalizeType(item.old_type) !== normalizeType(NEW_TYPE)) throw new Error(`채널분류 저장 검증 실패: ${item.key}`);
      if (item.value !== before[index].value || item.h_formula !== before[index].h_formula || item.i_formula !== before[index].i_formula) {
        throw new Error(`조회수·누적·증분 셀이 바뀌어 중단했습니다: ${item.key}`);
      }
    });

    const posts = afterSheet.map(item => item.post);
    const bulkResponse = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: "post", contentType: "application/json", headers: authHeaders_(),
      payload: JSON.stringify(posts), muteHttpExceptions: true,
    });
    const bulkBody = bulkResponse.getContentText();
    if (bulkResponse.getResponseCode() !== 200) throw new Error(`bulk API ${bulkResponse.getResponseCode()}: ${bulkBody}`);
    const bulk = JSON.parse(bulkBody);
    if (!bulk.ok || bulk.upserted !== TARGETS.length || bulk.locked_drift) throw new Error(`bulk 정합 실패: ${bulkBody}`);

    const statsResponse = UrlFetchApp.fetch(CONFIG.STATS_API_URL, {
      method: "post", contentType: "application/json", headers: authHeaders_(),
      payload: JSON.stringify({
        client_version: IMPORTSTATS_CLIENT_VERSION, source: "manual_sheet", posts: posts,
        stats: afterSheet.map(item => ({ url: item.url, measured_at: MEASURED_AT, play_count: item.value })),
      }),
      muteHttpExceptions: true,
    });
    const statsBody = statsResponse.getContentText();
    if (statsResponse.getResponseCode() !== 200) throw new Error(`stats API ${statsResponse.getResponseCode()}: ${statsBody}`);
    const stats = JSON.parse(statsBody);
    const verifiedRows = Array.isArray(stats.banner_reach_verified_sample) ? stats.banner_reach_verified_sample : [];
    const expectedReach = TARGETS.map(target => target.value).sort((a, b) => a - b);
    const actualReach = verifiedRows.map(row => Number(row.reach_count)).sort((a, b) => a - b);
    const verifiedShape = verifiedRows.length === TARGETS.length && verifiedRows.every(row =>
      row.play_count === null && row.measured_at === MEASURED_AT && Number(row.reach_count) > 0
    ) && JSON.stringify(actualReach) === JSON.stringify(expectedReach);
    if (!stats.ok || stats.matched_urls !== TARGETS.length || stats.missing_urls !== 0 || stats.banner_reach_inserted !== TARGETS.length || stats.banner_reach_verified !== TARGETS.length || !verifiedShape || stats.inserted !== 0) {
      throw new Error(`도달수 전환 정합 실패: ${statsBody}`);
    }
    return {
      ok: true, mode: "apply", matched: TARGETS.length, written: dryRun.changes, verified: afterSheet.length,
      backup_sheet: BACKUP_SHEET_NAME,
      bulk: { upserted: bulk.upserted, meta_filled: bulk.meta_filled, locked_drift: bulk.locked_drift },
      stats: {
        inserted: stats.inserted,
        banner_reach_inserted: stats.banner_reach_inserted,
        banner_reach_verified: stats.banner_reach_verified,
        banner_reach_verified_sample: verifiedRows,
        matched_urls: stats.matched_urls,
      },
      targets: afterSheet.map(item => ({ key: item.key, row: item.row, url: item.url, value: item.value })),
    };
  } finally {
    lock.releaseLock();
  }
}

function repairMagazineCarouselBanner20260825DryRun() {
  const result = repairMagazineCarouselBanner20260825({ signature: "magazine-carousel-banner-2026-08-25", apply: false });
  Logger.log(JSON.stringify(result));
  return result;
}

function repairMagazineCarouselBanner20260825Apply() {
  const result = repairMagazineCarouselBanner20260825({ signature: "magazine-carousel-banner-2026-08-25", apply: true });
  Logger.log(JSON.stringify(result));
  return result;
}
