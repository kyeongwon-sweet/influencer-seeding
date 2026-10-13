export function toPositiveMetric(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function pickInstagramPlayMetric(
  item: Record<string, unknown>,
  url: string,
): { value: number | null; source: string | null } {
  for (const field of ["videoPlayCount", "videoViewCount"]) {
    const value = toPositiveMetric(item[field]);
    if (value != null) return { value, source: field };
  }

  const isReel = /\/(?:reel|reels|tv)\/[A-Za-z0-9_-]+/i.test(url);
  if (isReel) return { value: null, source: null };

  for (const field of ["impressions", "viewCount", "views", "count"]) {
    const value = toPositiveMetric(item[field]);
    if (value != null) return { value, source: field };
  }

  return { value: null, source: null };
}

// 조회수 전용 필드 — 여기서 온 값은 좋아요/댓글 수가 섞여 들어올 경로가 없다.
export const TRUSTED_IG_PLAY_SOURCES: ReadonlySet<string> = new Set(["videoPlayCount", "videoViewCount"]);

/** 액터 아이템에서 조회수가 어느 필드에서 왔는지(신뢰 필드만 쓰는 경로용). */
export function trustedPlaySourceOf(item: Record<string, unknown>): string | null {
  for (const field of ["videoPlayCount", "videoViewCount"]) {
    if (toPositiveMetric(item[field]) != null) return field;
  }
  return null;
}

/**
 * 스크래퍼가 좋아요/댓글 수를 조회수 자리에 넣은 **첫 측정**만 거른다.
 * ⚠️ 파이썬 정본 `scripts/run_monitoring.py::_looks_like_engagement_count_as_views` 와 **짝**이다.
 *
 * 🚨 2026-10-13 오탐: neighbor.mia(p/Dd_LfJwSelW)가 매일 늘어나는 진짜 조회수(463→480)를 8일째
 *    버렸다(좋아요 숨김 → 댓글 비율 규칙만 남음). fromsensuous 도 같은 가드의 오탐이었다.
 *    근본 원인(모호한 views/count 필드)은 도입 당시 이미 막혔으므로, 신뢰 필드에서 온 값은
 *    **숫자 자체가 참여 지표인 모양**(조회수 ≤ 좋아요, 댓글·합계와 정확히 같음)만 거른다.
 *    실제 저장된 IG 자동 측정 21,221행 중 이 모양은 0행. 비율 추정은 모호한 필드나 출처 미상에만.
 */
export function looksLikeEngagementCountAsViews(args: {
  playCount: unknown;
  likesCount?: unknown;
  commentsCount?: unknown;
  previousPlay?: unknown;
  source?: string | null;
}): boolean {
  if (toPositiveMetric(args.previousPlay) != null) return false;

  const play = toPositiveMetric(args.playCount);
  if (play == null) return false;

  const likes = toPositiveMetric(args.likesCount);
  const comments = toPositiveMetric(args.commentsCount);

  // 어느 필드에서 왔든: 숫자 자체가 좋아요/댓글 수인 모양
  if (likes != null && play <= likes) return true;
  if (comments != null && play === comments) return true;
  if (likes != null && comments != null && play === likes + comments) return true;

  if (args.source && TRUSTED_IG_PLAY_SOURCES.has(args.source)) return false;

  // 모호한 필드(또는 출처 미상)에서 온 값만 비율로 추정한다
  if (likes != null && likes >= 100 && play <= Math.max(likes * 3, likes + 50)) return true;
  if (comments != null && comments >= 20 && play <= comments * 20) return true;

  return false;
}
