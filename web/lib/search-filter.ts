// 검색창 매칭 헬퍼 — 포함(include) + 제외(exclude)를 한 입력창에서 지원한다.
// 규칙: 공백으로 나눈 토큰 중
//   · `-단어`  → 제외어(그 단어를 포함하면 탈락)
//   · 그 외    → 포함어(모두 포함해야 통과 = AND)
// 예)
//   "딸기"          → '딸기' 포함
//   "딸기 -광고"    → '딸기' 포함 && '광고' 미포함
//   "-샘플"         → '샘플' 미포함(그 외 전부)
//   "바이럴 영상"   → '바이럴' AND '영상' 둘 다 포함
// 대소문자 무시. 빈 검색어는 항상 통과(필터 없음).
export function matchesSearch(
  haystack: string | null | undefined,
  query: string | null | undefined,
): boolean {
  const q = (query ?? "").trim();
  if (!q) return true;
  const h = (haystack ?? "").toLowerCase();
  let includeOk = true;
  for (const raw of q.split(/\s+/)) {
    if (!raw || raw === "-") continue; // 빈 토큰·단독 '-'는 무시
    if (raw.startsWith("-")) {
      if (h.includes(raw.slice(1).toLowerCase())) return false; // 제외어 포함 → 즉시 탈락
    } else if (!h.includes(raw.toLowerCase())) {
      includeOk = false; // 포함어 누락 → 탈락(단, 제외어 검사는 계속)
    }
  }
  return includeOk;
}
