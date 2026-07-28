import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractBannerReachRows,
  normalizeSheetHeader,
  parseMonthDay,
  parseSheetDate,
  toSheetNumber,
} from "../lib/sheet-banner-reach.ts";

test("sheet banner reach parser accepts current headers and skips unsafe cells", () => {
  const sheet = [
    ["업로드일", "게시물URL", "채널명", "채널 분류", "x", "x", "x", "x", "7.15", "7.16", "7.17"],
    ["2026-07-16", "https://www.instagram.com/reel/ABC123/", "a", "바이럴 (배너)", "", "", "", "", 999, "1,200", ""],
    ["2026-07-15", "https://www.instagram.com/p/VID123/", "b", "바이럴 (영상)", "", "", "", "", 500, 600, 700],
    ["2026-07-17", "https://www.instagram.com/reel/DEF456/", "c", "바이럴 (배너)", "", "", "", "", 10, 20, 0],
  ];

  const out = extractBannerReachRows(sheet, { today: "2026-07-16" });

  assert.equal(out.bannerRows, 2);
  assert.equal(out.nonBannerRows, 1);
  assert.equal(out.dateColumns, 3);
  assert.deepEqual(out.rows.map((r) => [r.url, r.measuredAt, r.reachCount]), [
    ["https://www.instagram.com/reel/ABC123/", "2026-07-16", 1200],
  ]);
  assert.equal(out.prePostedCellsSkipped, 1);
  assert.equal(out.futurePostRowsSkipped, 1);
  assert.equal(out.futureDateCellsSkipped, 0);
});

test("sheet banner reach parser handles compact headers, serial dates, and numbers", () => {
  assert.equal(normalizeSheetHeader("채널 분류"), "채널분류");
  assert.equal(parseSheetDate(46218), "2026-07-15");
  assert.deepEqual(parseMonthDay(46218), { month: 7, day: 15 });
  assert.equal(toSheetNumber("₩ 12,345원"), 12345);
});

test("banner reach route is cron-auth public and writes reach_count only", () => {
  const route = readFileSync(
    new URL("../app/api/sponsored-posts/banner-reach-sync/route.ts", import.meta.url),
    "utf8",
  );
  const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  const workflow = readFileSync(
    new URL("../../.github/workflows/banner-reach-sync.yml", import.meta.url),
    "utf8",
  );

  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(route, /fetchSheetTabValues\(SHEET_ID, SHEET_GID, SHEET_RANGE\)/);
  assert.match(route, /extractBannerReachRows/);
  assert.match(route, /\.upsert\(upsertRows, \{ onConflict: "post_id,measured_at" \}\)/);
  assert.match(route, /reach_count: row\.reachCount/);
  assert.doesNotMatch(route, /play_count: row\.reachCount/);
  assert.match(middleware, /"\/api\/sponsored-posts\/banner-reach-sync\(\.\*\)"/);
  assert.match(workflow, /cron: "17 \* \* \* \*"/);
  assert.match(workflow, /\/api\/sponsored-posts\/banner-reach-sync/);
});
