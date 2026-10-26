// 제작자·기획자 칸에 여러 명이 한 칸에 적힌 경우("박현지, 김해솔")를 사람 단위로 나눈다.
// 2026-10-26 사용자: "제작자가 2명이상 한번에 들어가있는 건 각각 분리해줘 — 박현지,김해솔,이선민 각각".
// 필터 옵션은 사람별로 한 번씩만 보이고, '박현지'를 고르면 "박현지, 김해솔" 게시물도 걸린다.
// 시트·DB 원문은 그대로 둔다(표시·필터 단계에서만 나눈다).

const SEPARATORS = /[,，/·&+]/;

/** "박현지, 김해솔" → ["박현지", "김해솔"]. 빈 값은 []. 같은 이름이 두 번 적혀도 한 번만. */
export function personNames(value: string | null | undefined): string[] {
  const names = String(value ?? "").split(SEPARATORS).map(s => s.trim()).filter(Boolean);
  return Array.from(new Set(names));
}

/** 필터 옵션 목록 — 여러 게시물의 칸을 사람 단위로 펼쳐 가나다순으로. */
export function personNameOptions(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.flatMap(personNames))).sort((a, b) => a.localeCompare(b, "ko"));
}

/** 선택한 사람 중 한 명이라도 이 칸에 들어 있으면 통과. 아무도 안 골랐으면 항상 통과. */
export function matchesPersonFilter(value: string | null | undefined, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const names = personNames(value);
  return selected.some(s => names.includes(s));
}
