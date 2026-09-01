import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../app/api/sponsored-posts/stats-for-sheet/route.ts", import.meta.url),
  "utf8",
);

test("stats-for-sheet includes ended posts with no stats for sheet diagnostics", () => {
  assert.match(route, /let endedWithoutStats = 0/);
  assert.match(route, /if \(activeKey\.has\(key\) \|\| byKey\.has\(key\)\) continue/);
  assert.match(route, /endedWithoutStats\+\+/);
  assert.match(route, /stats: \[\]/);
  assert.match(route, /ended_without_stats: endedWithoutStats/);
});

test("stats-for-sheet exposes metric provenance and uses reach for banners", () => {
  assert.match(route, /select\("id, post_id, measured_at, play_count, reach_count, manual"\)/);
  assert.match(route, /bannerById\.get\(s\.post_id as string\) \? s\.reach_count : s\.play_count/);
  assert.match(route, /manual: Boolean\(s\.manual\)/);
  assert.match(route, /\[date, stat\.value, stat\.manual\]/);
});
