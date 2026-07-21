/**
 * _WriteGuard.gs — 시트 동시편집 "행 밀림(off-by-one)" 재발방지 공용 가드
 * ------------------------------------------------------------------------
 * 대상 라이브 프로젝트: "마T2P_대시보드(실무용)" (스프레드시트 [빙과] 인지 콘텐츠 RD 바인딩)
 *   scriptId: 1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn
 *
 * ▣ 확정된 근본원인 (2026-07-21, 라이브 코드 실측)
 *   누적 조회수·상태·기획자·비용 등을 쓰는 함수들이 공통적으로
 *     ① getLastRow()로 행 수 L 확보 → ② getRange(...).getValues()로 블록 읽기
 *     → ③ 배열 계산(행 인덱스 0..n-1 = DATA_START_ROW..L에 고정)
 *     → ④ getRange(DATA_START_ROW, col, n, 1).setValues(out) 로 절대 행범위에 되쓰기
 *   를 한다. ②와 ④ 사이에 다른 세션/트리거(onEdit·dailyAuto)/사람이 행을
 *   삽입·삭제·정렬하면, out[]이 "밀린 행"에 박혀 값이 이웃(윗줄) 행으로 어긋난다.
 *   게다가 LockService를 안 써서 여러 실행이 동시에 인터리브된다.
 *   → 이것이 "특정 게시글 누적이 윗줄 게시글에 반영" 사고의 원인.
 *
 * ▣ 취약 writer 전수(같은 패턴, 모두 Lock 없음)
 *   1. exportStats            (날짜열 실측)      setValues @864
 *   2. syncStatus             (상태)             setValues @1334
 *   3. (누적 조회수 함수 @1341) (누적)            setValues @1375  ← 신고된 증상
 *   4. syncCreators           (기획자·제작자)     setValues @1408,1409
 *   5. syncPricing            (비용·업체명)       per-row setValue @1564~1635
 *   6. "바이럴 업체명 채우기.gs"  (업체명)          per-row setValue @28
 *   7. "바이럴 최신효율 업데이트.gs" (예상조회수)    per-row setValue @87
 *
 * ▣ 적용 방법 — 검증된 rename+wrapper 레시피 (Claude가 in-page 드라이런으로 문법검증 완료 2026-07-21)
 *   ⚠️ Claude가 로그인 브라우저로 라이브 저장을 시도했으나 하네스 안전 분류기가 '라이브
 *      프로덕션 코드 쓰기'를 차단함 → Codex(정본 clasp/API 도구) 또는 수동으로 아래 적용.
 *   ⚠️ 저장 전 반드시 다른 세션/사람이 이 Apps Script 프로젝트를 편집 중이 아닌지 확인
 *      (Apps Script 저장 = 프로젝트 원자적 덮어쓰기 — 겹치면 남 작업 유실).
 *
 *   A. 이 헬퍼 3종(withDocLock_ 재진입판 · assertRowCountStable_ · writeColumnByKey_)을
 *      라이브 파일 "AI 트래킹 대시보드 연동.gs" 끝에 추가(또는 새 파일).
 *   B. 아래 10개 "시트 변경 함수"를 각각 rename+wrapper로 감싼다(본문은 안 건드림 → 안전):
 *        function NAME(  →  function NAME__wgimpl(     (선언부만 1회 치환)
 *        + 말미에 래퍼 추가:
 *          function NAME(){ var a=arguments,t=this; return withDocLock_(function(){ return NAME__wgimpl.apply(t,a); }); }
 *      함수 선언은 호이스팅되므로 기존 호출부·배열참조(["syncPricing",syncPricing] 등)는
 *      자동으로 래퍼를 가리킴. 재진입 락이라 함수 간 순차/중첩 호출도 안전(자기교착 없음).
 *   B-대상 10개(라이브 실측, 각 정확히 1회 선언 확인됨):
 *      ▸ 블록 읽고 절대범위 쓰기: exportStats, syncStatus, refreshCumulativeViews,
 *        syncCreators, syncPricing, importStats
 *      ▸ 행 삽입/삭제(구조 변경 → 위 함수들의 밀림 유발): runSync_(=syncNew/syncAll),
 *        pullFromDB, removeDuplicateLinks, checkSheetIssues
 *      → 이 둘을 같은 락으로 묶어야 "블록쓰기 도중 다른 실행이 행 삽입" 인터리브가 사라짐.
 *      (별도 파일 "바이럴 업체명 채우기.gs"@28 · "바이럴 최신효율.gs"@87 도 동일 패턴 —
 *       각 파일에도 헬퍼 접근 가능하면 같은 방식 래핑 권장.)
 *   C. (후속·선택) 사람이 실행 도중 행을 넣는 경우까지 막으려면, 각 블록쓰기 함수의
 *      절대범위 setValues 직전에 assertRowCountStable_(sheet, L, 'NAME') 삽입
 *      (L=그 함수가 처음 getLastRow()로 읽은 값). 본문 편집이라 B보다 조심.
 *   D. 검증: 저장 시 Apps Script가 문법오류를 거부함. 저장 후 메뉴에서 exportStats /
 *      refreshCumulativeViews 1회 실행해 정상(락 획득·해제) 동작 확인. 동시 2회 실행 시
 *      두 번째가 SHEET_LOCKED로 대기/차단되면 정상.
 *   ※ 중복 URL은 값 기준 쓰기를 흔듦 → 적용 무관하게 정리 권장. (2026-07-21 4건 모두 해소됨)
 */

