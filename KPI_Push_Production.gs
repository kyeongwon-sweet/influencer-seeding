/**
 * ═══════════════════════════════════════════════════════════════
 * KPI 데이터 Vercel 앱 전송 (Google Apps Script - 최종 프로덕션)
 * ═══════════════════════════════════════════════════════════════
 *
 * 기능:
 * - 매일 00:00 (자정) 자동 실행 (주말 포함)
 * - Google Sheets의 KPI 데이터를 읽어 Vercel 앱으로 전송
 * - PropertiesService로 보안 관리
 * - Custom Menu로 수동 트리거 제공
 *
 * 설정:
 * 1. 프로젝트 설정 → 스크립트 속성
 * 2. 속성 추가: CRON_SECRET = lala2024secret
 * 3. 저장 후 Google Sheets 새로고침
 */

// ═══════════════════════════════════════════════════════════════
// 📋 설정 (CONFIG)
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Vercel API
  VERCEL_URL: "https://influencer-seeding-mu.vercel.app/api/kpi/ingest",

  // Google Sheets
  SHEET_ID: "1QpUgPdiZGXtgXnRnDld99Kp1qP0rRbqwyv0aYbJ_Omo",
  SHEET_GID: 1808124579,
  DATA_RANGE: "B4:I7",
};

// ═══════════════════════════════════════════════════════════════
// 🔐 보안: PropertiesService에서 시크릿 읽기
// ═══════════════════════════════════════════════════════════════

/**
 * PropertiesService에서 CRON_SECRET 가져오기
 */
function getCronSecret() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("CRON_SECRET");

  if (!secret) {
    const msg = `
❌ CRON_SECRET이 설정되지 않았습니다.

[설정 방법]
1. 프로젝트 설정 (좌측 메뉴) 클릭
2. "스크립트 속성" 섹션 → "속성 추가"
3. 입력:
   - 속성: CRON_SECRET
   - 값: lala2024secret
4. 저장 클릭
5. Google Sheets 새로고침 후 메뉴 다시 시도
    `;
    Logger.log(msg);
    throw new Error("CRON_SECRET not configured");
  }

  return secret;
}

// ═══════════════════════════════════════════════════════════════
// 📊 Core: KPI 데이터 읽기 및 전송
// ═══════════════════════════════════════════════════════════════

/**
 * Google Sheets에서 KPI 데이터 읽기
 */
function readKpiData() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === CONFIG.SHEET_GID);

  if (!sheet) {
    throw new Error(`Sheet with GID ${CONFIG.SHEET_GID} not found`);
  }

  const values = sheet.getRange(CONFIG.DATA_RANGE).getValues();
  const [headerRow, targetRow, currentRow, achieveRow = []] = values;

  // 월 라벨
  const monthLabel = String(headerRow[0] ?? "").trim() || "";

  // 메트릭 파싱
  const metrics = [];
  for (let i = 1; i < headerRow.length; i++) {
    const label = String(headerRow[i] ?? "").trim();
    if (!label) continue;

    const target = targetRow[i];
    const current = currentRow[i];
    const achieve = achieveRow[i];

    // Achievement 안전한 계산
    let achievement = null;
    if (achieve != null && achieve !== "") {
      const numAchieve = Number(achieve);
      if (!isNaN(numAchieve)) {
        if (numAchieve > 0 && numAchieve <= 1) {
          achievement = Math.round(numAchieve * 100);
        } else {
          achievement = Math.round(numAchieve);
        }
      }
    }

    metrics.push({
      label,
      target: target !== "" && target != null ? Number(target) : null,
      current: current !== "" && current != null ? Number(current) : null,
      achievement,
    });
  }

  return { monthLabel, metrics };
}

/**
 * Vercel API로 데이터 전송
 */
function sendToVercel(data) {
  const secret = getCronSecret();
  const response = UrlFetchApp.fetch(CONFIG.VERCEL_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + secret },
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const content = response.getContentText();

  Logger.log(`[API Response] ${statusCode}`);
  Logger.log(`[Response Body] ${content}`);

  if (statusCode !== 200) {
    throw new Error(`API returned ${statusCode}: ${content}`);
  }

  return { statusCode, content };
}

// ═══════════════════════════════════════════════════════════════
// 🚀 메인 함수 (자동 + 수동 실행 모두 사용)
// ═══════════════════════════════════════════════════════════════

