// 사용자 입력/CSV의 숫자 파싱: "1,000"·공백 허용, 그 외 비숫자는 null.
// 맨 Number()는 콤마 입력에 NaN을 반환하고, NaN은 JSON 직렬화에서 null이 되어 값이 '조용히' 유실된다.
export function parseNumInput(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
