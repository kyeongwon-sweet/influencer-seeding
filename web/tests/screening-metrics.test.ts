import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adEfficiency,
  calcMetrics,
  excludeOutlierPosts,
  isLegacyScreening,
  median,
  SCREENING_FORMULA,
} from "../lib/screeningMetrics.ts";

// 2026-11-20 사용자 결정: 평균에서 '떡상 글'(보통 조회수=중앙값의 3배 초과)만 빼고 평균한다.
// 화면 설명은 원래 "알고리즘 떡상 건 제외"였는데 코드는 단순 평균이라 대박 글 하나가 계수를 끌어올렸다.

const NOW = new Date("2026-11-20T03:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();
const reel = (play: number, d = 1, extra: Record<string, unknown> = {}) =>
  ({ videoPlayCount: play, videoViewCount: Math.round(play / 2), timestamp: daysAgo(d), productType: "clips", ...extra });

test("중앙값: 홀수·짝수·빈 목록", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("사용자에게 보여 준 예시 그대로: 3·4·5·5·60만 → 60만 제외 → 4.25만", () => {
  const posts = [30000, 40000, 50000, 50000, 600000].map((v) => reel(v));
  const m = calcMetrics({ followers: 50000 }, posts, NOW);
  assert.equal(m.total_avg_play_count, 42500);
  assert.equal(m.outliers_excluded, 1);
  assert.equal(m.avg_views_per_follower, 0.85); // 42,500 ÷ 50,000
  // 100만뷰·게시물 수는 떡상을 세는 지표라 그대로 센다
  assert.equal(m.total_posts, 5);
  // 도달수 평균도 같은 글을 뺀다(같은 '총 평균' 묶음)
  assert.equal(m.total_avg_view_count, 21250);
});

test("경계: 정확히 3배는 남기고, 3배를 '넘는' 글만 뺀다", () => {
  const { typical, excluded } = excludeOutlierPosts([10, 10, 30, 31].map((v) => reel(v)));
  // 중앙값 = (10+30)/2 = 20 → 한계 60 → 아무것도 안 빠짐
  assert.equal(excluded, 0);
  assert.equal(typical.length, 4);
  const r2 = excludeOutlierPosts([10, 10, 10, 30, 31].map((v) => reel(v)));
  // 중앙값 10 → 한계 30 → 30은 남고 31만 빠짐
  assert.equal(r2.excluded, 1);
  assert.deepEqual(r2.typical.map((p) => p.videoPlayCount), [10, 10, 10, 30]);
});

test("떡상이 없으면 옛 단순 평균과 같다(평범한 계정 숫자는 그대로)", () => {
  const posts = [40000, 50000, 60000, 70000].map((v) => reel(v));
  const m = calcMetrics({ followers: 100000 }, posts, NOW);
  assert.equal(m.total_avg_play_count, 55000);
  assert.equal(m.outliers_excluded, 0);
});

test("조회수 없는 사진 글은 빼지 않고 평균에서도 빠진다 / 중앙값 0이면 아무것도 안 뺀다", () => {
  const photo = { timestamp: daysAgo(1), type: "Image" };
  const r = excludeOutlierPosts([reel(10), reel(10), reel(100), photo]);
  assert.equal(r.excluded, 1);
  assert.ok(r.typical.includes(photo));
  const zeros = excludeOutlierPosts([reel(0), reel(0), reel(500)]);
  assert.equal(zeros.excluded, 0);
});

test("30일 밖 글은 평균에도 떡상 판정에도 안 들어간다", () => {
  const posts = [reel(10000), reel(10000), reel(10000), reel(9_000_000, 45)];
  const m = calcMetrics({ followers: 10000 }, posts, NOW);
  assert.equal(m.total_posts, 3);
  assert.equal(m.total_avg_play_count, 10000);
  assert.equal(m.count_1m_view, 0);
});

test("팔로워를 모르면 알고리즘 계수는 빈칸(null)", () => {
  const m = calcMetrics({ followers: 0 }, [reel(1000)], NOW);
  assert.equal(m.avg_views_per_follower, null);
});

test("광고 효율 = (광고 평균 − 일반 평균) ÷ 10,000 (화면 설명과 같은 식)", () => {
  assert.equal(adEfficiency({ ad_avg_play_count: 80000, general_avg_play_count: 50000 }), 3);
  assert.equal(adEfficiency({ ad_avg_play_count: null, general_avg_play_count: 50000 }), null);
  assert.equal(adEfficiency(null), null);
});

test("옛 계산 표시: 자동 계산 행 중 새 공식 표시가 없는 것만", () => {
  assert.equal(isLegacyScreening({ criteria_snapshot: { result: "no_criteria", details: [] } }), true);
  assert.equal(isLegacyScreening({ criteria_snapshot: { result: "no_criteria", details: [], formula: SCREENING_FORMULA } }), false);
  // 수기 입력 행(스냅샷 없음)은 옛 계산이 아니다
  assert.equal(isLegacyScreening({ criteria_snapshot: null }), false);
  assert.equal(isLegacyScreening(null), false);
});

test("웹훅이 정본 모듈을 쓰고, 유튜브 대표 지표는 쇼츠만·공식 표시를 남긴다(소스 계약)", () => {
  const src = readFileSync(join(import.meta.dirname, "../app/api/apify-webhook/route.ts"), "utf8");
  assert.match(src, /from "@\/lib\/screeningMetrics"/);
  assert.doesNotMatch(src, /function calcMetrics\(/, "공식이 두 곳에 있으면 다시 갈라진다");
  assert.match(src, /calcMetrics\(profile, shorts\)/);
  assert.equal((src.match(/formula: SCREENING_FORMULA, outliers_excluded/g) ?? []).length, 2);
  // DB 컬럼이 아닌 outliers_excluded 를 insert 에 펼치면 insert 가 실패한다 → 꺼내서 스냅샷에만 담는다
  assert.equal((src.match(/const \{ outliers_excluded, \.\.\.metrics \} = calcMetrics/g) ?? []).length, 2);
});
