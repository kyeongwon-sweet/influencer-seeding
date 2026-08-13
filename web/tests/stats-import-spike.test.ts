import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAutomaticPlayHistory, previousAutomaticPlay } from "../lib/stats-import-spike.ts";

test("uses the latest earlier automatic play measurement, not the historical maximum", () => {
  const history = buildAutomaticPlayHistory([
    { post_id: "p", measured_at: "2026-08-01", play_count: 100_000, manual: false },
    { post_id: "p", measured_at: "2026-08-02", play_count: 1_000, manual: false },
    { post_id: "p", measured_at: "2026-08-03", play_count: 900_000, manual: true },
  ]);
  assert.deepEqual(previousAutomaticPlay(history, "p", "2026-08-04"), {
    measured_at: "2026-08-02",
    play_count: 1_000,
  });
});

test("ignores same-day, manual, null and zero rows", () => {
  const history = buildAutomaticPlayHistory([
    { post_id: "p", measured_at: "2026-08-01", play_count: null, manual: false },
    { post_id: "p", measured_at: "2026-08-02", play_count: 0, manual: false },
    { post_id: "p", measured_at: "2026-08-03", play_count: 2_000, manual: true },
    { post_id: "p", measured_at: "2026-08-04", play_count: 4_000, manual: false },
  ]);
  assert.equal(previousAutomaticPlay(history, "p", "2026-08-04"), null);
  assert.deepEqual(previousAutomaticPlay(history, "p", "2026-08-05"), {
    measured_at: "2026-08-04",
    play_count: 4_000,
  });
});
