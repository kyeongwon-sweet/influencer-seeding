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
// 검색 별칭(동의어) — **그룹명으로 칠 때만** 멤버·팬덤명까지 함께 찾는다.
//
// 왜(2026-09-21 사용자 지시): "카리나로 치면 카리나만, 에스파로 쳤을 때만 전원 포함".
// 즉 **단방향**이다. 처음엔 양방향으로 만들었다가 사용자가 뒤집었다 — 멤버 한 명을 콕 집어
// 보려는 게 더 흔한 쓰임이고, 양방향이면 그걸 할 방법이 아예 없어진다.
//
// 표 구조: 키(그룹명) → 넓힐 이름 목록. 키가 아닌 이름은 확장되지 않는다.
// ⚠️ 제외어에도 같게 적용된다 — `-에스파` 는 목록 전원을 제외한다. 안 그러면
//    "에스파 빼고" 라고 했는데 카리나가 남아 더 헷갈린다. (`-카리나` 는 카리나만 제외.)
// ⚠️ 부분일치다. 1글자 이름은 아무 행에나 걸리므로 넣지 않는다(테스트로 막음).
//    2글자(`지젤`)는 실제로 쓰이므로 허용하되, 추가할 땐 실데이터 매칭 건수를 먼저 셀 것.
const AESPA = ["에스파", "aespa", "카리나", "지젤", "아우디즈"];

/** 키로 검색하면 값 전체로 넓어진다. 값에만 있는 이름(카리나 등)은 그 이름만 찾는다. */
export const SEARCH_ALIAS_MAP: Record<string, string[]> = {
  // 그룹명은 한글·영문 둘 다 키로 둔다 — 같은 '그룹 이름'이라 확장 의도가 같다.
  "에스파": AESPA,
  "aespa": AESPA,
};

const INDEX: Map<string, string[]> = new Map(
  Object.entries(SEARCH_ALIAS_MAP).map(([k, v]) => [k.toLowerCase(), v.map((x) => x.toLowerCase())]),
);

/**
 * 검색어 한 토큰을 실제로 대조할 후보 목록으로 넓힌다.
 * 별칭 **키**가 아니면 자기 자신만 돌려준다(= 기존 동작 그대로).
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
