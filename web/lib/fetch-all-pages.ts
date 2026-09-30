// PostgREST(Supabase) 서버는 한 번에 **최대 1,000행**만 돌려준다. `.select().order()` 만 쓰면
// 그 이상은 조용히 잘리고, error 도 없이 앞의 1,000행만 온다.
//
// 사고(2026-09-30 실측): 협찬 모니터링 메인 그래프의 구글 검색량 선이 8월 중순에서 끊겨 보였다.
// 수집은 정상이었다 — `google_search_trends` 는 05-12~09-30 전 키워드가 쌓여 있었고(1,505행),
// `/api/google-trends` 가 오름차순 앞 1,000행(~08월 중순)만 받아 화면에 넘기고 있었다.
// 데이터는 매일 늘어도 화면은 같은 날짜에 영원히 멈춰 있는 구조라, "수집이 멈췄다"로 오진하기 쉽다.
//
// 이 헬퍼는 짧은 페이지가 나올 때까지 끝까지 넘긴다.
//   ⚠️ 호출부는 **유일한** 정렬 키로 정렬해야 한다(예: measured_at + keyword). 중복 키만으로
//      페이지를 넘기면 경계 행이 빠지거나 두 번 들어온다.
//   ⚠️ 중간 페이지가 실패하면 **일부만 성공처럼 돌려주지 않는다** — error 로 알린다.
//      잘린 데이터를 정상 응답으로 내보내는 것이 이 버그 자체였다.

export const PAGE_SIZE = 1000;

// 폭주 방지. 이 상한에 닿으면 조용히 자르지 않고 error 로 알린다(10만 행).
export const MAX_PAGES = 100;

export type PageResponse<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: [], error: error.message };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return { data: rows, error: null };
  }
  return {
    data: [],
    error: `페이지 상한(${maxPages}×${pageSize}행)에 도달 — 잘린 응답을 정상처럼 보내지 않습니다`,
  };
}
