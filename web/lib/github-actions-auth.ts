type GitHubTokenEnv = Record<string, string | undefined>;

/**
 * 운영 전용 토큰을 우선 사용하되, 비공개 전환 전부터 Vercel에 있던
 * GITHUB_TOKEN도 읽기 전용 GitHub Actions 조회의 호환 경로로 허용한다.
 */
export function resolveGitHubActionsToken(env: GitHubTokenEnv = process.env): string | undefined {
  const dedicated = env.OPS_GITHUB_TOKEN?.trim();
  if (dedicated) return dedicated;
  const legacy = env.GITHUB_TOKEN?.trim();
  return legacy || undefined;
}

export function excludeFailedGitHubLookups<T extends { workflow: string }>(
  targets: T[],
  failedWorkflows: Iterable<string>,
): T[] {
  const failed = new Set(failedWorkflows);
  return targets.filter((target) => !failed.has(target.workflow));
}
