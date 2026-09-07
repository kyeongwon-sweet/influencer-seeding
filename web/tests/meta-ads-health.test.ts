import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateMetaAdsHealth } from "../lib/meta-ads-health.ts";

const route = readFileSync(
  new URL("../app/api/ops/meta-ads-health/route.ts", import.meta.url),
  "utf8",
);
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const workflow = readFileSync(
  new URL("../../.github/workflows/meta-ads-health.yml", import.meta.url),
  "utf8",
);
const heartbeat = readFileSync(new URL("../lib/schedule-heartbeat.ts", import.meta.url), "utf8");

test("Meta 200 empty data is healthy because zero spend is valid", () => {
  assert.deepEqual(evaluateMetaAdsHealth(200, { data: [] }), {
    ok: true,
    status: "healthy",
    httpStatus: 200,
    oauthCode: null,
    itemCount: 0,
  });
});

test("Meta OAuth expiry and permission failures are classified without raw details", () => {
  assert.equal(evaluateMetaAdsHealth(401, { error: { code: 190 } }).status, "oauth_error");
  assert.equal(evaluateMetaAdsHealth(403, { error: { code: 200 } }).status, "permission_error");
  assert.equal(evaluateMetaAdsHealth(200, {}).status, "invalid_response");
});

test("health route is cron-authenticated and never puts the Meta token in the URL", () => {
  assert.match(middleware, /\/api\/ops\/meta-ads-health\(\.\*\)/);
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(route, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(route, /searchParams\.(?:set|append)\("access_token"/);
  assert.doesNotMatch(route, /details:\s*payload\.error/);
});

test("scheduled workflow notifies on failure and cross-provider heartbeat watches it", () => {
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /method=POST/);
  assert.match(workflow, /method=GET/);
  assert.match(workflow, /secrets\.CRON_SECRET/);
  assert.match(heartbeat, /meta-ads-health\.yml/);
});

