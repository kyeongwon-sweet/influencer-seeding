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

export function looksLikeEngagementCountAsViews(args: {
  playCount: unknown;
  likesCount?: unknown;
  commentsCount?: unknown;
  previousPlay?: unknown;
}): boolean {
  if (toPositiveMetric(args.previousPlay) != null) return false;

  const play = toPositiveMetric(args.playCount);
  if (play == null) return false;

  const likes = toPositiveMetric(args.likesCount);
  if (likes != null && likes >= 100 && play <= Math.max(likes * 3, likes + 50)) {
    return true;
  }

  const comments = toPositiveMetric(args.commentsCount);
  if (comments != null && comments >= 20 && play <= comments * 20) {
    return true;
  }

  return false;
}
