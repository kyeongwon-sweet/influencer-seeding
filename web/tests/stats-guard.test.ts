import { test } from "node:test";
import assert from "node:assert/strict";
import { filterMonotonicStats, type GuardInput } from "../lib/stats-guard.ts";

const P = "post-1";

test("정상 증가분은 모두 보존", () => {
  const incoming: GuardInput[] = [
    { post_id: P, measured_at: "2026-06-01", play_count: 100 },
    { post_id: P, measured_at: "2026-06-02", play_count: 150 },
    { post_id: P, measured_at: "2026-06-03", play_count: 150 }, // 동일값(>=)도 허용
  ];
  const { kept, dropped } = filterMonotonicStats(incoming, []);
  assert.equal(kept.length, 3);
  assert.equal(dropped.length, 0);
});

test("이른 날짜 최대보다 낮은 신규 값은 dip으로 제외", () => {
  const incoming: GuardInput[] = [
    { post_id: P, measured_at: "2026-06-01", play_count: 100 },
    { post_id: P, measured_at: "2026-06-02", play_count: 80 }, // 감소 → 버림
    { post_id: P, measured_at: "2026-06-03", play_count: 120 },
  ];
  const { kept, dropped } = filterMonotonicStats(incoming, []);
  assert.deepEqual(kept.map(k => k.measured_at), ["2026-06-01", "2026-06-03"]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].measured_at, "2026-06-02");
  assert.equal(dropped[0].blocked_by, 100);
  assert.equal(dropped[0].blocked_date, "2026-06-01");
});

test("기존 값보다 낮은 신규 값도 제외 (기존 DB 대비 단조성)", () => {
  const existing: GuardInput[] = [{ post_id: P, measured_at: "2026-06-05", play_count: 500 }];
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-06-06", play_count: 400 }];
  const { kept, dropped } = filterMonotonicStats(incoming, existing);
  assert.equal(kept.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].blocked_by, 500);
});

test("과거 날짜 백필의 정상적인 낮은 값은 보존 (이른 날짜이므로 OK)", () => {
  const existing: GuardInput[] = [{ post_id: P, measured_at: "2026-06-10", play_count: 1000 }];
  // 6/01 은 6/10 보다 이른 날짜 → 1000보다 낮아도 정상(과거)
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-06-01", play_count: 200 }];
  const { kept, dropped } = filterMonotonicStats(incoming, existing);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].play_count, 200);
  assert.equal(dropped.length, 0);
});

test("게시물별로 독립 판정", () => {
  const incoming: GuardInput[] = [
    { post_id: "a", measured_at: "2026-06-02", play_count: 50 },  // a: 단독 → 보존
    { post_id: "b", measured_at: "2026-06-02", play_count: 10 },  // b: 기존 100보다 낮음 → 제외
  ];
  const existing: GuardInput[] = [{ post_id: "b", measured_at: "2026-06-01", play_count: 100 }];
  const { kept, dropped } = filterMonotonicStats(incoming, existing);
  assert.deepEqual(kept.map(k => k.post_id), ["a"]);
  assert.deepEqual(dropped.map(d => d.post_id), ["b"]);
});
