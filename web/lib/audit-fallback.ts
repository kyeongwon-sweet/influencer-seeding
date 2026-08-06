// 아침 수식감사 폴백 판정 — 순수 로직
//
// 왜(2026-08-03 실측): `formula-audit.yml`은 09:10 KST 예정인데(2026-08-06 앞당김, 이전 10:10) GitHub 스케줄러가 매일 3시간 넘게
// 밀려 13:2x~13:3x에야 발화했다(07-31·08-01·08-02 연속). 그리고 이 날 아침에는 10:17까지도 발화하지
// 않아 **사람이 손으로 dispatch**해서야 오늘치 감사가 돌았다.
//
// 기존 감시(cron-watchdog / schedule-heartbeat)는 '최근 성공이 26시간 이내인가'라는 **나이 기준**이라
// 어제 13:31에 성공했으면 오늘 아침 미실행을 구조적으로 못 잡는다. 그래서 경고를 늘리는 대신
// **구글(Apps Script) 트리거가 11:00 KST에 오늘치 감사 유무를 확인하고, 없으면 직접 실행**한다.
//
// 정책이 자정수집 폴백과 다른 점: GitHub 조회가 실패하면 여기서는 **실행**한다.
//  - 감사는 읽기 전용(DB·시트 쓰기 없음, 비용 0) → 중복 실행의 피해는 Slack 1건 중복뿐
//  - 반면 미실행의 피해는 수식 파손을 하루 통째로 놓치는 것
//  (자정수집은 반대로 Apify 비용·중복수집 위험이 있어 조회 실패 시 보류한다)

export type AuditFallbackDecision = {
  act: boolean;
  reason: "already_done" | "missing_today" | "lookup_failed";
  todayRuns: number;
};

/**
 * @param todaySuccessRuns 오늘(KST) formula-audit 성공 실행 수. 조회 실패면 음수를 넘긴다.
 */
export function decideAuditFallback(todaySuccessRuns: number): AuditFallbackDecision {
  if (!Number.isFinite(todaySuccessRuns) || todaySuccessRuns < 0) {
    return { act: true, reason: "lookup_failed", todayRuns: -1 };
  }
  if (todaySuccessRuns >= 1) {
    return { act: false, reason: "already_done", todayRuns: todaySuccessRuns };
  }
  return { act: true, reason: "missing_today", todayRuns: 0 };
}

export function formatAuditFallback(
  d: AuditFallbackDecision,
  kdate: string,
  dryRun: boolean,
  ran?: boolean,
): string {
  const head = `[수식감사 폴백] ${kdate} 오늘 감사 ${d.todayRuns < 0 ? "조회실패" : `${d.todayRuns}회`}`;
  if (d.reason === "already_done") return `✅ ${head} — GitHub 스케줄 정상, 폴백 불필요`;
  if (dryRun) {
    return d.reason === "lookup_failed"
      ? `🟡 ${head} — GitHub 조회 실패라 실행 판정(dry-run, 실제 감사 안 함)`
      : `🟡 ${head} — 폴백 필요 판정(dry-run, 실제 감사 안 함)`;
  }
  if (!ran) return `🔴 ${head} — 폴백 감사 실행 실패(사람 확인 필요)`;
  return d.reason === "lookup_failed"
    ? `🟠 ${head} — GitHub 조회 실패로 안전하게 폴백 감사 실행함(결과는 별도 메시지)`
    : `🟠 ${head} — GitHub 스케줄 미발화로 **폴백 감사 실행**(결과는 별도 메시지). 스케줄러 지연 확인 필요`;
}

/** GitHub runs 응답에서 오늘(KST) 성공 실행 수를 센다. updatedAt은 ISO(UTC). */
export function countTodaySuccess(
  runs: Array<{ updatedAt: string; conclusion: string | null }>,
  todayKstDate: string,
): number {
  return runs.filter((r) => {
    if (r.conclusion !== "success") return false;
    const kst = new Date(new Date(r.updatedAt).getTime() + 9 * 3_600_000);
    const d = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
    return d === todayKstDate;
  }).length;
}
