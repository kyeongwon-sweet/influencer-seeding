import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  looksLikeEngagementCountAsViews,
  pickInstagramPlayMetric,
} from "../lib/ig-metric-guard.ts";

const runMonitoring = readFileSync(new URL("../../scripts/run_monitoring.py", import.meta.url), "utf8");

test("IG Reels do not trust generic views/count fields as play count", () => {
  assert.deepEqual(
    pickInstagramPlayMetric(
      { views: 1604, count: 1604, likesCount: 1604 },
      "https://www.instagram.com/reel/DbX2FTOJU81/",
    ),
    { value: null, source: null },
  );

  assert.deepEqual(
    pickInstagramPlayMetric(
      { videoPlayCount: 42000, views: 1604, likesCount: 1604 },
      "https://www.instagram.com/reel/DbX2FTOJU81/",
    ),
    { value: 42000, source: "videoPlayCount" },
  );
});

test("first IG play values that look like engagement counts are retryable, not stored", () => {
  assert.equal(
    looksLikeEngagementCountAsViews({
      playCount: 1604,
      likesCount: 1604,
      commentsCount: 52,
      previousPlay: null,
    }),
    true,
  );

  assert.equal(
    looksLikeEngagementCountAsViews({
      playCount: 43000,
      likesCount: 1604,
      commentsCount: 52,
      previousPlay: null,
    }),
    false,
  );

  assert.equal(
    looksLikeEngagementCountAsViews({
      playCount: 1604,
      likesCount: 1604,
      previousPlay: 50000,
    }),
    false,
  );
});

test("daily monitoring script applies the same first-play guard", () => {
  assert.match(runMonitoring, /def _pick_instagram_play_count/);
  assert.match(runMonitoring, /def _looks_like_engagement_count_as_views/);
  assert.match(runMonitoring, /_pick_instagram_play_count\(item, url\)/);
  assert.match(runMonitoring, /implausible_play_engagement_ratio/);
});
