import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const route = readFileSync(
  new URL("../app/api/sponsored-posts/[id]/stats/route.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../app/monitoring/page.tsx", import.meta.url), "utf8");
const repair = readFileSync(
  new URL("../../scripts/repair_specific_daily_stat.py", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/repair-specific-daily-stat.yml", import.meta.url),
  "utf8",
);

test("stats repair API changes manual provenance only when explicitly requested", () => {
  assert.doesNotMatch(route, /if \("play_count" in body\) updates\.manual = true/);
  assert.match(route, /if \("manual" in body\)/);
  assert.match(route, /typeof body\.manual !== "boolean"/);
});

test("human dashboard play-count edits explicitly mark the value manual", () => {
  assert.match(page, /play_count, measured_at: measuredAt, manual: true/);
  assert.match(page, /play_count, manual: true/);
});

test("guarded repair can restore manual provenance with before-value checks and backup", () => {
  assert.match(repair, /--expected-manual/);
  assert.match(repair, /--new-manual/);
  assert.match(repair, /errors\.append\(\{"field": "manual"/);
  assert.match(repair, /updates\["manual"\] = new_manual/);
  assert.match(workflow, /Upload guarded repair audit/);
});
