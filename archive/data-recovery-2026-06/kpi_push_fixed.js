/**
 * KPI 데이터 Vercel 앱으로 전송 (수정된 버전)
 * Google Apps Script (Google Sheets)
 */

// ✅ PropertiesService에서 시크릿 읽기 (하드코딩 제거)
function getCronSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty("CRON_SECRET");
  if (!secret) {
    Logger.log("❌ CRON_SECRET이 설정되지 않았습니다");
    Logger.log("1. 프로젝트 설정 → 스크립트 속성");
    Logger.log("2. 속성 추가: CRON_SECRET = lala2024secret");
    throw new Error("CRON_SECRET missing");
  }
  return secret;
}

// ✅ 통합 함수 (중복 코드 제거)
function pushKpiToVercel(options = {}) {
  const VERCEL_URL = options.url || "https://influencer-seeding-mu.vercel.app/api/kpi/ingest";
  const SHEET_ID = options.sheetId || "1QpUgPdiZGXtgXnRnDld99Kp1qP0rRbqwyv0aYbJ_Omo";
  const GID = options.gid || 1808124579;
  const RANGE = options.range || "B4:I7";

  // 시트 가져오기
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() == GID);
  if (!sheet) {
    Logger.log("❌ 시트를 찾을 수 없음");
    return { success: false, error: "Sheet not found" };
  }

  // 데이터 읽기
  const values = sheet.getRange(RANGE).getValues();
  const [headerRow, targetRow, currentRow, achieveRow = []] = values;

  // ✅ 안전한 월 레이블 추출
  const monthLabel = String(headerRow[0] ?? "").trim() || "";

  // ✅ 메트릭 파싱 (안전한 null 처리)
  const metrics = [];
  for (let i = 1; i < headerRow.length; i++) {
    const label = String(headerRow[i] ?? "").trim();
    if (!label) continue; // 빈 컬럼 건너뛰기

    const target = targetRow[i];
    const current = currentRow[i];
    const achieve = achieveRow[i];

    // ✅ achievement 안전한 계산
    let achievement = null;
    if (achieve != null && achieve !== "") {
      const numAchieve = Number(achieve);
      if (!isNaN(numAchieve)) {
        // 0 ~ 1 사이면 퍼센트로 변환
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

  // 페이로드 생성
  const payload = {
    month_label: monthLabel,
    metrics,
  };

  // ✅ API 호출
  try {
    const cron_secret = getCronSecret();
    const response = UrlFetchApp.fetch(VERCEL_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + cron_secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();

    Logger.log(`✅ 상태: ${statusCode}`);
    Logger.log(`📦 응답: ${content}`);

    return {
      success: statusCode === 200,
      statusCode,
      response: content,
      payload,
    };
  } catch (error) {
    Logger.log(`❌ 오류: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ✅ 테스트 함수
function testKpiEndpoint() {
  Logger.log("🧪 KPI 엔드포인트 테스트...");

  const result = pushKpiToVercel({
    // 기본값 사용 (또는 커스텀 옵션 지정 가능)
  });

  Logger.log("테스트 결과:");
  Logger.log(JSON.stringify(result, null, 2));
}

// ✅ 간단한 사용
function pushKpi() {
  pushKpiToVercel();
}

/**
 * 설정 방법:
 *
 * 1. 프로젝트 설정 (좌측 메뉴) → 스크립트 속성
 * 2. 속성 추가:
 *    - 속성: CRON_SECRET
 *    - 값: lala2024secret
 *
 * 3. 함수 실행:
 *    - testKpiEndpoint() 먼저 테스트
 *    - 성공하면 pushKpi() 사용
 */
