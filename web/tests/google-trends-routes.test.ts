import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Google search trends collector and webhook bypass Clerk but keep their own secrets", () => {
  const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  const collectRoute = readFileSync(
    new URL("../app/api/google-trends/collect/route.ts", import.meta.url),
    "utf8",
  );
  const webhookRoute = readFileSync(
    new URL("../app/api/google-trends/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const workflow = readFileSync(
    new URL("../../.github/workflows/google-search-trends.yml", import.meta.url),
    "utf8",
  );

  assert.match(middleware, /"\/api\/google-trends\/collect\(\.\*\)"/);
  assert.match(middleware, /"\/api\/google-trends\/webhook\(\.\*\)"/);
  assert.match(collectRoute, /checkCronAuth\(req\) !== "ok"/);
  assert.match(collectRoute, /const runId = await startActorRunWithId/);
  assert.match(collectRoute, /started: true, runId, keywords/);
  assert.match(webhookRoute, /searchParams\.get\("token"\) !== process\.env\.WEBHOOK_SECRET/);
  assert.match(workflow, /KEYWORD_COUNT:\s*"11"/);
  assert.match(workflow, /\/api\/google-trends\/collect\?kw=\$i/);
  assert.match(workflow, /api\.apify\.com\/v2\/actor-runs\/\$run_id/);
  assert.match(workflow, /api\.apify\.com\/v2\/datasets\/\$dataset_id/);
  assert.match(workflow, /\.data\.itemCount \/\/ 0/);
  assert.match(workflow, /status=EMPTY_DATASET/);
  assert.match(workflow, /terminal=success/);
});
