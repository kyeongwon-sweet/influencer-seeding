// 추적 대상 인스타 '게시물(릴스/피드/IGTV)' URL 추출 — 모든 수집 경로(apify-collect, /api/jobs monitoring)가
// 이 한 곳을 공유한다. 경로마다 필터가 갈라져 수동수집이 0건이 되던 버그(2026-06-26) 재발방지.
// ⚠️ 프로필 URL용 cleanInstagramUrl 과 혼동 금지 — 이건 '게시물' URL 전용.
// (scripts/run_monitoring.py 의 _ig_shortcode 정규식과 동일 규칙을 유지할 것)
const IG_POST_RE = /\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/;

type UrlRow = { url: string | null; ended_at: string | null };

/** 인스타 + 미종료(ended_at 없음) + shortcode 있는 게시물 URL만 (중복 제거). */
export function activeIgPostUrls(posts: UrlRow[]): string[] {
  return [...new Set(
    (posts || [])
      .filter((p) => (p.url || "").includes("instagram.com") && !p.ended_at && IG_POST_RE.test(p.url || ""))
      .map((p) => p.url as string)
  )];
}

/**
 * 수집 전 안전점검: 인스타 게시물이 충분히 많은데 추출 URL이 비정상적으로 적으면 true(이상).
 * 조용한 실패(필터 버그 등)를 success로 넘기지 않도록 호출부에서 실패/알림 처리.
 */
export function isSuspiciousUrlCount(posts: UrlRow[], urlCount: number): boolean {
  const igPosts = (posts || []).filter((p) => (p.url || "").includes("instagram.com") && !p.ended_at).length;
  return igPosts >= 20 && urlCount < igPosts * 0.5;
}
