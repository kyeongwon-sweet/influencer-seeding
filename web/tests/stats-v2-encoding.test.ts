import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeStatsV2 } from "../app/monitoring/lib.ts";

/**
 * `/api/sponsored-posts`는 일별 이력을 튜플(stats_v2)로 보낸다 — 응답 5.51MB → 2.76MB(실측).
 * 이 테스트는 **인코딩이 값을 바꾸지 않는다**는 것과, 라우트/클라이언트의 **필드 순서가 어긋나지
 * 않는다**는 것을 고정한다. 순서가 어긋나면 조회수 자리에 좋아요가 들어가 증분이 조용히 망가진다.
 */

const route = readFileSync(new URL("../app/api/sponsored-posts/route.ts", import.meta.url), "utf8");

test("라우트의 튜플 생성 순서가 디코더와 일치한다", () => {
  // 라우트의 statsV2 생성 블록을 뽑아 필드 순서를 확인한다.
  const block = route.slice(route.indexOf("const statsV2"), route.indexOf("stats_v2: statsV2"));
  const order = [...block.matchAll(/s\.(play_count|likes_count|comments_count|reach_count|play_collected)/g)].map(m => m[1]);
  assert.deepEqual(order, ["play_count", "likes_count", "comments_count", "reach_count", "play_collected"]);
  // 측정일은 YYYY-MM-DD로 잘라 보낸다(디코더가 그대로 measured_at에 넣는다).
  assert.match(block, /String\(s\.measured_at\)\.slice\(0, 10\)/);
});

test("디코드 결과가 기존 all_stats 객체 모양과 동일하다", () => {
  const decoded = decodeStatsV2([["2026-08-01", 1234, 56, 7, null, 1]]);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], {
    measured_at: "2026-08-01",
    play_count: 1234,
    likes_count: 56,
    comments_count: 7,
    reach_count: null,
    play_collected: true,
  });
});

test("배너 행(조회수 없음·도달수만)도 그대로 보존된다", () => {
  const [row] = decodeStatsV2([["2026-08-02", null, null, null, 15668, 0]]);
  assert.equal(row.play_count, null);      // ⚠️ 빈 값을 0으로 바꾸지 않는다(공백≠0)
  assert.equal(row.reach_count, 15668);
  assert.equal(row.play_collected, false);
});

test("0과 null을 구분한다", () => {
  const [zero] = decodeStatsV2([["2026-08-03", 0, 0, 0, 0, 1]]);
  assert.equal(zero.play_count, 0);
  assert.notEqual(zero.play_count, null);
  const [nul] = decodeStatsV2([["2026-08-03", null, null, null, null, 0]]);
  assert.equal(nul.play_count, null);
});

test("순서가 보존된다(증분은 인접 두 값의 차이라 순서가 곧 정확성)", () => {
  const rows = decodeStatsV2([
    ["2026-08-01", 100, null, null, null, 1],
    ["2026-08-02", 250, null, null, null, 1],
    ["2026-08-03", 400, null, null, null, 1],
  ]);
  assert.deepEqual(rows.map(r => r.measured_at), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.deepEqual(rows.map(r => r.play_count), [100, 250, 400]);
});

test("깨진 입력은 값을 지어내지 않고 버린다", () => {
  assert.deepEqual(decodeStatsV2(undefined), []);
  assert.deepEqual(decodeStatsV2(null), []);
  assert.deepEqual(decodeStatsV2("nope"), []);
  assert.deepEqual(decodeStatsV2([["2026-08-01", 1]]), []);        // 길이 부족 → 버림
  assert.equal(decodeStatsV2([["2026-08-01", 1, 2, 3, 4, 1], "x"]).length, 1);
});
