import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/ops/purge-yeomun-self-dm-20261014/route.ts", import.meta.url),
  "utf8",
);
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const workflow = readFileSync(
  new URL("../../.github/workflows/admin-purge-bot-dm.yml", import.meta.url),
  "utf8",
);

test("one-off Slack purge route is narrowly scoped and authenticated", () => {
  assert.match(route, /checkCronAuth\(req\) === "ok"/);
  assert.match(route, /D0B2U2J8QNS/);
  assert.match(route, /U0B2Y0ZC8QZ/);
  assert.match(route, /const MAX_BATCH = 35/);
  assert.match(route, /confirm !== `DELETE \$\{channel\}`/);
  assert.match(route, /"chat\.delete"/);
  assert.match(route, /process\.env\.SLACK_BOT_TOKEN/);
  assert.doesNotMatch(route, /SLACK_BOT_TOKEN.*NextResponse/);
  assert.match(middleware, /\/api\/ops\/purge-yeomun-self-dm-20261014\(\.\*\)/);
});

test("admin workflow can use the Vercel token without exporting it", () => {
  assert.match(workflow, /token_source:/);
  assert.match(workflow, /TOKEN_SOURCE.*github\.event\.inputs\.token_source/);
  assert.match(workflow, /secrets\.CRON_SECRET/);
  assert.match(workflow, /api\/ops\/purge-yeomun-self-dm-20261014/);
  assert.doesNotMatch(workflow, /vercel env pull/);
});
