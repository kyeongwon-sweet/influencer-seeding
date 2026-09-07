// 페이지 단위 조회의 '조용한 부분 실패'를 막는 공용 헬퍼.
//
// 왜 필요한가 (2026-09-07): 대시보드는 `post_daily_stats` 전량을 페이지로 나눠 병렬 조회한다.
// 한 페이지가 실패하면 최대 PAGE행이 빠지는데, 그 안에 어떤 게시물의 '직전 유효값'이 있으면
// safeIncrement 의 baseline 이 더 낮은 옛 값으로 내려앉아 **증분이 부풀려진다.**
// 실데이터 시뮬레이션: 페이지 1개 드롭만으로 활성 279건 증분 과대(최악 19,140 → 238,609),
// 기준선 행이 든 페이지를 떨어뜨리면 2026-09-03 사고 값(63,801 → 180,654)이 그대로 재현됐다.
//
// 정책(절대규칙 준수): 값을 추정·보정하지 않는다. 실패는 ① 1회 재시도 ② 그래도 실패하면
// `missingPages` 로 **세어서 호출부가 알릴 수 있게** 한다. 조용히 넘기지 않는다.

// 부분 응답 신호 헤더 이름 — 라우트(쓰는 쪽)와 대시보드(읽는 쪽)가 **같은 상수**를 쓴다.
// 문자열을 양쪽에 따로 적으면 한쪽만 바뀌었을 때 경고가 조용히 사라진다(경고를 위한 코드가 조용히 실패).
export const PARTIAL_HEADER = "X-Stats-Partial";
export const MISSING_PAGES_HEADER = "X-Stats-Missing-Pages";
export const POSTS_TRUNCATED_HEADER = "X-Posts-Truncated";

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };
export type PageFetcher<T> = (offset: number) => Promise<PageResult<T>>;

/** 한 페이지를 조회하고, 실패하면 **1회만** 재시도한다. */
export async function fetchPageWithRetry<T>(
  offset: number,
  fetchPage: PageFetcher<T>,
): Promise<PageResult<T>> {
  const first = await fetchPage(offset);
  if (!first.error) return first;
  return fetchPage(offset);
}

/**
 * 주어진 오프셋들을 병렬 조회하고, 실패한 것만 1회 재시도한다.
 * 재시도 후에도 실패한 페이지 수를 `missingPages` 로 돌려준다(0이면 완전한 응답).
 *
 * ⚠️ 재시도로 늦게 도착한 페이지는 배열 뒤에 붙는다 — 호출부는 measured_at 기준으로 다시 정렬하므로
 *    순서에 의존하지 않는다(라우트가 `asc` 로 재정렬함).
 */
export async function fetchPagesWithRetry<T>(
  offsets: number[],
  fetchPage: PageFetcher<T>,
  onError?: (message: string, offset: number, phase: "first" | "retry") => void,
): Promise<{ rows: T[]; missingPages: number }> {
  const rows: T[] = [];
  const retryOffsets: number[] = [];

  const first = await Promise.all(offsets.map((offset) => fetchPage(offset)));
  first.forEach((result, i) => {
    if (result.error) {
      onError?.(result.error.message, offsets[i], "first");
      retryOffsets.push(offsets[i]);
      return;
    }
    rows.push(...(result.data ?? []));
  });

  let missingPages = 0;
  if (retryOffsets.length > 0) {
    const retried = await Promise.all(retryOffsets.map((offset) => fetchPage(offset)));
    retried.forEach((result, i) => {
      if (result.error) {
        onError?.(result.error.message, retryOffsets[i], "retry");
        missingPages += 1;
        return;
      }
      rows.push(...(result.data ?? []));
    });
  }

  return { rows, missingPages };
}
