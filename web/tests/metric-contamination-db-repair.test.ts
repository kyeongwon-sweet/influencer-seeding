import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/api/ops/repair-metric-contamination/route.ts", import.meta.url),
  "utf8",
);

test("metric contamination repair is exact-key, exact-date, and exact-value guarded", () => {
  assert.match(source, /ig:Db5iVQYhJT5.*2026-08-26.*play_count.*466637/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-26.*reach_count.*466637/);
  assert.match(source, /ig:Db5fNo6k6bI.*2026-08-27.*reach_count.*633000, 633374/);
  assert.match(source, /tt:7677553177486478599.*2026-08-27.*play_count.*633000, 633374/);
  assert.match(source, /Unexpected live values; no rows changed/);
  assert.match(source, /\.eq\(row\.field, row\.value as number\)/);
});

test("repair nulls only the contaminated metric field and verifies every target", () => {
  assert.match(source, /\.update\(\{ \[row\.field\]: null \}\)/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.match(source, /Post-repair verification failed/);
  assert.match(source, /Cache-Control.*no-store/);
});
