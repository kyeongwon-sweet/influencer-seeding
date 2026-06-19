// 누적 조회수 단조성 가드 (순수 함수, 테스트 가능)
//
// 규칙: play_count 는 누계이므로 measured_at 순서로 단조 비감소여야 한다.
// 신규 값이 "그보다 이른 날짜들의 최대"보다 낮으면 dip(수집/입력 오류)으로 보고 버린다.
// 과거의 정상적으로 낮은 값(백필)은 보존한다.
//
// stats-import 라우트가 이 함수를 사용한다. webhook/collect-now 는 단일 날짜 append라
// 더 단순한 가드(직전값 비교)를 인라인으로 쓴다.

export type StatPoint = { measured_at: string; play_count: number };
export type GuardInput = { post_id: string } & StatPoint;

export type GuardResult = {
  kept: GuardInput[];
  dropped: Array<GuardInput & { blocked_by: number; blocked_date: string }>;
};

/**
 * @param incoming 새로 적재하려는 값들 (post_id, measured_at, play_count)
 * @param existing 이미 저장된 값들 (단조성 판정 기준)
 * @returns kept = 저장할 값, dropped = 누적 감소로 제외된 값(진단용 메타 포함)
 */
export function filterMonotonicStats(incoming: GuardInput[], existing: GuardInput[]): GuardResult {
  const incomingByPost = new Map<string, GuardInput[]>();
  for (const r of incoming) {
    const arr = incomingByPost.get(r.post_id) ?? [];
    arr.push(r);
    incomingByPost.set(r.post_id, arr);
  }
  const existingByPost = new Map<string, GuardInput[]>();
  for (const r of existing) {
    const arr = existingByPost.get(r.post_id) ?? [];
    arr.push(r);
    existingByPost.set(r.post_id, arr);
  }

  const kept: GuardInput[] = [];
  const dropped: GuardResult["dropped"] = [];

  for (const [pid, incomingArr] of incomingByPost) {
    const incomingDates = new Set(incomingArr.map(x => x.measured_at));
    const timeline = [
      ...(existingByPost.get(pid) ?? [])
        .filter(e => !incomingDates.has(e.measured_at))
        .map(e => ({ ...e, incoming: false })),
      ...incomingArr.map(e => ({ ...e, incoming: true })),
    ].sort((a, b) => (a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : 0));

    let maxSoFar = 0;
    let maxDate = "";
    for (const e of timeline) {
      if (e.incoming) {
        if (e.play_count >= maxSoFar) {
          kept.push({ post_id: pid, measured_at: e.measured_at, play_count: e.play_count });
          maxSoFar = e.play_count;
          maxDate = e.measured_at;
        } else {
          dropped.push({
            post_id: pid,
            measured_at: e.measured_at,
            play_count: e.play_count,
            blocked_by: maxSoFar,
            blocked_date: maxDate,
          });
        }
      } else if (e.play_count > maxSoFar) {
        maxSoFar = e.play_count;
        maxDate = e.measured_at;
      }
    }
  }

  return { kept, dropped };
}
