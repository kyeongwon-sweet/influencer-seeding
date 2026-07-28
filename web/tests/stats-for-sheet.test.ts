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
