/**
 * 아침 감사 보장 — "오늘 안 돈 워크플로만 깨운다"의 순수 판정부.
 *
 * 왜 필요한가(실측 2026-08-07): GitHub cron이 이 저장소에서 **상시 3시간 지연**(설정 10:10 → 실제 13:2x)에
 * 이어 **이틀 연속 완전 누락**(08-06·08-07)했다. 반면 Apps Script 시간 트리거는 같은 기간 정상 발화했다.
 * → **Apps Script = 시각 보장자, GitHub Actions = 실행 환경**으로 역할을 나눈다.
 *   제작자감사는 Python+시크릿이 필요한 워크플로라 HTTP로 못 부른다 → 포팅 대신 `workflow_dispatch`로 깨운다.
 *
 * 이 파일은 네트워크를 모른다(테스트 가능). 실제 조회·dispatch는 라우트가 한다.
 */

export type WorkflowProbe = {
  /** 워크플로 파일명 (예: formula-audit.yml) */
  workflow: string;
  /** 오늘(KST) 성공 실행 수. 조회 실패는 -1 */
  todaySuccess: number;
};

export type EnsureAction = {
  workflow: string;
  /** dispatch 할 것인가 */
  act: boolean;
  reason: "already_done" | "not_run_today" | "lookup_failed";
  note: string;
};

/**
 * 워크플로별 조치 판정.
 *
 * ⚠️ 조회 실패(-1)는 **실행 쪽으로 기운다.** 두 감사 모두 기본이 읽기 전용이라
 *    (제작자감사는 apply=false 기본) 중복 실행 피해보다 **미실행 피해가 훨씬 크다**.
 *    audit-fallback이 이미 같은 규약을 쓰고 있어 정책을 일치시킨다.
 */
export function decideEnsure(probe: WorkflowProbe): EnsureAction {
  const { workflow, todaySuccess } = probe;
  if (todaySuccess < 0) {
    return { workflow, act: true, reason: "lookup_failed", note: "실행 이력 조회 실패 → 안전하게 1회 실행" };
  }
  if (todaySuccess > 0) {
    return { workflow, act: false, reason: "already_done", note: `오늘 성공 ${todaySuccess}회 — 건너뜀` };
  }
  return { workflow, act: true, reason: "not_run_today", note: "오늘 성공 실행 없음 → dispatch" };
}

/** 사람이 읽는 요약(슬랙·응답 공용). 조용한 성공은 알리지 않기 위해 호출측이 needsNotify로 거른다. */
export function formatEnsureSummary(
  actions: Array<EnsureAction & { dispatched?: boolean }>,
  kdate: string,
  dryRun: boolean,
): string {
  const head = `🕘 [아침 감사 보장] ${kdate}${dryRun ? " (dry-run)" : ""}`;
  const lines = actions.map((a) => {
    if (!a.act) return `• ✅ ${a.workflow} — ${a.note}`;
    if (dryRun) return `• 🔎 ${a.workflow} — ${a.note} (dry-run이라 실행 안 함)`;
    return a.dispatched
      ? `• ▶️ ${a.workflow} — ${a.note} → 실행 요청 성공`
      : `• 🔴 ${a.workflow} — ${a.note} → **실행 요청 실패**`;
  });
  return [head, ...lines].join("\n");
}

/**
 * 알림을 보낼 필요가 있는가.
 * 전부 `already_done`이면 조용히 넘어간다(매일 아침 무의미한 슬랙을 만들지 않는다).
 * 하나라도 깨웠거나 실패했으면 알린다 — 스케줄러가 놀고 있다는 사실 자체가 정보다.
 */
export function needsNotify(actions: Array<EnsureAction & { dispatched?: boolean }>): boolean {
  return actions.some((a) => a.act);
}