/**
 * KPI 데이터 전송 (자동 트리거 + 수동 메뉴에서 호출)
 */
function pushKpi() {
  try {
    Logger.log("[START] KPI 데이터 전송 시작");
    Logger.log(`[TIME] ${new Date().toLocaleString('ko-KR')}`);

    const data = readKpiData();
    Logger.log(`[DATA] 월: ${data.monthLabel}, 메트릭: ${data.metrics.length}개`);

    sendToVercel(data);

    Logger.log("[SUCCESS] KPI 데이터 전송 완료");
    return { success: true, message: "✅ 데이터 전송 완료" };
  } catch (error) {
    Logger.log(`[ERROR] ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔧 유틸리티 함수
// ═══════════════════════════════════════════════════════════════

/**
 * 데이터 미리보기 (전송 전 확인용)
 */
function previewKpiData() {
  try {
    const data = readKpiData();
    const output = `
[미리보기]
월: ${data.monthLabel}

메트릭:
${data.metrics.map(m => `  - ${m.label}
    목표: ${m.target ?? "없음"}
    현재: ${m.current ?? "없음"}
    달성률: ${m.achievement ?? "없음"}%`).join('\n')}
    `;
    Logger.log(output);
  } catch (error) {
    Logger.log(`[ERROR] ${error.message}`);
  }
}

/**
 * API 테스트
 */
function testKpiEndpoint() {
  try {
    Logger.log("[TEST] KPI 엔드포인트 테스트");
    const testData = {
      month_label: "2026년 6월 (테스트)",
      metrics: [
        {
          label: "테스트 메트릭",
          target: 1000,
          current: 750,
          achievement: 75,
        },
      ],
    };

    const result = sendToVercel(testData);
    Logger.log(`[TEST RESULT] 성공`);
    return result;
  } catch (error) {
    Logger.log(`[TEST ERROR] ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 설정 확인
 */
function checkSetup() {
  try {
    const secret = getCronSecret();
    Logger.log("✅ CRON_SECRET 설정됨");
    return true;
  } catch (error) {
    Logger.log(`❌ 설정 오류: ${error.message}`);
    return false;
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

  ui.createMenu("📊 KPI 전송")
    .addItem("🚀 데이터 전송", "pushKpi")
    .addSeparator()
    .addItem("👀 미리보기", "previewKpiData")
    .addItem("🧪 API 테스트", "testKpiEndpoint")
    .addItem("🔍 설정 확인", "checkSetup")
    .addSeparator()
    .addItem("📖 도움말", "showHelp")
    .addToUi();

  Logger.log("✅ KPI 메뉴 생성됨");
}

/**
 * 도움말 표시
 */
function showHelp() {
  const help = `
[KPI 자동 전송 가이드]

1. 자동 실행 (매일 00:00)
   → 설정 완료 시 자동 실행됨
   → 별도 작업 불필요

2. 수동 실행
   → 메뉴: 📊 KPI 전송 → 🚀 데이터 전송
   → 원하는 시간에 즉시 전송 가능

3. 설정 확인
   → 메뉴: 📊 KPI 전송 → 🔍 설정 확인
   → CRON_SECRET 설정 상태 확인

4. 문제 해결
   → 메뉴: 📊 KPI 전송 → 🧪 API 테스트
   → API 연결 테스트

[필수 설정]
프로젝트 설정 → 스크립트 속성 → CRON_SECRET = lala2024secret
  `;
  Logger.log(help);
  SpreadsheetApp.getUi().alert(help);
}

// ═══════════════════════════════════════════════════════════════
// ⏰ 자동 트리거 설정 (반드시 수동으로 설정해야 함!)
// ═══════════════════════════════════════════════════════════════

/**
 * 자동 트리거 설정 방법:
 *
 * 1. 좌측 메뉴 → "트리거" 아이콘 클릭
 * 2. "트리거 추가" 버튼 클릭
 * 3. 설정:
 *    - 실행할 함수: pushKpi
 *    - 배포: 새로 만들기
 *    - 이벤트 출처: 시간 기반
 *    - 시간 기반 트리거 유형: 날짜 기반 타이머
 *    - 시간: 자정~1시 (또는 원하는 시간)
 * 4. "저장" 클릭
 *
 * → 이제 매일 설정된 시간에 자동 실행됨!
 */
