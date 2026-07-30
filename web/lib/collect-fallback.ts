// 자정수집 폴백 판정 — 순수 로직
//
// 왜(2026-07-30): GitHub Actions 스케줄이 전면 정지해 자정수집(00:41 KST)이 안 돌 위험이 실재했다.
// 구글(Apps Script) 스케줄러가 새벽에 이 판정을 호출해, **정말 비어 있을 때만** Apify 폴백 수집을
// 시작한다(웹훅이 적재). GitHub 수집이 정상이었으면 아무 것도 하지 않는다 = 중복수집·Apify 비용 방지.

export type FallbackDecision = {
  act: boolean;
  reason: "already_collected" | "missing_rows" | "threshold_unknown";
  autoRows: number;
  threshold: number;
};

/**
 * @param autoRows  대상 날짜(kdate)의 자동수집(manual=false) 행 수
 * @param threshold 이 수치 이상이면 '수집됨'으로 간주(정상일엔 400~600행. 기본 100은 넉넉한 하한)
 */
export function decideFallback(autoRows: number, threshold = 100): FallbackDecision {
  if (!Number.isFinite(autoRows) || autoRows < 0) {
    // 조회 자체가 이상하면 함부로 수집하지 않는다(비용·중복 위험) — 사람이 보게 알림만.
    return { act: false, reason: "threshold_unknown", autoRows: -1, threshold };
  }
  if (autoRows >= threshold) {
    return { act: false, reason: "already_collected", autoRows, threshold };
  }
  return { act: true, reason: "missing_rows", autoRows, threshold };
}

export function formatFallback(d: FallbackDecision, kdate: string, dryRun: boolean, started?: boolean): string {
  const head = `[자정수집 폴백] ${kdate} 자동행 ${d.autoRows < 0 ? "조회실패" : d.autoRows}건 (기준 ${d.threshold})`;
  if (d.reason === "already_collected") return `✅ ${head} — GitHub 수집 정상, 폴백 불필요`;
  if (d.reason === "threshold_unknown") return `⚠️ ${head} — DB 조회 이상으로 폴백 보류(사람 확인 필요)`;
  if (dryRun) return `🟡 ${head} — 폴백 필요 판정(dry-run, 실제 수집 안 함)`;
  return started
    ? `🔴 ${head} — GitHub 수집 누락으로 **Apify 폴백 수집 시작**(웹훅이 적재). 스케줄러 장애 확인 필요`
    : `🔴 ${head} — 폴백 수집 시작 실패(사람 개입 필요)`;
}
