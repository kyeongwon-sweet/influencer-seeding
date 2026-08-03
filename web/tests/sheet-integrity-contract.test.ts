import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/admin/sheet-integrity/route.ts", import.meta.url), "utf8");

test("sheet-integrity reads date serial headers with the shared parser", () => {
  assert.match(route, /import \{ parseHeaderDate \} from "@\/lib\/formula-audit"/);
  assert.match(route, /const incCol = header\.findIndex/);
  assert.match(route, /for \(let c = incCol \+ 1; c < header\.length; c\+\+\)/);
  assert.match(route, /parseHeaderDate\(header\[c\]/);
  assert.doesNotMatch(route, /STATS_FIRST_COL/);
});
