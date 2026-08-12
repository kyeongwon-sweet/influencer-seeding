/**
 * 연동시트 커스텀 메뉴(버튼) 스냅샷 — 복원용 원본
 *
 * 기준: 2026-08-03, repo `Combined_Sheet_AppsScript.gs` (메뉴 정의 최종 변경 = 958829b
 *       "chore(sheet): clarify stats refresh menu" — `exportStats` 항목 이름을
 *       "DB → 시트 조회수 반영" → "DB → 시트 조회수·누적·증분 반영" 으로 명확화).
 *
 * 왜 따로 남기나:
 *  - 라이브 Apps Script는 repo보다 앞서거나 어긋난 적이 여러 번 있었고(별도 파일·함수 존재),
 *    2026-08-03에는 편집 중 라이브 파일이 오염됐다가 정리된 일도 있었다. 그때 "원래 버튼 구성"을
 *    대조할 기준이 없었다. 이 파일은 그 기준선이다.
 *  - 메뉴가 깨지면 이 두 함수만 라이브에 되돌리면 버튼이 복구된다(동작 함수들은 본문 파일에 있음).
 *
 * ⚠️ 이 파일은 **기록용 스냅샷**이다. 실행 정본은 `Combined_Sheet_AppsScript.gs` 하나뿐이며,
 *    메뉴를 바꿀 때는 본문 파일을 고치고 이 스냅샷도 같이 갱신할 것(둘이 어긋나면 이 파일이 무의미).
 *
 * 버튼 구조
 *   🚀 광고 모니터링
 *     ├ 신규 전송 미리보기            previewNew
 *     ├ 신규 광고 추가                syncNew
 *     ├ ─────────
 *     ├ 📊 조회수
 *     │   ├ 시트 → DB 조회수 반영                    importStats
 *     │   └ DB → 시트 조회수·누적·증분 반영          exportStats
 *     ├ 🔄 메타데이터 · 복구
 *     │   ├ 대시보드 추가분 가져오기                 pullFromDB
 *     │   ├ 파생정보 전체 업데이트                   refreshSheetDerivedFields
 *     │   └ 시트 변경사항 DB 반영                    syncAllWithConfirm
 *     ├ 🔎 점검 · 정리
 *     │   ├ 빈칸 · 중복 URL 검사                     checkSheetIssues
 *     │   ├ 중복 링크 삭제                           removeDuplicateLinks
 *     │   └ 시트 가독성 서식 적용                    applyLinkedSheetReadabilityTheme
 *     └ ⏰ 자동화 (라벨은 상태에 따라 ✅켜짐 / ⏹꺼짐 / ⚠️상태 확인)
 *         ├ 자동화 상태 · 최근 실행 보기             checkSetup
 *         ├ 자동 동기화 켜기 · 복구                  installDailyTrigger
 *         └ 자동 동기화 끄기                         removeDailyTrigger
 *   📮 인사이트문의
 *     ├ 오늘 문의 메시지 만들기                      insightInquiryBuildToday
 *     ├ 날짜 직접 지정해서 만들기                    insightInquiryBuildForDate
 *     ├ 진단 (내용이 안 나올 때)                     insightInquiryDiagnose
 *     ├ 매일 오전 자동생성 켜기                      insightInquiryEnableDailyTrigger
 *     └ 자동생성 끄기                                insightInquiryDisableDailyTrigger
 *
 * 누적 조회수·증분을 갱신하는 버튼(자주 찾는 것):
 *   - 둘 다: 📊 조회수 → "DB → 시트 조회수·누적·증분 반영" (exportStats)
 *   - 누적만: 🔄 메타데이터 · 복구 → "파생정보 전체 업데이트" (refreshSheetDerivedFields)
 */

// ── 자동화 서브메뉴 라벨(스크립트 속성 기반) ──────────────────────────────
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

// ── 메뉴 정의 ────────────────────────────────────────────────────────────
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
    .addItem("중복 링크 삭제", "removeDuplicateLinks")
    .addSeparator()
    .addItem("시트 가독성 서식 적용", "applyLinkedSheetReadabilityTheme");

  const automationMenu = ui.createMenu(automationMenuLabel_())
    .addItem("자동화 상태 · 최근 실행 보기", "checkSetup")
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
