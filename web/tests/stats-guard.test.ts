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

// ───────── sameDateFloor: 2026-08-28 사고 회귀 ─────────
// 연동시트 역채움이 수집 도착 전에 돌아 최신 날짜 칸에 전날 값을 carry-forward로 써넣고,
// 값이 든 칸은 다시 안 덮으므로 오류가 영구 고정됐다. 그 뒤 importStats(시트→DB)가 같은
// 날짜로 그 낮은 값을 올려보내면 DB 실측을 upsert로 덮어썼다(비가역).
// 실측: 먹리니 08-27 DB 633,374 → 시트 carry값 466,637 (08-26 값과 동일).

test("사고 재현: 같은 날짜 기존 실측을 낮추는 자동 동기화는 차단(sameDateFloor)", () => {
  const existing: GuardInput[] = [
    { post_id: P, measured_at: "2026-08-26", play_count: 466_637 },
    { post_id: P, measured_at: "2026-08-27", play_count: 633_374 },  // 자동 수집 실측
  ];
  // 시트 carry-forward 값(전날과 동일) — 전날 대비로는 감소가 아니라 기존 가드를 통과했다
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 466_637 }];

  const off = filterMonotonicStats(incoming, existing);
  assert.equal(off.kept.length, 1, "하한선 없으면(기존 동작) 통과 — 이게 사고 경로");

  const on = filterMonotonicStats(incoming, existing, { sameDateFloor: true });
  assert.equal(on.kept.length, 0, "하한선 켜면 차단돼야 함");
  assert.equal(on.dropped.length, 1);
  assert.equal(on.dropped[0].blocked_by, 633_374);
  assert.equal(on.dropped[0].blocked_date, "2026-08-27");
});

test("sameDateFloor라도 같은 날짜 상향(더 큰 실측)은 통과", () => {
  const existing: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 100 }];
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 150 }];
  const { kept, dropped } = filterMonotonicStats(incoming, existing, { sameDateFloor: true });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].play_count, 150);
  assert.equal(dropped.length, 0);
});

test("sameDateFloor는 같은 값 재전송을 막지 않는다(멱등)", () => {
  const existing: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 500 }];
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 500 }];
  const { kept, dropped } = filterMonotonicStats(incoming, existing, { sameDateFloor: true });
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test("사람이 올린 정정(manual_sheet=하한선 off)은 하향도 허용", () => {
  // 수기 정정은 오입력을 낮추는 게 정당하다 — 이 경로를 막으면 정정이 불가능해진다.
  const existing: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 999_999 }];
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 1_200 }];
  const { kept } = filterMonotonicStats(incoming, existing, { sameDateFloor: false });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].play_count, 1_200);
});

test("sameDateFloor가 과거 날짜 백필을 막지 않는다", () => {
  const existing: GuardInput[] = [{ post_id: P, measured_at: "2026-08-27", play_count: 5_000 }];
  const incoming: GuardInput[] = [{ post_id: P, measured_at: "2026-08-01", play_count: 300 }];
  const { kept, dropped } = filterMonotonicStats(incoming, existing, { sameDateFloor: true });
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});
