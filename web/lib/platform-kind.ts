/**
 * 조회수 지표를 애초에 제공하지 않는 매체.
 *
 * Python 수집/재시도 경로의 `scripts/platform_kind.py`와 같은 정책이다.
 * 양쪽 목록이 갈라지면 수집기는 정상 제외한 글을 웹 감사가 다시 이상으로 올리므로
 * `tests/platform-kind.test.ts`가 두 상수를 직접 대조한다.
 */
export const NO_VIEW_METRIC_HOSTS = ["threads.", "facebook.com", "naver.com", "kakao.com"] as const;

export function hasNoViewMetricHost(url: string | null | undefined): boolean {
  const value = String(url ?? "").toLowerCase();
  return NO_VIEW_METRIC_HOSTS.some((host) => value.includes(host));
}
