import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decideMetaAdsHealthTransition,
  evaluateMetaAdsHealth,
} from "../lib/meta-ads-health.ts";

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

test("Meta health alerts only on the first unhealthy transition", () => {
  assert.deepEqual(decideMetaAdsHealthTransition("healthy", false), {
    state: "unhealthy",
    changed: true,
    shouldNotify: true,
    shouldFailWorkflow: true,
  });
  assert.deepEqual(decideMetaAdsHealthTransition("unhealthy", false), {
    state: "unhealthy",
    changed: false,
    shouldNotify: false,
    shouldFailWorkflow: false,
  });
  assert.equal(decideMetaAdsHealthTransition("unhealthy", false, true).shouldNotify, true);
  assert.equal(decideMetaAdsHealthTransition("unhealthy", true).state, "healthy");
});

test("health route is cron-authenticated and never puts the Meta token in the URL", () => {
  assert.match(middleware, /\/api\/ops\/meta-ads-health\(\.\*\)/);
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(route, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(route, /searchParams\.(?:set|append)\("access_token"/);
  assert.doesNotMatch(route, /details:\s*payload\.error/);
});

test("recovered-token workflow schedules stateful checks and supports quiet manual checks", () => {
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /45 2 \* \* \*/);
  assert.match(workflow, /method=POST/);
  assert.match(workflow, /method=GET/);
  assert.match(workflow, /\?force=1/);
  assert.match(workflow, /secrets\.CRON_SECRET/);
  assert.match(heartbeat, /meta-ads-health\.yml/);
  assert.match(route, /meta_ads_health_state/);
  assert.match(route, /repeatSuppressed/);
});
