/**
 * ═══════════════════════════════════════════════════════════════
 * 마케팅 데이터 → 협찬 모니터링 자동 동기화
 * (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════
 *
 * 기능:
 * - 마케팅 대시보드의 데이터를 협찬 모니터링 DB에 자동 추가
 * - Vercel API를 통해 Supabase에 저장
 * - 매일 자정에 자동 실행 (주말 포함)
 * - 중복 데이터 필터링
 *
 * 설정:
 * 1. 프로젝트 설정 → 스크립트 속성
 * 2. 속성 추가: VERCEL_CRON_SECRET = lala2024secret
 * 3. 트리거 설정: 매일 자정 실행
 */

// ═══════════════════════════════════════════════════════════════
// 📋 설정 (CONFIG)
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // 마케팅 대시보드 시트
  MARKETING_SHEET_ID: "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak",
  MARKETING_SHEET_GID: 1937186871,
  MARKETING_DATA_RANGE: "A:H",  // 모든 데이터 범위

  // Vercel API (협찬 모니터링)
  VERCEL_URL: "https://influencer-seeding-mu.vercel.app/api/marketing/sync",
};

// ═══════════════════════════════════════════════════════════════
// 🔐 보안: PropertiesService에서 시크릿 읽기
// ═══════════════════════════════════════════════════════════════

/**
 * Vercel Cron Secret 가져오기
 */
function getCronSecret() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("VERCEL_CRON_SECRET");

  if (!secret) {
    const msg = `
❌ VERCEL_CRON_SECRET이 설정되지 않았습니다.

[설정 방법]
1. 좌측 메뉴: 프로젝트 설정 클릭
2. "스크립트 속성" 섹션 → "속성 추가"
3. 입력:
   - 속성: VERCEL_CRON_SECRET
   - 값: lala2024secret
4. 저장 클릭
5. Google Sheets 새로고침 후 메뉴 다시 시도
    `;
    Logger.log(msg);
    throw new Error("VERCEL_CRON_SECRET not configured");
  }

  return secret;
}

// ═══════════════════════════════════════════════════════════════
// 📊 데이터 읽기: 마케팅 시트
// ═══════════════════════════════════════════════════════════════

/**
 * 마케팅 시트에서 데이터 읽기
 * 컬럼: 업로드일, 게시물URL, 캡션, 성과, 채널분류, 프로젝트명, 상품명, 비용
 */
