import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../app/home/page.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/organic-mentions/route.ts", import.meta.url), "utf8");

test("홈 무상노출은 최근 7일 중 최대 3건만 요청한다", () => {
  assert.match(home, /\/api\/organic-mentions\?limit=3&createdSince=/);
  assert.match(home, /Date\.now\(\) - 7 \* 24 \* 60 \* 60 \* 1000/);
});

test("무상노출 API는 limit 적용 전에 created_at 기간을 필터링한다", () => {
  assert.match(route, /searchParams\.get\("createdSince"\)/);
  assert.match(route, /query\.gte\("created_at", createdSince\)/);
  assert.match(route, /baseQuery\(\)\.range\(offset, offset \+ limit - 1\)/);
});
