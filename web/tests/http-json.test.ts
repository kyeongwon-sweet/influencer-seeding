import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readJsonResponse } from "../lib/http-json.ts";

test("readJsonResponse returns JSON for successful responses", async () => {
  const value = await readJsonResponse<{ ok: boolean }>(
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  assert.deepEqual(value, { ok: true });
});

test("readJsonResponse rejects HTTP failures instead of returning an empty-data fallback", async () => {
  await assert.rejects(
    readJsonResponse(new Response(JSON.stringify({ error: "upstream unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })),
    /HTTP 502: upstream unavailable/,
  );
});

test("monitoring auxiliary requests surface HTTP failures instead of substituting empty data", () => {
  const page = readFileSync(new URL("../app/monitoring/page.tsx", import.meta.url), "utf8");
  for (const endpoint of [
    "/api/brand-metrics",
    "/api/youtube-trends",
    "/api/google-trends",
    "/api/b2b-revenue",
    "/api/monitoring/last-update",
    "/api/product-search-trends",
  ]) {
    const start = page.indexOf(`fetch(\"${endpoint}\")`);
    assert.notEqual(start, -1, `${endpoint} fetch가 있어야 한다`);
    assert.match(page.slice(start, start + 220), /readJsonResponse</, `${endpoint} HTTP 오류를 throw해야 한다`);
  }
  assert.match(page, /실패한 지표는 0으로 간주하지 않습니다/);
});
