// 플랫폼 표기 통일 — 모든 페이지가 동일한 한글 짧은 라벨을 쓰도록 한 곳에서 관리.
// (기존엔 페이지마다 "인스타"/"IG"/"인스타그램" 제각각 + instagram?"인스타":"유튜브" 식이라
//  틱톡·트위터·스레드가 "유튜브"로 잘못 표시되던 버그도 함께 해결.)
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "인스타", 인스타그램: "인스타", 인스타: "인스타", ig: "인스타",
  youtube: "유튜브", 유튜브: "유튜브", yt: "유튜브",
  tiktok: "틱톡", 틱톡: "틱톡",
  twitter: "X", x: "X", 트위터: "X", 엑스: "X",
  threads: "스레드", 스레드: "스레드",
  facebook: "페북", 페이스북: "페북", 페북: "페북",
  blog: "블로그", 블로그: "블로그",
  both: "전체",
};

/** 저장값(영문/한글, 대소문자 무관)을 통일된 한글 짧은 라벨로 변환. 미지값은 원본 반환. */
export function platformLabel(p?: string | null): string {
  if (!p) return "-";
  const k = String(p).trim();
  return PLATFORM_LABEL[k.toLowerCase()] ?? PLATFORM_LABEL[k] ?? k;
}

/**
 * 게시물 URL → 저장용 플랫폼 값(한글 정식 표기). 판정 불가면 null.
 *
 * 링크가 곧 플랫폼이므로 이건 값을 지어내는 게 아니다 — x.com/…/status/… 는 실제로 트위터 글이다.
 * 판정 불가(커뮤니티·오프라인·PR 등)일 때 억지로 채우지 않고 null을 돌려주는 것이 핵심
 * (사용자 규칙 2026-08-05: "분류가 어려운 건 채널 유형을 아예 선택하지 않기").
 */
export function platformFromUrl(url?: string | null): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host)) return "트위터";
  if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) return "유튜브";
  if (/(^|\.)instagram\.com$/.test(host)) return "인스타그램";
  if (/(^|\.)tiktok\.com$/.test(host)) return "틱톡";
  if (/(^|\.)threads\.(net|com)$/.test(host)) return "스레드";
  if (/(^|\.)facebook\.com$/.test(host) || /(^|\.)fb\.watch$/.test(host)) return "페이스북";
  if (/(^|\.)blog\.naver\.com$/.test(host) || /(^|\.)naver\.me$/.test(host)
    || /(^|\.)tistory\.com$/.test(host) || /(^|\.)brunch\.co\.kr$/.test(host)) return "블로그";
  return null;
}
