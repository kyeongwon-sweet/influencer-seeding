/**
 * URL 정규화 유틸리티
 * 모든 URL은 https://, trailing slash 포함, shorts/videos 접미사 제거된 형태로 저장
 */

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

export function normalizeInstagramUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!u.hostname.includes('instagram.com')) return null;
    // /reels/, /p/, /tv/ 등 포스트 경로 제거 → 프로필 URL만
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    // 첫 번째 세그먼트만 유지 (username)
    const username = parts[0];
    if (!username) return null;
    return `https://www.instagram.com/${username}/`;
  } catch {
    return null;
  }
}
