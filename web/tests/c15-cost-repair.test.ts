import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/ops/repair-c15-costs-20260915/route.ts", import.meta.url), "utf8");
const sheets = readFileSync(new URL("../lib/google-sheets.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const workflow = readFileSync(
  new URL("../../.github/workflows/repair-c15-costs-20260915.yml", import.meta.url),
  "utf8",
);

test("C15 audit remains exact and its one-time POST repair is gone", () => {
  assert.match(route, /EXPECTED_COST = 60000/);
  assert.match(route, /TARGETS\.map/);
  assert.match(route, /sheetMatches\.length === 1/);
  assert.match(route, /dbMatches\.length === 1/);
  assert.match(route, /\.ilike\("url", `%\$\{contentId\}%`\)/);
  assert.match(route, /linkKey\(post\.url\)\.toLowerCase\(\) === key/);
  assert.match(route, /evidence\.size === 1/);
  assert.match(route, /!sheetCostFormula\.startsWith\("="\)/);
  assert.match(route, /one-time repair is permanently disabled/);
  assert.match(route, /}, 410\)/);
  assert.doesNotMatch(route, /updateSheetTabValues|\.from\("jobs"\)|\.update\(\{ cost:/);
});

test("Google Sheets helper is read-only after the one-time repair", () => {
  assert.match(sheets, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets\.readonly/);
  assert.doesNotMatch(sheets, /values:batchUpdate|valueInputOption: "RAW"/);
});

test("C15 repair route is public only through its own CRON_SECRET guard", () => {
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(middleware, /\/api\/ops\/repair-c15-costs-20260915/);
  assert.match(workflow, /Verify the completed repair cannot write again/);
  assert.match(workflow, /sys\.argv\[1\] != "410"/);
  assert.doesNotMatch(workflow, /inputs:\s*[\r\n]+\s+apply:/);
});
