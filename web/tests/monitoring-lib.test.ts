import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pearson, solveLinear, multipleR2, movingAvg, weekKeyOf, weekLabelOf,
  padDomain, effectiveReach, alignedPairs, bestLag, getPostType,
} from "../app/monitoring/lib.ts";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("pearson: 완전 양/음 상관, 무분산, 표본부족", () => {
  assert.ok(close(pearson([1, 2, 3], [2, 4, 6])!, 1));
  assert.ok(close(pearson([1, 2, 3], [3, 2, 1])!, -1));
  assert.equal(pearson([5, 5, 5], [1, 2, 3]), null); // x 분산 0
  assert.equal(pearson([1], [2]), null);             // n<2
});

test("solveLinear: 대각 행렬 해 / 특이행렬 null", () => {
  const x = solveLinear([[2, 0], [0, 3]], [4, 9]);
  assert.ok(x && close(x[0], 2) && close(x[1], 3));
  assert.equal(solveLinear([[1, 1], [1, 1]], [2, 2]), null); // 특이
});

test("multipleR2: 완전 선형이면 ~1, 표본 부족이면 null", () => {
  // y = 2*x1 + 1 (완전 적합) — n=6, k=1 → n>=k+3 충족
  const x1 = [1, 2, 3, 4, 5, 6];
  const Y = x1.map(v => 2 * v + 1);
  const r2 = multipleR2(Y, [x1]);
  assert.ok(r2 != null && close(r2, 1, 1e-6));
  assert.equal(multipleR2([1, 2], [[1, 2]]), null); // n<k+3
});

test("movingAvg: trailing 평균, null 제외", () => {
  const rows = [{ v: 10 }, { v: 20 }, { v: 30 }];
  const out = movingAvg(rows, "v", 2);
  assert.equal(out[0].v, 10);
  assert.equal(out[1].v, 15); // (10+20)/2
  assert.equal(out[2].v, 25); // (20+30)/2
});

test("weekKeyOf / weekLabelOf: 월 주차", () => {
  assert.equal(weekKeyOf("2026-05-03"), "2026-05-1"); // ceil(3/7)=1
  assert.equal(weekKeyOf("2026-05-15"), "2026-05-3"); // ceil(15/7)=3
  assert.equal(weekLabelOf("2026-05-3"), "5월 3주차");
});

test("padDomain: 변화폭 작으면 최소 폭 확보, 충분하면 그대로", () => {
  assert.deepEqual(padDomain(0, 100), [0, 100]);        // 충분
  const [lo, hi] = padDomain(99, 100, 0.1);             // span 1 < 100*0.1=10
  assert.ok(lo < 99 && hi > 100 && close(hi - lo, 10));
});

test("effectiveReach: 입력값 우선, 없으면 조회수 80%, 둘 다 없으면 null", () => {
  assert.equal(effectiveReach(500, 1000), 500);
  assert.equal(effectiveReach(null, 1000), 800);
  assert.equal(effectiveReach(null, 0), null);
  assert.equal(effectiveReach(null, null), null);
});

test("alignedPairs / bestLag: lag 정렬 + 최적 시차 탐지", () => {
  // x가 1일 선행하면 lag=1에서 완전 상관
  const x = new Map([["2026-06-01", 1], ["2026-06-02", 2], ["2026-06-03", 3]]);
  const y = new Map([["2026-06-02", 1], ["2026-06-03", 2], ["2026-06-04", 3]]);
  const [xs, ys] = alignedPairs(x, y, 1);
  assert.deepEqual(xs, [1, 2, 3]);
  assert.deepEqual(ys, [1, 2, 3]);
  const best = bestLag(x, y, 3);
  assert.ok(best && best.lag === 1 && close(Math.abs(best.r), 1));
});

test("getPostType: 플랫폼/형식 판별", () => {
  assert.equal(getPostType("https://instagram.com/reel/X/"), "릴스");
  assert.equal(getPostType("https://instagram.com/p/X/"), "피드");
  assert.equal(getPostType("https://youtube.com/shorts/X"), "숏폼");
  assert.equal(getPostType("https://youtube.com/watch?v=X"), "롱폼");
  assert.equal(getPostType("https://example.com/x"), "-");
});
