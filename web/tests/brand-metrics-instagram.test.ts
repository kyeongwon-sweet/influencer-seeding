import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseInstagramInsightResponse } from "../lib/brand-metrics-instagram.ts";

const route = readFileSync(
  new URL("../app/api/brand-metrics/collect/route.ts", import.meta.url),
  "utf8",
);

test("Instagram Graph failures preserve a safe code and message", () => {
  assert.deepEqual(parseInstagramInsightResponse(401, {
    error: { code: 190, type: "OAuthException", message: "Session expired" },
  }), {
    ig_profile_views: null,
    error: {
      httpStatus: 401,
      code: 190,
      type: "OAuthException",
      message: "Session expired",
    },
  });
});

test("Instagram profile views accepts zero as a measured value", () => {
  assert.deepEqual(parseInstagramInsightResponse(200, {
    data: [{ name: "profile_views", total_value: { value: 0 } }],
  }), { ig_profile_views: 0, error: null });
});

test("brand collection does not hide Graph failures or put the token in the URL", () => {
  assert.match(route, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(route, /searchParams\.set\("access_token"/);
  assert.match(route, /if \(allInstagramNull\)/);
  assert.match(route, /ok: false/);
  assert.match(route, /status: 502/);
  assert.match(route, /instagramFailures/);
  assert.match(route, /Object\.entries\(row\).*value != null/s);
  assert.match(route, /defaultToNull: false/);
});
