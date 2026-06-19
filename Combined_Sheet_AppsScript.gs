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
  API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/bulk",
  STATS_API_URL: "https://influencer-seeding-mu.vercel.app/api/sponsored-posts/stats-import",
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
  "캡션": "content_summary",
  "채널분류": "channel_type",
  "프로젝트명": "project_name",
  "상품명": "product_name",
  "비용": "cost",
};

// 사이트가 허용하는 URL (인스타 / 유튜브 / 틱톡 / 페이스북 / 스레드, 서브도메인 포함). 서버 필터와 동일.
const ALLOWED_URL_RE = /^https:\/\/([a-z0-9-]+\.)?(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net)\//i;

// 필드 → 표시용 컬럼명 (빈칸 검사 보고용)
const FIELD_LABEL = {
  posted_at: "업로드일", url: "게시물URL", account_name: "채널명", content_summary: "캡션",
  channel_type: "채널 분류", project_name: "프로젝트명", product_name: "상품명", cost: "비용",
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
    .addItem("📊 일자별 조회수 입력 (I~AE열)", "importStats")
    .addItem("♻️ 전체 다시 추가", "syncAll")
    .addSeparator()
    .addItem("🔎 빈칸 검사 (A~H)", "checkBlanks")
    .addItem("🔁 중복 URL 검사", "checkDuplicates")
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

/** 스크립트 시간대 기준 오늘 (YYYY-MM-DD). 업로드일이 이보다 크면 미래 = 아직 게시 전. */
function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
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
    if (fieldCols.content_summary) obj.content_summary = String(row[fieldCols.content_summary - 1] || "").trim() || null;
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
  return String(u).split("?")[0].replace(/\/+$/, "").toLowerCase();
}

function noteExtra_(skipped, dupCount, future) {
  let s = "";
  if (dupCount) s += `\n\n🔁 시트 내 중복 URL ${dupCount}건은 1건으로 합쳐 전송(중복 추가 방지).`;
  if (future)   s += `\n⏭️ 업로드일이 오늘 이후인 행 ${future}건 제외(아직 게시 전).`;
  if (skipped)  s += `\n⚠️ 지원 플랫폼(IG/YT/TikTok/FB/Threads) URL이 아니어서 제외됨: ${skipped}건`;
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
  const fields = Object.keys(fieldCols);
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
      return;
    }
    const { count, ended, filled } = postRows_(rows);
    markRegistered_(getSheet_(), statusCol, rowNums);
    let okMsg = `✅ ${count}개 광고를 사이트에 반영했습니다.`;
    if (filled) okMsg += `\n📝 기존 광고의 빈 항목 ${filled}건을 시트 값으로 채움(채널 분류·비용 등).`;
    if (ended) okMsg += `\n🛑 캡션 '삭제/보관' ${ended}건 → '종료' 처리됨.`;
    safeAlert_(okMsg + noteExtra_(skipped, dupCount, future) + blankNote_());
  } catch (e) {
    safeAlert_("❌ 오류\n" + e.message);
    Logger.log(e.stack || e.message);
  }
}

function syncNew()  { runSync_(true); }
function syncAll()  { runSync_(false); }

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
        if (fieldCols.content_summary) p.content_summary = String(row[fieldCols.content_summary - 1] || "").trim() || null;
        if (fieldCols.channel_type)    p.channel_type    = String(row[fieldCols.channel_type - 1] || "").trim() || null;
        if (fieldCols.project_name)    p.project_name    = String(row[fieldCols.project_name - 1] || "").trim() || null;
        if (fieldCols.product_name)    p.product_name    = String(row[fieldCols.product_name - 1] || "").trim() || null;
        if (fieldCols.cost)            p.cost            = toNumber_(row[fieldCols.cost - 1]);
        postByKey[key] = p;
      }

      dateCols.forEach(dc => {
        const n = toNumber_(row[dc.col - 1]);
        if (n === null) return; // 빈칸/비숫자 → 측정 없음, 스킵
        stats.push({ url: url, measured_at: dc.date, play_count: n });
      });
    });

    if (stats.length === 0) { safeAlert_("입력할 조회수 데이터가 없습니다."); return; }

    const posts = Object.keys(postByKey).map(k => postByKey[k]);
    const res = postStats_({ posts: posts, stats: stats });
    let msg = `✅ 일자별 조회수 ${res.inserted}건 입력 완료.\n(날짜 ${dateCols.length}개 열 · 매칭 게시물 ${res.matched_urls}개`;
    msg += res.created_posts ? ` · 신규 광고 ${res.created_posts}개 자동 생성)` : `)`;
    if (res.meta_filled) msg += `\n📝 기존 광고의 빈 항목 ${res.meta_filled}건을 시트 값으로 채움(채널 분류 등).`;
    if (res.ended_marked) msg += `\n🛑 캡션 '삭제/보관' ${res.ended_marked}건 → '종료' 처리됨.`;
    if (future) msg += `\n⏭️ 업로드일이 오늘 이후인 행 ${future}건 제외(아직 게시 전).`;
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
    safeAlert_(`✅ 설정 정상\n탭: ${sheet.getName()}\n인식된 필드: ${Object.keys(fieldCols).join(", ")}`);
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

// ═══════════════════════════════════════════════════════════════
// 💻 배너 인사이트 요청 — 업체별 채널 조회 (기존 기능)
// ═══════════════════════════════════════════════════════════════
function summarizeByCompany() {
  const ws = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  const DATA_START  = 10;
  const COL_CHANNEL = 7;
  const COL_URL     = 9;
  const COL_COMPANY = 10;

  const lastRow = ws.getLastRow();
  const allRows = ws.getRange(DATA_START, 1, lastRow - DATA_START + 1, COL_COMPANY).getValues();

  const companyMap = {};

  for (const row of allRows) {
    const colA    = String(row[0]).trim();
    const colD    = String(row[3]).trim();
    const company = String(row[COL_COMPANY - 1]).trim();
    const channel = String(row[COL_CHANNEL - 1]).trim();
    const url     = String(row[COL_URL - 1]).trim();

    if (colA.includes('X')) continue;
    if (!colD.includes('배너')) continue;
    if (!company || company === 'undefined') continue;

    if (!companyMap[company]) companyMap[company] = {};
    if (!companyMap[company][channel]) companyMap[company][channel] = new Set();
    if (url && url !== 'undefined') companyMap[company][channel].add(url);
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
