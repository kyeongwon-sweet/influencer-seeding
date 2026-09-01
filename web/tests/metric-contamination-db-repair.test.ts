import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/api/ops/repair-metric-contamination/route.ts", import.meta.url),
  "utf8",
);
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

test("metric contamination repair is exact-key, exact-date, and exact-value guarded", () => {
  assert.match(source, /ig:Db5iVQYhJT5.*2026-08-26.*play_count.*466637/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-26.*reach_count.*466637/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-27.*reach_count.*633000, 633374/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-28.*reach_count.*633000, 633374/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-29.*reach_count.*633000, 633374/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-30.*reach_count.*633000, 633374/);
  assert.match(source, /tt:7677553177486478599.*2026-08-27.*play_count.*633000, 633374/);
  assert.match(source, /tt:7677969398061141255/);
  assert.match(source, /tt:7669021425163881746/);
  assert.match(source, /yt:GBWxY0RlRqA/);
  assert.match(source, /23b92e91-d2c6-4938-b8ab-ce5df428a14b/);
  assert.match(source, /target\.exactPostId && existingPostIds\.has\(target\.exactPostId\)/);
  assert.match(source, /\.eq\(row\.field, row\.value as number\)/);
});

test("repair distinguishes legacy field clears from exact-row deletions and verifies every target", () => {
  assert.match(source, /\.update\(\{ \[row\.field\]: null \}\)/);
  assert.match(source, /action: "delete_row"/);
  assert.match(source, /query\.delete\(\).*\.eq\("id", row\.statId/);
  assert.match(source, /deletedRows/);
  assert.match(source, /statSnapshot/);
  assert.match(source, /Post-repair verification failed/);
  assert.match(source, /Cache-Control.*no-store/);
});

test("valid non-contaminated metrics are preserved and do not block exact repairs", () => {
  assert.match(source, /: "preserved_valid"/);
  assert.doesNotMatch(source, /unexpected_value/);
  assert.doesNotMatch(source, /Unexpected live values/);
  assert.match(source, /after\.rows\.some\(\(row\) => row\.status === "repairable"\)/);
  assert.match(source, /ambiguous_stat/);
  assert.match(source, /Ambiguous daily-stat rows/);
});

test("Apps Script can reach the cron-authenticated repair route without Clerk HTML", () => {
  assert.match(middleware, /\/api\/ops\/repair-metric-contamination/);
  assert.match(source, /checkCronAuth\(req\)/);
});