function readMarketingData() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MARKETING_SHEET_ID);
    const sheet = ss.getSheets().find(s => s.getSheetId() === CONFIG.MARKETING_SHEET_GID);

    if (!sheet) {
      throw new Error(`Sheet with GID ${CONFIG.MARKETING_SHEET_GID} not found`);
    }

    const data = sheet.getRange(CONFIG.MARKETING_DATA_RANGE).getValues();

    // 헤더 행 (첫 번째 행)
    const [headerRow, ...dataRows] = data;

    Logger.log(`[LOG] 헤더: ${headerRow.join(", ")}`);
    Logger.log(`[LOG] 데이터 행: ${dataRows.length}개`);

    // 헤더 매핑
    const headers = {
      uploadDate: headerRow.indexOf("업로드일"),
      url: headerRow.indexOf("게시물URL"),
      caption: headerRow.indexOf("캡션"),
      performance: headerRow.indexOf("성과"),  // 여러 컬럼일 수 있음
      channel: headerRow.indexOf("채널분류"),
      projectName: headerRow.indexOf("프로젝트명"),
      productName: headerRow.indexOf("상품명"),
      cost: headerRow.indexOf("비용"),
    };

    // 데이터 변환
    const records = [];
    for (const row of dataRows) {
      // 빈 행 건너뛰기
      if (!row[headers.url] || !row[headers.url].toString().trim()) {
        continue;
      }

      records.push({
        posted_at: row[headers.uploadDate] ? new Date(row[headers.uploadDate]).toISOString().split('T')[0] : null,
        url: String(row[headers.url] || "").trim(),
        caption: String(row[headers.caption] || "").trim(),
        channel: String(row[headers.channel] || "").trim(),
        project_name: String(row[headers.projectName] || "").trim(),
        product_name: String(row[headers.productName] || "").trim(),
        cost: row[headers.cost] ? Number(row[headers.cost]) : null,
      });
    }

    Logger.log(`[LOG] 처리된 레코드: ${records.length}개`);
    return records;

  } catch (error) {
    throw new Error(`마케팅 데이터 읽기 실패: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 Vercel API로 데이터 동기화
// ═══════════════════════════════════════════════════════════════

/**
 * Vercel API로 마케팅 데이터 동기화
 */
function syncToVercel(records) {
  const secret = getCronSecret();

  const payload = {
    data: records,
    sync_timestamp: new Date().toISOString(),
    record_count: records.length,
  };

  try {
    Logger.log(`[LOG] Vercel API 호출 시작... (${records.length}개 레코드)`);

    const response = UrlFetchApp.fetch(CONFIG.VERCEL_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();

    Logger.log(`[API Response] ${statusCode}`);
    Logger.log(`[Response Body] ${content}`);

    if (statusCode !== 200) {
      throw new Error(`API returned ${statusCode}: ${content}`);
    }

    return { statusCode, content, recordCount: records.length };

  } catch (error) {
    throw new Error(`Vercel API 호출 실패: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔄 메인 동기화 함수
// ═══════════════════════════════════════════════════════════════

/**
 * 마케팅 데이터 동기화 메인 함수
 * 자동 트리거 + 수동 메뉴에서 호출
 */
function syncMarketingData() {
  try {
    Logger.log("[START] 마케팅 데이터 동기화 시작");
    Logger.log(`[TIME] ${new Date().toLocaleString('ko-KR')}`);

    // 1. 마케팅 시트에서 데이터 읽기
    const records = readMarketingData();

    if (records.length === 0) {
      Logger.log("[WARN] 동기화할 데이터가 없습니다.");
      return { success: true, message: "동기화할 데이터 없음", recordCount: 0 };
    }

    // 2. Vercel API로 동기화
    const result = syncToVercel(records);

    Logger.log(`[SUCCESS] ${result.recordCount}개 레코드 동기화 완료`);
    return { success: true, message: "✅ 동기화 완료", recordCount: result.recordCount };

  } catch (error) {
    Logger.log(`[ERROR] ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 Custom Menu (Google Sheets UI)
// ═══════════════════════════════════════════════════════════════

/**
 * Google Sheets 열 때 실행되는 함수
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("🔄 협찬 모니터링 동기화")
    .addItem("🚀 지금 동기화", "syncMarketingData")
    .addSeparator()
    .addItem("🔍 설정 확인", "checkSetup")
    .addItem("📖 도움말", "showHelp")
    .addToUi();

  Logger.log("✅ 동기화 메뉴 생성됨");
}

/**
 * 설정 확인
 */
function checkSetup() {
  try {
    const secret = getCronSecret();
    Logger.log("✅ VERCEL_CRON_SECRET 설정됨");
    SpreadsheetApp.getUi().alert("✅ 설정이 완료되었습니다.");
    return true;
  } catch (error) {
    Logger.log(`❌ 설정 오류: ${error.message}`);
    SpreadsheetApp.getUi().alert(`❌ 설정 오류:\n${error.message}`);
    return false;
  }
}

/**
 * 도움말 표시
 */
function showHelp() {
  const help = `
[마케팅 데이터 동기화 가이드]

1. 수동 동기화 (이 메뉴에서)
   → 🔄 협찬 모니터링 동기화 → 🚀 지금 동기화
   → 원하는 시간에 즉시 동기화

2. 자동 동기화 (매일 자정)
   → 트리거 설정 필요 (아래 참고)
   → 설정하면 자동으로 매일 실행

3. 설정 확인
   → 메뉴: 🔄 협찬 모니터링 동기화 → 🔍 설정 확인

[필수 설정]
프로젝트 설정 → 스크립트 속성 → VERCEL_CRON_SECRET = lala2024secret

[자동 트리거 설정]
1. 좌측 메뉴 → "트리거" 클릭
2. "트리거 추가"
3. 함수: syncMarketingData
4. 이벤트: 시간 기반 타이머
5. 시간: 자정~1시
6. 저장
  `;
  Logger.log(help);
  SpreadsheetApp.getUi().alert(help);
}
