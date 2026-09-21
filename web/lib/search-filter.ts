// 검색창 매칭 헬퍼 — 포함(include) + 제외(exclude) + 여러 개 동시(OR)를 한 입력창에서 지원한다.
// 규칙:
//   · 쉼표(,) 로 나눈 덩어리끼리는 **OR** — 여러 개를 한 번에 찾을 때 쓴다
//   · 덩어리 안의 공백 토큰은 **AND** (모두 포함해야 통과)
//   · `-단어` 는 **제외어**. 어느 덩어리에 적어도 질의 전체에 적용된다
//     ("(A or B) 이고 C 아님" 이 사람이 기대하는 뜻이라서다)
// 예)
//   "딸기"                 → '딸기' 포함
//   "바이럴 영상"          → '바이럴' AND '영상'
//   "에스파, 아이브"       → 둘 중 하나라도 포함(OR)
//   "에스파, 아이브 -광고" → (에스파 or 아이브) 이고 '광고' 미포함
//   "-샘플"                → '샘플' 미포함(그 외 전부)
// 별칭(동의어): `에스파` 처럼 그룹에 속한 이름은 그룹 전원으로 넓혀 대조한다(lib/search-aliases.ts).
//   "에스파" → 에스파·카리나·지젤… 중 하나라도 있으면 통과. 제외어도 같게 전원 제외.
// 대소문자 무시. 빈 검색어는 항상 통과(필터 없음).
//
// ⚠️ 쉼표가 없으면 덩어리가 하나뿐이라 **기존 동작과 완전히 같다**(회귀 방지 테스트로 고정).
// ⚠️ 데이터(계정명·소재명·캡션)에 쉼표가 들어 있어도 문제되지 않는다 — 쉼표는 *질의*를 나눌 뿐이고,
//    쉼표 섞인 값을 그대로 붙여넣어도 각 조각이 OR 로 걸려 그 행은 여전히 잡힌다(실측 확인 2026-09-21).
// 검색 별칭(동의어) 그룹 — 한 단어를 치면 같은 그룹의 다른 이름들도 함께 찾는다.
//
// 왜(2026-09-21 사용자 요청): 그룹명으로 검색해도 멤버명·팬덤명으로 적힌 행이 안 잡혔다.
// "에스파"를 치면 카리나·지젤로 적힌 소재·캡션까지 한 번에 보여야 한다.
//
// 규칙: 그룹은 **양방향**이다. 그룹 안의 어느 이름을 쳐도 그룹 전체로 확장된다
//       (카리나 → 에스파 소재도 나온다). 한쪽만 되면 쓰는 사람이 규칙을 외워야 한다.
// ⚠️ 제외어에도 같게 적용된다 — `-에스파` 는 그룹 전원을 제외한다. 안 그러면
//    "에스파 빼고" 라고 했는데 카리나가 남아 더 헷갈린다.
// ⚠️ 부분일치로 동작한다. 짧거나 흔한 단어를 넣으면 엉뚱한 행이 딸려온다
//    (예: "이브" 같은 2글자는 '아이브'·'이브닝'에 다 걸린다). 고유한 이름만 넣을 것.
export const SEARCH_ALIAS_GROUPS: string[][] = [
  ["에스파", "aespa", "카리나", "지젤", "아우디즈"],
];

// 소문자 키 → 그 그룹의 모든 이름(소문자). 모듈 로드 시 1회만 만든다.
const INDEX: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of SEARCH_ALIAS_GROUPS) {
    const lowered = group.map((g) => g.toLowerCase());
    for (const name of lowered) {
      // 같은 이름이 두 그룹에 있으면 먼저 선언된 그룹을 쓴다(의도치 않은 병합 방지).
      if (!m.has(name)) m.set(name, lowered);
    }
  }
  return m;
})();

/**
 * 검색어 한 토큰을 실제로 대조할 후보 목록으로 넓힌다.
 * 별칭 그룹에 없으면 자기 자신만 돌려준다(= 기존 동작 그대로).
 * 입력·출력 모두 소문자 기준이다(호출부가 이미 소문자로 비교한다).
 */
export function expandAlias(token: string): string[] {
  const t = token.toLowerCase();
  return INDEX.get(t) ?? [t];
}

/** 화면 안내용 — 어떤 그룹이 걸려 있는지 사람이 볼 수 있게 한 줄로. */
export function aliasGroupLabel(token: string): string | null {
  const g = INDEX.get(token.toLowerCase());
  return g && g.length > 1 ? g.join(" = ") : null;
}

export function matchesSearch(
  haystack: string | null | undefined,
  query: string | null | undefined,
): boolean {
  const q = (query ?? "").trim();
  if (!q) return true;
  const h = (haystack ?? "").toLowerCase();

  const groups: string[][] = [];
  for (const chunk of q.split(",")) {
    const includes: string[] = [];
    for (const raw of chunk.trim().split(/\s+/)) {
      if (!raw || raw === "-") continue; // 빈 토큰·단독 '-'는 무시
      if (raw.startsWith("-")) {
        // 별칭 그룹 전원을 제외한다 — "에스파 빼고" 했는데 카리나가 남으면 더 헷갈린다.
        if (expandAlias(raw.slice(1)).some((a) => h.includes(a))) return false;
      } else {
        includes.push(raw.toLowerCase());
      }
    }
    if (includes.length) groups.push(includes);
  }

  // 포함어가 하나도 없는 질의(예: "-샘플")는 제외 조건만 본다 — 기존 동작 유지.
  if (groups.length === 0) return true;
  return groups.some((tokens) =>
    tokens.every((t) => expandAlias(t).some((a) => h.includes(a))),
  );
}
