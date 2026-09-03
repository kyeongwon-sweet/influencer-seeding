// 종료일(ended_at) 입력 정책 — 사람이 날짜를 입력하는 경로에서 '불가능한 값'만 막는다.
//
// 왜 차단인가 (2026-09-03 실측):
//   배너 도달수는 '시트 수기 → banner-reach-sync'가 유일한 경로이고, 그 라우트는
//   `measured_at > ended_at`인 날짜를 버린다(종료 후 값이 붙는 것을 막는 정상 가드).
//   그래서 ended_at이 posted_at보다 앞서면 **게시 이후의 모든 날짜가 '종료 이후'**가 되어
//   팀이 어떤 날짜에 도달수를 적어도 전부 폐기된다. 이 상태인 9건(950,000원)은 실제로
//   도달수가 0행이었다. 값을 자동 보정하면 안 되는 지표이므로(CLAUDE.md) 입력을 막는 게 답이다.
//
// 반대로 `created_at > ended_at`(종료된 뒤 소급 등록)은 과거 자료 정리로 정당할 수 있어
// 차단하지 않는다 — scripts/ended_at_anomalies.py 가 감지 알림만 낸다.

/** YYYY-MM-DD로 정규화. 날짜로 못 읽히면 null(검사 대상 아님). */
export function ymd(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** 게시 전 종료 = 구조적으로 불가능. 둘 중 하나라도 없으면 판정하지 않는다(false). */
export function endedBeforePosted(postedAt: unknown, endedAt: unknown): boolean {
  const posted = ymd(postedAt);
  const ended = ymd(endedAt);
  return posted != null && ended != null && ended < posted;
}

/** 저장을 막을 사유 메시지. 문제 없으면 null. */
export function endedAtPolicyError(postedAt: unknown, endedAt: unknown): string | null {
  if (!endedBeforePosted(postedAt, endedAt)) return null;
  return `종료일(${ymd(endedAt)})이 게시일(${ymd(postedAt)})보다 빠릅니다. `
    + `게시 전 종료는 있을 수 없고, 이 상태에서는 시트에 입력한 조회수·도달수가 전부 폐기됩니다. `
    + `종료일을 게시일 이후로 입력하세요.`;
}
