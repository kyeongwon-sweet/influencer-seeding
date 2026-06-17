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
