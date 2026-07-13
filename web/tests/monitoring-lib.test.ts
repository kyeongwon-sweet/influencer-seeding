import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pearson, solveLinear, multipleR2, movingAvg, weekKeyOf, weekLabelOf,
  padDomain, effectiveReach, alignedPairs, bestLag, parseCsvLine, pickRangeStats, viewIncrement, safeIncrement,
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

test("parseCsvLine: 따옴표·이스케이프·쉼표 처리", () => {
  assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(parseCsvLine('a, "b,c" , d'), ["a", "b,c", "d"]); // 따옴표 안 쉼표 보존 + trim
  assert.deepEqual(parseCsvLine('"he said ""hi"""'), ['he said "hi"']); // 이스케이프 ""
  assert.deepEqual(parseCsvLine("x,,z"), ["x", "", "z"]); // 빈 셀
});

// 🔒 필터 불변식 회귀 테스트 (2026-07-06 버그: 7/1~7/2 필터에 7/5 게시물이 +75,000 표시)
// pickRangeStats: 날짜 필터 중엔 범위 밖(latest_stats) 폴백 금지 — 모든 값 표면(행·합계·정렬·복사·CSV·카드)의 단일 규칙.
test("pickRangeStats+viewIncrement: 범위 밖 게시물은 값·증분 없음('-')", () => {
  const stat = (d: string, play: number | null) => ({ measured_at: d, play_count: play, likes_count: null, comments_count: null });
  const mkPost = (stats: ReturnType<typeof stat>[]) => ({
    id: "t", url: "https://www.instagram.com/p/X/", posted_at: "2026-07-05",
    product_name: null, project_name: null, account_name: null, company_name: null,
    channel_type: null, cost: null, reach_count: null, notes: null, content_summary: null,
    created_at: "2026-07-05", ended_at: null, influencers: null,
    latest_stats: stats[stats.length - 1] ?? null,
    prev_stats: stats.length > 1 ? stats[stats.length - 2] : null,
    all_stats: stats,
  });

  // ① 범위(7/1~7/2) 이후 업로드·측정된 게시물 → s/prev 모두 null, 증분 '-'(null). latest로 새면 안 됨.
  const late = mkPost([stat("2026-07-05", null), stat("2026-07-06", 75000)]);
  const r1 = pickRangeStats(late, "2026-07-01", "2026-07-02");
  assert.equal(r1.s, null);
  assert.equal(r1.prev, null);
  assert.equal(viewIncrement(late, r1.s, r1.prev), null);

  // ② 범위 내 2개 측정 → 정확한 전일대비 차이
  const both = mkPost([stat("2026-07-01", 100), stat("2026-07-02", 130), stat("2026-07-06", 999)]);
  const r2 = pickRangeStats(both, "2026-07-01", "2026-07-02");
  assert.equal(viewIncrement(both, r2.s, r2.prev), 30);

  // ③ 범위 내 1개 + 범위 밖 이전 실측 존재 → 직전 유효값(90) 기준 실제 증분(40). (안전규칙: 전체 history의 마지막 유효값 사용)
  const cut = mkPost([stat("2026-06-30", 90), stat("2026-07-02", 130)]);
  const r3 = pickRangeStats(cut, "2026-07-01", "2026-07-02");
  assert.equal(viewIncrement(cut, r3.s, r3.prev), 40);

  // ④ 진짜 신규(이전 유효 실측 전무, 범위 내 첫 측정) → 그날 값 전체가 증분(절대규칙: 업로드날 500=증분 500)
  const fresh = mkPost([stat("2026-07-02", 500)]);
  const r4 = pickRangeStats(fresh, "2026-07-01", "2026-07-02");
  assert.equal(viewIncrement(fresh, r4.s, r4.prev), 500);

  // ⑤ 필터 없음 → 기존 동작(latest/prev) 그대로
  const r5 = pickRangeStats(both, "", "");
  assert.equal(r5.s?.play_count, 999);
});

test("safeIncrement: 0 baseline 건너뛰되 첫 유효측정은 전체값(절대규칙)", () => {
  const st = (d: string, p: number | null, r: number | null = null) =>
    ({ measured_at: d, play_count: p, reach_count: r, likes_count: null, comments_count: null });
  const at = (arr: ReturnType<typeof st>[], d: string) => arr.find(x => x.measured_at === d)!;
  // 첫 유효 측정(직전 유효값 전무, 0만): 그날 값 전체가 증분(업로드날 성과) → 580000
  const a = [st("2026-07-05", 0), st("2026-07-06", 0), st("2026-07-07", 580000)];
  assert.equal(safeIncrement(a, at(a, "2026-07-07"), false), 580000);
  // 플라토(직전 실측 59307 후 0 글리치): 07-07은 '직전 유효값'(59307) 기준 실제 하루치 88 (0을 baseline으로 안 씀)
  const b = [st("2026-07-04", 59307), st("2026-07-05", 0), st("2026-07-06", 0), st("2026-07-07", 59395)];
  assert.equal(safeIncrement(b, at(b, "2026-07-07"), false), 88);
  // 배너: 도달수(reach) 기준 동일 규칙
  const c = [st("2026-07-05", null, 1000), st("2026-07-06", null, 1500)];
  assert.equal(safeIncrement(c, at(c, "2026-07-06"), true), 500);
  // 오늘 값이 0/누락이면 측정 안 됨 → 증분 아님
  assert.equal(safeIncrement(b, st("2026-07-09", 0), false), null);
});

test("safeIncrement: 첫 측정 전액은 '게시 후 7일 이내'만 — 백로그는 스파이크 방지로 제외", () => {
  const st = (d: string, p: number | null) =>
    ({ measured_at: d, play_count: p, reach_count: null, likes_count: null, comments_count: null });
  const one = [st("2026-07-20", 200000)];       // 첫(유일) 유효 측정
  // 게시 2일 뒤 첫 측정 = 진짜 첫날 성과 → 전액
  assert.equal(safeIncrement(one, one[0], false, "2026-07-18"), 200000);
  // 게시 19일 뒤 첫 측정 = 뒤늦게 추가된 백로그 → 그날 스파이크 방지로 제외(null)
  assert.equal(safeIncrement(one, one[0], false, "2026-07-01"), null);
  // posted_at 없으면 백로그 판정 불가 → 전액 유지(보수적, 기존 동작 보존)
  assert.equal(safeIncrement(one, one[0], false), 200000);
  assert.equal(safeIncrement(one, one[0], false, null), 200000);
});
