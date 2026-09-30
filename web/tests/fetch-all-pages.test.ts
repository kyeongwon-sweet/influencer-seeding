// PostgREST 1,000행 상한 절단 방지 — 행동 계약 + 라우트 배선 계약.
//
// 사고(2026-09-30 실측): 메인 그래프의 구글 검색량 선이 8월 중순에서 끊겨 보였다. 수집은 정상이었고
// (`google_search_trends` 05-12~09-30, 1,505행), `/api/google-trends` 가 페이지를 넘기지 않아
// 오름차순 앞 1,000행만 받고 있었다. 데이터는 매일 늘어도 화면은 같은 날짜에 멈춰 있어
// "수집이 끊겼다"로 오진하기 쉽다. 조사하던 Claude 도 같은 1,000행 절단에 걸려 처음엔
// "08-19부터 42일 공백"이라고 잘못 보고했다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAllPages, PAGE_SIZE } from "../lib/fetch-all-pages.ts";

type Row = { i: number };

/** 서버처럼 굴러가는 가짜: 한 번에 최대 PAGE_SIZE 행, 요청 범위를 기록한다. */
function fakeServer(total: number, opts: { failAtFrom?: number; alwaysFull?: boolean } = {}) {
  const calls: Array<[number, number]> = [];
  const all: Row[] = Array.from({ length: total }, (_, i) => ({ i }));
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    if (opts.failAtFrom === from) return { data: null, error: { message: "boom" } };
    if (opts.alwaysFull) return { data: Array.from({ length: to - from + 1 }, (_, k) => ({ i: from + k })), error: null };
    return { data: all.slice(from, Math.min(to + 1, from + PAGE_SIZE)), error: null };
  };
  return { fetchPage, calls };
}

test("사고 재현: 1,505행이면 1,000행에서 멈추지 않고 전부 받는다", async () => {
  const { fetchPage, calls } = fakeServer(1505);
  const { data, error } = await fetchAllPages<Row>(fetchPage);
  assert.equal(error, null);
  assert.equal(data.length, 1505, "앞 1,000행만 오면 그래프가 8월 중순에서 끊긴다");
  assert.equal(data[1504].i, 1504, "가장 최근 행까지 와야 한다");
  assert.deepEqual(calls, [[0, 999], [1000, 1999]]);
});

test("1,000행 미만이면 한 번만 부른다", async () => {
  const { fetchPage, calls } = fakeServer(401);
  const { data } = await fetchAllPages<Row>(fetchPage);
  assert.equal(data.length, 401);
  assert.equal(calls.length, 1);
});

test("정확히 1,000의 배수면 빈 페이지를 한 번 더 확인하고 끝낸다", async () => {
  const { fetchPage, calls } = fakeServer(2000);
  const { data, error } = await fetchAllPages<Row>(fetchPage);
  assert.equal(error, null);
  assert.equal(data.length, 2000);
  assert.equal(calls.length, 3);
});

test("중간 페이지가 실패하면 앞부분만 성공처럼 돌려주지 않는다", async () => {
  const { fetchPage } = fakeServer(1505, { failAtFrom: 1000 });
  const { data, error } = await fetchAllPages<Row>(fetchPage);
  assert.equal(error, "boom");
  assert.equal(data.length, 0, "잘린 1,000행을 정상 응답으로 내보내는 것이 이 버그 자체였다");
});

test("페이지 상한에 닿으면 조용히 자르지 않고 error 로 알린다", async () => {
  const { fetchPage } = fakeServer(0, { alwaysFull: true });
  const { data, error } = await fetchAllPages<Row>(fetchPage, 10, 3);
  assert.equal(data.length, 0);
  assert.match(String(error), /상한/);
});

// ── 라우트 배선 계약 ─────────────────────────────────────────────────────
// 메인 그래프 보조 시리즈 4개. 하나라도 맨 `.order()` 로 돌아가면 그 테이블이 1,000행을 넘는 날
// 조용히 끊긴다(유튜브 검색량은 하루 2행씩 늘어 약 10개월 뒤 도달).
const ROUTES: Array<{ name: string; uniqueOrder: string[] }> = [
  { name: "google-trends", uniqueOrder: ['.order("measured_at"', '.order("keyword"'] },
  { name: "youtube-trends", uniqueOrder: ['.order("measured_at"', '.order("keyword"'] },
  { name: "brand-metrics", uniqueOrder: ['.order("measured_at"'] },
  { name: "b2b-revenue", uniqueOrder: ['.order("date"'] },
];

for (const { name, uniqueOrder } of ROUTES) {
  test(`/api/${name} 는 fetchAllPages 로 끝까지 넘기고 유일 키로 정렬한다`, () => {
    const src = readFileSync(join(import.meta.dirname, "..", "app", "api", name, "route.ts"), "utf8");
    assert.match(src, /fetchAllPages\(/, "페이지를 넘기지 않으면 1,000행에서 잘린다");
    assert.match(src, /\.range\(/, "fetchAllPages 에 range 를 넘겨야 실제로 페이지가 넘어간다");
    for (const o of uniqueOrder) assert.ok(src.includes(o), `${o} 정렬이 빠지면 경계 행이 빠지거나 겹친다`);
  });
}
