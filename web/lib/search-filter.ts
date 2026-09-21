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
// 대소문자 무시. 빈 검색어는 항상 통과(필터 없음).
//
// ⚠️ 쉼표가 없으면 덩어리가 하나뿐이라 **기존 동작과 완전히 같다**(회귀 방지 테스트로 고정).
// ⚠️ 데이터(계정명·소재명·캡션)에 쉼표가 들어 있어도 문제되지 않는다 — 쉼표는 *질의*를 나눌 뿐이고,
//    쉼표 섞인 값을 그대로 붙여넣어도 각 조각이 OR 로 걸려 그 행은 여전히 잡힌다(실측 확인 2026-09-21).
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
        if (h.includes(raw.slice(1).toLowerCase())) return false; // 제외어 포함 → 즉시 탈락
      } else {
        includes.push(raw.toLowerCase());
      }
    }
    if (includes.length) groups.push(includes);
  }

  // 포함어가 하나도 없는 질의(예: "-샘플")는 제외 조건만 본다 — 기존 동작 유지.
  if (groups.length === 0) return true;
  return groups.some((tokens) => tokens.every((t) => h.includes(t)));
}
