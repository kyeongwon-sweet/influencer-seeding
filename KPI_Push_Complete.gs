/**
 * ═══════════════════════════════════════════════════════════════
 * KPI 데이터 Vercel 앱 전송 (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════
 *
 * 기능:
 * - Google Sheets의 KPI 데이터를 읽어 Vercel 앱으로 전송
 * - 안전한 null/undefined 처리
 * - 환경 변수 기반 시크릿 관리 (보안)
 * - 유연한 설정 옵션
 *
 * 사용 방법:
 * 1. 프로젝트 설정 → 스크립트 속성에서 CRON_SECRET 추가
 * 2. testKpiEndpoint() 실행하여 테스트
 * 3. pushKpi() 실행하여 데이터 전송
 */

// ═══════════════════════════════════════════════════════════════
// 📋 Custom Menu (Google Sheets 상단 메뉴)
// ═══════════════════════════════════════════════════════════════

/**
 * 구글 시트 열 때 실행 (메뉴 생성)
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("📊 KPI 전송")
    .addItem("🚀 데이터 전송", "pushKpi")
    .addSeparator()
    .addItem("👀 데이터 미리보기", "previewKpiData")
    .addItem("🧪 API 테스트", "testKpiEndpoint")
    .addItem("🔍 설정 확인", "checkSetup")
    .addSeparator()
    .addItem("📖 도움말", "showHelp")
    .addToUi();

  Logger.log("✅ KPI 메뉴가 생성되었습니다");
}

// ═══════════════════════════════════════════════════════════════
// 🔧 설정 (커스터마이징 가능)
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Vercel API 엔드포인트
  VERCEL_URL: "https://influencer-seeding-mu.vercel.app/api/kpi/ingest",

  // Google Sheets 설정
  SHEET_ID: "1QpUgPdiZGXtgXnRnDld99Kp1qP0rRbqwyv0aYbJ_Omo",
  SHEET_GID: 1808124579,  // 시트 ID (탭 우클릭 → "ID 복사")

  // 데이터 범위 (B4:I7)
  // B4 = 월 라벨
  // C4:I4 = 메트릭 이름
  // B5:I5 = 목표값
  // B6:I6 = 현재값
  // B7:I7 = 달성률 (%)
  DATA_RANGE: "B4:I7",
};

// ═══════════════════════════════════════════════════════════════
// 🔐 보안: 환경변수 관리
// ═══════════════════════════════════════════════════════════════

/**
 * 스크립트 속성에서 CRON_SECRET 가져오기
 * @returns {string} CRON_SECRET
 * @throws {Error} CRON_SECRET이 설정되지 않았을 때
 */
function getCronSecret() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("CRON_SECRET");

  if (!secret) {
    const message = `
❌ CRON_SECRET이 설정되지 않았습니다.

설정 방법:
1. 프로젝트 설정 (좌측 메뉴) 클릭
2. "스크립트 속성" 섹션에서 "속성 추가" 클릭
3. 다음과 같이 입력:
   - 속성: CRON_SECRET
   - 값: lala2024secret
4. 저장 버튼 클릭
5. 다시 함수 실행
    `;
    Logger.log(message);
    throw new Error("CRON_SECRET not configured");
  }

  return secret;
}

/**
 * CRON_SECRET 설정 (환경변수 메뉴 없을 때 사용)
 * @param {string} secret - 설정할 CRON_SECRET 값
 */
function setCronSecret(secret) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("CRON_SECRET", secret);
  Logger.log(`✅ CRON_SECRET 설정 완료`);
}

// ═══════════════════════════════════════════════════════════════
// 📊 시트 데이터 읽기
// ═══════════════════════════════════════════════════════════════

/**
 * Google Sheets에서 KPI 데이터 읽기
 * @param {Object} options - 설정 옵션
 * @returns {Object} { monthLabel, metrics }
 */
