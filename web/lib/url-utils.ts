/**
 * URL 정규화 유틸리티
 *
 * 목적: 모든 페이지에서 일관된 URL 정규화
 * 규칙:
 * 1. 프로토콜: https://로 통일
 * 2. Trailing slash: 반드시 포함 (마지막에 /)
 * 3. 쿼리 파라미터: 모두 제거 (UTM, tracking 등)
 * 4. 플랫폼별 특수 처리:
 *    - YouTube: /shorts, /videos, /featured 등 제거
 *    - Instagram: 프로필만 (포스트/릴스 URL → null)
 *
 * ⚠️ 중요: 모든 URL 비교는 이 함수로 정규화 후 진행!
 */

/**
 * 범용 URL 정규화 함수 (모든 페이지에서 사용)
 * - 프로토콜 + trailing slash + 쿼리 제거 통일
 * - 플랫폼별 추가 정규화는 별도 함수 사용
 */
export function normalizeUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    // 인스타 게시물은 /p/·/reel/·/reels/·/tv/ 가 모두 같은 글 → shortcode로 표준형(/p/<code>/) 통일.
    // (경로만 다른 중복 행 방지 — onConflict:url 이 자동 dedup 하도록. 예: /p/ABC/ 와 /reel/ABC/ 는 동일)
    if (u.hostname.includes("instagram.com")) {
      const m = u.pathname.match(/\/(?:p|reels|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (m) return `https://www.instagram.com/p/${m[1]}/`;
    }
    // 프로토콜을 https로 강제
    const origin = `https://${u.hostname}`;
    // trailing slash 포함한 경로
    let path = u.pathname.endsWith("/") ? u.pathname : u.pathname + "/";
    // 경로가 비어있으면 /로
    if (!path || path === "") path = "/";
    return `${origin}${path}`;
  } catch {
    return null;
  }
}

/**
 * 협찬 게시물 추가 시 허용하는 플랫폼 URL (인스타 / 유튜브 / 틱톡 / 페이스북 / 스레드 / X(트위터) / 카카오 숏폼 / 네이버 클립, 다단계 서브도메인 포함).
 * sync · bulk · stats-import 및 Apps Script(Sponsored_Posts_Sync.gs)가 동일 기준 사용.
 * 서브도메인은 `*`(0개 이상) — 네이버 클립이 m.blog.naver.com처럼 2단계라 필요. 도메인 뒤 `/` 앵커로 evil-naver.com 등은 차단됨.
 */
export const ALLOWED_POST_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net|x\.com|twitter\.com|t\.co|kakao\.com|naver\.com)\//i;

export function normalizeYouTubeUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!u.hostname.includes('youtube.com')) return null;
    // /shorts/xxx, /videos, /featured 등 제거
    let path = u.pathname.replace(/\/(shorts|videos|featured|community|about)(\/.*)?$/, '');
    path = path.replace(/\/$/, '');
    if (!path || path === '') path = '/';
    return `https://www.youtube.com${path}/`;
  } catch {
    return null;
  }
}

// 포스트 URL 경로 세그먼트 (username이 아님)
const IG_POST_PREFIXES = new Set(['reels', 'reel', 'p', 'tv', 'stories', 'explore', 'accounts', 'ar', 'direct']);

export function normalizeInstagramUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!u.hostname.includes('instagram.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0];
    // 포스트/릴스 URL이면 프로필 URL이 아님 → null 반환
    if (!first || IG_POST_PREFIXES.has(first.toLowerCase())) return null;
    return `https://www.instagram.com/${first}/`;
  } catch {
    return null;
  }
}
