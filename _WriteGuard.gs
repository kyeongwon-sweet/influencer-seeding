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
 * ▣ 적용 방법 (시트세션/Codex가 라이브에 적용 — 동시편집 없는지 확인 후 저장)
 *   A. 이 파일을 라이브 프로젝트에 새 스크립트 파일로 추가.
 *   B. 위 7개 함수의 "본문 전체"를 withDocLock_(function(){ ... }) 로 감싼다.
 *      예)  function exportStats(){ return withDocLock_(function(){  ...기존 본문...  }); }
 *      → 동시 실행 직렬화(문서 락). 두 스크립트가 겹쳐 돌지 않음.
 *   C. 절대 행범위 setValues 바로 앞에 assertRowCountStable_(sheet, L, '함수명') 호출.
 *      (L = 그 함수가 처음 getLastRow()로 읽어둔 값) → 읽은 뒤 행 수가 바뀌었으면
 *      쓰기를 취소하고 에러(재실행 유도). 밀린 쓰기 자체를 원천 차단.
 *   D. (권장) URL 키 기준 컬럼 writer(상태·누적 제외 매칭형)는 writeColumnByKey_로 교체.
 *      누적 조회수 함수(행-로컬 Math.max)는 D 불필요 — B+C만으로 충분.
 *   E. 중복 URL은 값 기준 쓰기를 흔든다 → 적용 전 checkDuplicates()로 점검,
 *      removeDuplicateLinks()(또는 수동)로 한 줄만 남긴다. (현재 3건 보고됨)
 */

/** 문서 단위 락으로 감싸 동시 실행을 직렬화한다. 모든 시트 쓰기 함수에 적용. */
function withDocLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('시트가 다른 작업으로 잠겨 있습니다. 잠시 후 다시 실행하세요(동시편집 방지).');
  }
  try {
    return fn();
  } finally {
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