function readKpiDataFromSheet(options = {}) {
  const {
    sheetId = CONFIG.SHEET_ID,
    gid = CONFIG.SHEET_GID,
    range = CONFIG.DATA_RANGE,
  } = options;

  try {
    // 시트 열기
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const sheet = spreadsheet.getSheets().find(s => s.getSheetId() == gid);

    if (!sheet) {
      throw new Error(`Sheet with GID ${gid} not found`);
    }

    // 데이터 범위 읽기
    const values = sheet.getRange(range).getValues();

    if (values.length < 4) {
      throw new Error(`Range ${range} must have at least 4 rows`);
    }

    const [headerRow, targetRow, currentRow, achieveRow = []] = values;

    // ✅ 월 레이블 추출 (안전한 처리)
    const monthLabel = String(headerRow[0] ?? "").trim() || "";

    // ✅ 메트릭 파싱 (안전한 null 처리)
    const metrics = [];

    for (let i = 1; i < headerRow.length; i++) {
      const label = String(headerRow[i] ?? "").trim();

      // 빈 컬럼은 건너뛰기
      if (!label) continue;

      const target = targetRow[i];
      const current = currentRow[i];
      const achieve = achieveRow[i];

      // ✅ 안전한 null/undefined 처리
      const targetValue = (target !== "" && target != null) ? Number(target) : null;
      const currentValue = (current !== "" && current != null) ? Number(current) : null;

      // ✅ achievement 값 안전하게 계산
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
        target: targetValue,
        current: currentValue,
        achievement,
      });
    }

    return { monthLabel, metrics };

  } catch (error) {
    Logger.log(`❌ 데이터 읽기 오류: ${error.message}`);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 메인: KPI 데이터 전송
// ═══════════════════════════════════════════════════════════════

/**
 * KPI 데이터를 Vercel 앱으로 전송
 * @param {Object} options - 설정 옵션
 * @returns {Object} { success, statusCode, response, payload }
 */
function pushKpiToVercel(options = {}) {
  const {
    url = CONFIG.VERCEL_URL,
    sheetId = CONFIG.SHEET_ID,
    gid = CONFIG.SHEET_GID,
    range = CONFIG.DATA_RANGE,
  } = options;

  try {
    Logger.log("📡 KPI 데이터 전송 시작...");

    // 1️⃣ 데이터 읽기
    const { monthLabel, metrics } = readKpiDataFromSheet({
      sheetId,
      gid,
      range,
    });

    Logger.log(`📊 월: ${monthLabel}`);
    Logger.log(`📊 메트릭 수: ${metrics.length}`);

    // 2️⃣ 페이로드 구성
    const payload = {
      month_label: monthLabel,
      metrics: metrics,
    };

    Logger.log(`📦 페이로드 준비 완료: ${JSON.stringify(payload, null, 2)}`);

    // 3️⃣ API 호출
    const cron_secret = getCronSecret();
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": "Bearer " + cron_secret,
        "User-Agent": "Google-Apps-Script/KPI-Pusher",
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    // 4️⃣ 응답 처리
    const statusCode = response.getResponseCode();
    const content = response.getContentText();

    const result = {
      success: statusCode === 200 || statusCode === 201,
      statusCode,
      response: content,
      payload,
      timestamp: new Date().toISOString(),
    };

    // 5️⃣ 로그 기록
    if (result.success) {
      Logger.log(`✅ 전송 성공 (상태: ${statusCode})`);
      Logger.log(`📮 응답: ${content}`);
    } else {
      Logger.log(`❌ 전송 실패 (상태: ${statusCode})`);
      Logger.log(`📮 응답: ${content}`);
    }

    return result;

  } catch (error) {
    Logger.log(`❌ 오류: ${error.message}`);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 🧪 테스트 및 검증
// ═══════════════════════════════════════════════════════════════

/**
 * 설정 상태 확인
 */
function checkSetup() {
  Logger.log("🔍 설정 확인 중...");

  try {
    const secret = getCronSecret();
    Logger.log(`✅ CRON_SECRET 설정됨`);
  } catch (error) {
    Logger.log(`❌ CRON_SECRET: ${error.message}`);
  }

  Logger.log(`✅ VERCEL_URL: ${CONFIG.VERCEL_URL}`);
  Logger.log(`✅ SHEET_ID: ${CONFIG.SHEET_ID}`);
  Logger.log(`✅ SHEET_GID: ${CONFIG.SHEET_GID}`);
  Logger.log(`✅ DATA_RANGE: ${CONFIG.DATA_RANGE}`);
}

/**
 * API 엔드포인트 테스트
 */
function testKpiEndpoint() {
  Logger.log("🧪 KPI 엔드포인트 테스트 시작...");
  Logger.log("=" .repeat(50));

  try {
    const result = pushKpiToVercel();

    Logger.log("\n📊 테스트 결과:");
    Logger.log("=" .repeat(50));
    Logger.log(JSON.stringify(result, null, 2));

    if (result.success) {
      Logger.log("\n✅ 테스트 성공! pushKpi() 함수를 사용할 수 있습니다.");
    } else {
      Logger.log("\n❌ 테스트 실패. 위 오류를 확인하세요.");
    }

  } catch (error) {
    Logger.log(`❌ 테스트 오류: ${error.message}`);
  }
}

/**
 * 시트에서 읽은 데이터만 확인 (전송 안 함)
 */
function previewKpiData() {
  Logger.log("👀 KPI 데이터 미리보기");
  Logger.log("=" .repeat(50));

  try {
    const { monthLabel, metrics } = readKpiDataFromSheet();

    Logger.log(`📅 월: ${monthLabel}`);
    Logger.log(`📊 메트릭:`);
    metrics.forEach((m, i) => {
      Logger.log(`  ${i + 1}. ${m.label}`);
      Logger.log(`     - 목표: ${m.target}`);
      Logger.log(`     - 현재: ${m.current}`);
      Logger.log(`     - 달성률: ${m.achievement}%`);
    });

  } catch (error) {
    Logger.log(`❌ 미리보기 오류: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 💬 편의 함수
// ═══════════════════════════════════════════════════════════════

/**
 * KPI 데이터 전송 (간단한 호출)
 */
function pushKpi() {
  pushKpiToVercel();
}

/**
 * 사용 가이드 출력
 */
function showHelp() {
  const help = `
╔════════════════════════════════════════════════════════════════╗
║            KPI 데이터 Vercel 전송 - 사용 가이드                 ║
╚════════════════════════════════════════════════════════════════╝

🚀 빠른 시작:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. checkSetup() 실행 → 설정 확인
2. previewKpiData() 실행 → 데이터 미리보기
3. testKpiEndpoint() 실행 → API 테스트
4. pushKpi() 실행 → 데이터 전송

📋 사용 가능한 함수:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pushKpi()
  → KPI 데이터를 Vercel로 전송 (기본 설정 사용)

pushKpiToVercel(options)
  → 커스텀 옵션으로 전송
  → options: { url, sheetId, gid, range }

checkSetup()
  → 현재 설정 상태 확인

previewKpiData()
  → 시트에서 읽을 데이터 미리보기 (전송 안 함)

testKpiEndpoint()
  → API 엔드포인트 테스트

showHelp()
  → 이 가이드 다시 보기

🔐 초기 설정:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 프로젝트 설정 → 스크립트 속성
2. "속성 추가" 클릭
3. 다음 입력:
   속성: CRON_SECRET
   값: lala2024secret
4. 저장 클릭

또는 코드에서 setCronSecret("lala2024secret") 실행

📊 데이터 범위:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  B     C    D    E    ...  I
4 [월] [메트릭1] [메트릭2] ...
5      [목표값]
6      [현재값]
7      [달성률]

예: B4:I7
- B4 = 월 레이블 ("2026년 5월")
- C4:I4 = 메트릭 이름
- C5:I5 = 목표값
- C6:I6 = 현재값
- C7:I7 = 달성률 (0~1 또는 0~100)

💡 팁:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 스크립트 실행 전 콘솔 보기: Ctrl+Enter
- 로그 확인: 실행 로그 → 가장 최신 실행 클릭
- 시간대 설정: 프로젝트 설정 → 표준 시간대

❓ 문제 해결:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- "CRON_SECRET not configured" 에러
  → setCronSecret("lala2024secret") 실행

- "Sheet not found" 에러
  → SHEET_ID, SHEET_GID 확인
  → 시트 탭 우클릭 → ID 복사 확인

- "Range must have at least 4 rows" 에러
  → DATA_RANGE 설정 확인
  → B4:I7 형식 맞는지 확인
  `;
  Logger.log(help);
}

// ═══════════════════════════════════════════════════════════════
// 🤖 자동화 (선택사항)
// ═══════════════════════════════════════════════════════════════

/**
 * 트리거 설정: 매일 오전 00시(자정)에 자동 실행
 *
 * 설정 방법:
 * 1. 좌측 메뉴 "트리거" 아이콘 클릭 (시계 모양)
 * 2. "+ 새 트리거" 클릭
 * 3. 다음과 같이 설정:
 *    - 실행할 함수: onSchedule
 *    - 배포: 헤드
 *    - 이벤트 소스: 시간 기반 트리거
 *    - 시간 간격: 일 (매일)
 *    - 시간: 오전 00시 (자정)
 * 4. 저장 클릭
 *
 * 참고:
 * - 오전 00시 = 자정 (00:00)
 * - 시간대: 프로젝트 설정에서 "Asia/Seoul" 확인
 * - 정확한 시간: 매일 자정 직후 ~1시간 내 실행
 */

// 자동화용 함수 (트리거에서 호출)
function onSchedule() {
  Logger.log(`⏰ 정기 실행: ${new Date().toLocaleString('ko-KR')}`);
  pushKpi();
}
