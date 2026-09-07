// 대시보드 통계 페이지 조회의 '조용한 부분 실패' 방지 — 행동 계약.
//
// 배경(2026-09-07 실측): `post_daily_stats` 전량을 64개 페이지로 병렬 조회하는데, 한 페이지가
// 실패하면 최대 1,000행이 조용히 빠졌다. 그 안에 어떤 게시물의 '직전 유효값'이 있으면
// safeIncrement 의 baseline 이 더 낮은 옛 값으로 내려앉아 증분이 부풀려진다.
// 시뮬레이션에서 페이지 1개 드롭만으로 활성 279건이 과대해졌고(최악 19,140 → 238,609),
// 기준선 행이 든 페이지를 떨어뜨리면 2026-09-03 사고 값(63,801 → 180,654)이 재현됐다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fetchPageWithRetry,
  fetchPagesWithRetry,
  MISSING_PAGES_HEADER,
  PARTIAL_HEADER,
  POSTS_TRUNCATED_HEADER,
  type PageResult,
} from "../lib/stats-pages.ts";

type Row = { id: string };

/** offset 별로 '몇 번째 호출까지 실패시킬지'를 지정하는 가짜 조회기. 호출 횟수도 센다. */
function fakeFetcher(failTimes: Record<number, number>) {
  const calls: number[] = [];
  const fetchPage = async (offset: number): Promise<PageResult<Row>> => {
    calls.push(offset);
    const seen = calls.filter((o) => o === offset).length;
    if ((failTimes[offset] ?? 0) >= seen) {
      return { data: null, error: { message: `boom@${offset}` } };
    }
    return { data: [{ id: `row-${offset}` }], error: null };
  };
  return { fetchPage, calls };
}

test("모든 페이지 성공: 전 행 수집, 누락 0, 페이지당 1회만 호출", async () => {
  const { fetchPage, calls } = fakeFetcher({});
  const { rows, missingPages } = await fetchPagesWithRetry([0, 1000, 2000], fetchPage);
  assert.equal(missingPages, 0);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["row-0", "row-1000", "row-2000"]);
  assert.equal(calls.length, 3, "성공 페이지를 불필요하게 재조회하면 안 된다");
});

test("일시 실패는 재시도로 복구된다 — 행 손실 0, 누락 0", async () => {
  const { fetchPage, calls } = fakeFetcher({ 1000: 1 });
  const { rows, missingPages } = await fetchPagesWithRetry([0, 1000, 2000], fetchPage);
  assert.equal(missingPages, 0, "재시도로 복구됐으면 부분 응답이 아니다");
  assert.deepEqual(rows.map((r) => r.id).sort(), ["row-0", "row-1000", "row-2000"]);
  assert.equal(calls.filter((o) => o === 1000).length, 2, "실패 페이지는 정확히 1회 재시도");
});

test("재시도까지 실패하면 누락으로 '센다' — 나머지 행은 보존, 값은 지어내지 않는다", async () => {
  const { fetchPage, calls } = fakeFetcher({ 1000: 2 });
  const { rows, missingPages } = await fetchPagesWithRetry([0, 1000, 2000], fetchPage);
  assert.equal(missingPages, 1, "조용히 넘어가면 안 된다 — 호출부가 알 수 있어야 한다");
  assert.deepEqual(rows.map((r) => r.id).sort(), ["row-0", "row-2000"]);
  assert.equal(calls.filter((o) => o === 1000).length, 2, "무한 재시도 금지 — 정확히 2회(최초+재시도)");
});

test("여러 페이지가 실패하면 누락 수가 그만큼 센다", async () => {
  const { fetchPage } = fakeFetcher({ 0: 2, 2000: 2 });
  const { rows, missingPages } = await fetchPagesWithRetry([0, 1000, 2000], fetchPage);
  assert.equal(missingPages, 2);
  assert.deepEqual(rows.map((r) => r.id), ["row-1000"]);
});

test("fetchPageWithRetry: 첫 실패는 복구, 두 번 실패는 error 를 그대로 돌려준다", async () => {
  const once = fakeFetcher({ 0: 1 });
  const ok = await fetchPageWithRetry(0, once.fetchPage);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.data, [{ id: "row-0" }]);
  assert.equal(once.calls.length, 2);

  const twice = fakeFetcher({ 0: 2 });
  const bad = await fetchPageWithRetry(0, twice.fetchPage);
  assert.ok(bad.error, "재시도까지 실패하면 error 를 숨기지 않는다");
  assert.equal(twice.calls.length, 2, "정확히 1회만 재시도");
});

test("헤더 이름은 라우트·대시보드가 같은 상수를 쓴다(문자열 하드코딩 금지)", () => {
  const root = process.cwd();
  const route = readFileSync(join(root, "app/api/sponsored-posts/route.ts"), "utf8");
  const page = readFileSync(join(root, "app/monitoring/page.tsx"), "utf8");

  for (const [name, value] of [
    ["PARTIAL_HEADER", PARTIAL_HEADER],
    ["MISSING_PAGES_HEADER", MISSING_PAGES_HEADER],
    ["POSTS_TRUNCATED_HEADER", POSTS_TRUNCATED_HEADER],
  ] as const) {
    assert.ok(route.includes(name), `route 가 ${name} 상수를 써야 한다`);
    assert.ok(page.includes(name), `monitoring/page 가 ${name} 상수를 써야 한다`);
    assert.ok(!route.includes(`"${value}"`), `route 에 ${value} 리터럴을 하드코딩하지 말 것`);
    assert.ok(!page.includes(`"${value}"`), `page 에 ${value} 리터럴을 하드코딩하지 말 것`);
  }
});

test("라우트는 부분 실패가 아닐 때 경고 헤더를 붙이지 않는다", () => {
  const route = readFileSync(join(process.cwd(), "app/api/sponsored-posts/route.ts"), "utf8");
  assert.match(
    route,
    /const partial = postsTruncated \|\| missingStatPages > 0;/,
    "부분 실패 판정은 '게시물 절단 또는 통계 페이지 누락'이어야 한다",
  );
  assert.match(route, /\.\.\.\(partial\s*\?/, "헤더는 partial 일 때만 조건부로 붙여야 한다");
});

test("대시보드는 부분 응답 상태를 실제 경고 UI에 묶는다", () => {
  const page = readFileSync(join(process.cwd(), "app/monitoring/page.tsx"), "utf8");
  // 상태를 만들어만 두고 화면에 쓰지 않으면 '경고를 넣었다'가 거짓이 된다.
  assert.match(page, /setStatsPartial\(/, "loadPosts 가 부분 응답 상태를 설정해야 한다");
  assert.match(page, /\{statsPartial && \(/, "경고 블록이 statsPartial 에 조건부로 묶여야 한다");
  assert.match(page, /role="alert"/, "경고는 스크린리더에도 알려져야 한다");
  assert.match(page, /증분이 실제보다 크게 보일 수 있습니다/, "무엇이 왜곡되는지 사람이 알 수 있어야 한다");
});
