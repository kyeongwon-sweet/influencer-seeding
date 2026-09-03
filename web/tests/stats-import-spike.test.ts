import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomaticPlayHistory,
  isExplicitNonVideoMedia,
  previousAutomaticPlay,
  quarantineAutomaticSuspects,
} from "../lib/stats-import-spike.ts";

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

test("quarantines suspected daily_auto rows but preserves manual sheet input", () => {
  const rows = [
    { post_id: "p", measured_at: "2026-09-01", play_count: 30_000 },
    { post_id: "p", measured_at: "2026-09-02", play_count: 90_000 },
  ];
  const keys = new Set(["play_count|p|2026-09-02"]);

  assert.deepEqual(quarantineAutomaticSuspects(rows, keys, "play_count", false), {
    kept: [rows[0]],
    quarantined: [rows[1]],
  });
  assert.deepEqual(quarantineAutomaticSuspects(rows, keys, "play_count", true), {
    kept: rows,
    quarantined: [],
  });
});

test("quarantines copied banner reach during daily_auto", () => {
  const rows = [
    { post_id: "ijit", measured_at: "2026-08-26", reach_count: 116_853 },
    { post_id: "ijit", measured_at: "2026-08-27", reach_count: 116_853 },
  ];
  const keys = new Set([
    "reach_count|ijit|2026-08-26",
    "reach_count|ijit|2026-08-27",
  ]);

  assert.deepEqual(quarantineAutomaticSuspects(rows, keys, "reach_count", false), {
    kept: [],
    quarantined: rows,
  });
  assert.deepEqual(quarantineAutomaticSuspects(rows, keys, "reach_count", true), {
    kept: rows,
    quarantined: [],
  });
});

test("rejects only explicit non-video metadata", () => {
  assert.equal(isExplicitNonVideoMedia({ type: "Sidecar" }), true);
  assert.equal(isExplicitNonVideoMedia({ mediaType: "IMAGE" }), true);
  assert.equal(isExplicitNonVideoMedia({ type: "GraphImage" }), true);
  assert.equal(isExplicitNonVideoMedia({ media_type: "CAROUSEL_ALBUM" }), true);
  assert.equal(isExplicitNonVideoMedia({ type: "GraphSidecar" }), false);
  assert.equal(isExplicitNonVideoMedia({ type: "Video" }), false);
  assert.equal(isExplicitNonVideoMedia({}), false);
});
