import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const route = readFileSync(
  new URL("../app/api/sponsored-posts/[id]/stats/route.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../app/monitoring/page.tsx", import.meta.url), "utf8");
const postsTable = readFileSync(
  new URL("../app/monitoring/components/PostsTable.tsx", import.meta.url),
  "utf8",
);
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
  assert.match(page, /JSON\.stringify\(\{ play_count, measured_at: measuredAt, manual: true \}\)/);
  assert.doesNotMatch(page, /\? \{ play_count, measured_at: measuredAt, manual: true \}\s*: \{ play_count, manual: true \}/);
});

test("banner reach editor writes an explicit daily metric date through the stats route", () => {
  assert.match(postsTable, /const isBanner = isBannerChannel\(post\.channel_type, post\.posted_at\)/);
  assert.match(postsTable, /filters\.dateFrom === filters\.dateTo/);
  assert.match(postsTable, /const manualMetricDate = s\?\.measured_at \?\? filteredSingleDate \?\? yesterdayKST\(\)/);
  assert.match(postsTable, /value: String\(bannerDailyMetric\(s\) \?\? ""\)/);
  assert.match(postsTable, /aria-label=\{`배너 도달수 \$\{editPlayCount\.measuredAt\}`\}/);
  assert.match(postsTable, /patchPlayCount\(post\.id, editPlayCount\.value, editPlayCount\.measuredAt\)/);
});

test("stats API creates a missing explicitly requested date instead of falling back", () => {
  assert.match(route, /if \(!isValidEntryDate\(targetDate\)\)/);
  assert.match(route, /let targetExists = false/);
  assert.doesNotMatch(route, /if \(!rows \|\| rows\.length === 0\) targetDate = null/);
  assert.match(route, /if \(!targetExists\) \{[\s\S]*?measured_at: targetDate[\s\S]*?created: true/);
  assert.match(route, /posted_at 이전 날짜에는 조회수\/도달수 값을 입력할 수 없습니다/);
});

test("guarded repair can restore manual provenance with before-value checks and backup", () => {
  assert.match(repair, /--expected-manual/);
  assert.match(repair, /--new-manual/);
  assert.match(repair, /errors\.append\(\{"field": "manual"/);
  assert.match(repair, /updates\["manual"\] = new_manual/);
  assert.match(workflow, /Upload guarded repair audit/);
});