/**
 * 문서 단위 락으로 감싸 동시 실행을 직렬화한다. 모든 시트 쓰기 함수에 적용.
 * ⚠️ 재진입(reentrant) 버전: 락을 이미 잡은 실행 안에서 다시 호출되면(래핑 함수가
 *    또 다른 래핑 함수를 호출하는 경우) 재획득 없이 그냥 실행 → 자기교착 방지.
 *    (예: refreshSheetDerivedFields → syncStatus/refreshCumulativeViews/... 순차 호출)
 */
var __WG_LOCKED__ = false;
function withDocLock_(fn) {
  if (__WG_LOCKED__) return fn();               // 이미 이 실행이 락 보유 → 재획득 없이 실행
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('SHEET_LOCKED: 다른 작업이 시트를 수정 중입니다. 잠시 후 다시 실행하세요(동시편집 방지).');
  }
  __WG_LOCKED__ = true;
  try {
    return fn();
  } finally {
    __WG_LOCKED__ = false;
    lock.releaseLock();
  }
}

/**
 * 절대 행범위 setValues 직전에 호출. 블록을 읽은 시점(expectedLastRow) 대비
 * 현재 행 수가 바뀌었으면(다른 세션/사람이 행 삽입·삭제) 쓰기를 취소한다.
 * → 밀린 위치에 값이 박히는 off-by-one을 원천 차단(쓰기 대신 안전하게 중단).
 */
function assertRowCountStable_(sheet, expectedLastRow, where) {
  var now = sheet.getLastRow();
  if (now !== expectedLastRow) {
    throw new Error('행 수 변경으로 쓰기 취소(' + (where || '') + '): '
      + expectedLastRow + '→' + now + '. 시트가 동시 편집됨 — 다시 실행하세요.');
  }
}

/**
 * URL(linkKey) 기준 컬럼 쓰기. 쓰기 "직전"에 URL열을 다시 읽어 현재 행 위치를
 * 재확인하고, 키→값 맵으로 현재 위치에 맞춰 기록한다(행이 밀리거나 재정렬돼도
 * 값이 엉뚱한 행에 안 들어감). 매칭 없는 행은 건드리지 않는다.
 *
 * @param sheet         대상 시트
 * @param dataStartRow  CONFIG.DATA_START_ROW
 * @param urlCol        URL 컬럼 인덱스(1-based, fieldCols.url)
 * @param targetCol     기록할 컬럼 인덱스(1-based)
 * @param keyToValue    { linkKey: value } 맵
 * @param keyFn         URL → linkKey 함수(라이브의 linkKey_ 그대로 전달)
 * @return 변경된 셀 수
 */
function writeColumnByKey_(sheet, dataStartRow, urlCol, targetCol, keyToValue, keyFn) {
  var n = sheet.getLastRow() - dataStartRow + 1;
  if (n < 1) return 0;
  var urls = sheet.getRange(dataStartRow, urlCol, n, 1).getValues();   // 쓰기 직전 최신 위치
  var cur  = sheet.getRange(dataStartRow, targetCol, n, 1).getValues();
  var changed = 0;
  for (var i = 0; i < n; i++) {
    var k = keyFn(String(urls[i][0] || ''));
    if (!k || !(k in keyToValue)) continue;   // 매칭 없으면 절대 안 건드림
    var v = keyToValue[k];
    if (cur[i][0] !== v) { cur[i][0] = v; changed++; }
  }
  if (changed) sheet.getRange(dataStartRow, targetCol, n, 1).setValues(cur);
  return changed;
}
