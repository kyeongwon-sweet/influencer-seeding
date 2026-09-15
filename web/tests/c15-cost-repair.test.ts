import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/ops/repair-c15-costs-20260915/route.ts", import.meta.url), "utf8");
const sheets = readFileSync(new URL("../lib/google-sheets.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

test("C15 repair is exact, backed up, and sheet-first", () => {
  assert.match(route, /repair-c15-costs-2026-09-15/);
  assert.match(route, /EXPECTED_COST = 60000/);
  assert.match(route, /TARGETS\.map/);
  assert.match(route, /sheetMatches\.length === 1/);
  assert.match(route, /dbMatches\.length === 1/);
  assert.match(route, /\.ilike\("url", `%\$\{contentId\}%`\)/);
  assert.match(route, /linkKey\(post\.url\)\.toLowerCase\(\) === key/);
  assert.match(route, /evidence\.size === 1/);
  assert.match(route, /c15_cost_repair_20260915_backup/);
  const sheetWriteAt = route.lastIndexOf("updateSheetTabValues(");
  const dbWriteAt = route.indexOf('.from("sponsored_posts")\n        .update');
  assert.ok(sheetWriteAt >= 0 && dbWriteAt > sheetWriteAt);
});

test("Google Sheets writes use a separate write scope and batch update", () => {
  assert.match(sheets, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets"/);
  assert.match(sheets, /values:batchUpdate/);
  assert.match(sheets, /valueInputOption: "RAW"/);
});

test("C15 repair route is public only through its own CRON_SECRET guard", () => {
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(middleware, /\/api\/ops\/repair-c15-costs-20260915/);
});
