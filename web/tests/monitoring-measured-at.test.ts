import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requireMonitoringWebhookDate,
  resolveMonitoringMeasuredAt,
} from "../lib/dateRule.ts";

const webhook = readFileSync(new URL("../app/api/apify-webhook/route.ts", import.meta.url), "utf8");
const scheduled = readFileSync(new URL("../app/api/monitoring/apify-collect/route.ts", import.meta.url), "utf8");
const manual = readFileSync(new URL("../app/api/monitoring/collect-now/route.ts", import.meta.url), "utf8");
const fallback = readFileSync(new URL("../app/api/ops/collect-fallback/route.ts", import.meta.url), "utf8");

test("scheduled and manual kickoff resolve different KST snapshot labels", () => {
  const originalNow = Date.now;
  Date.now = () => new Date("2026-08-13T01:00:00Z").getTime(); // 10:00 KST
  try {
    assert.equal(resolveMonitoringMeasuredAt(null, "scheduled"), "2026-08-12");
    assert.equal(resolveMonitoringMeasuredAt(null, "manual"), "2026-08-13");
    assert.equal(resolveMonitoringMeasuredAt("2026-08-10", "scheduled"), "2026-08-10");
  } finally {
    Date.now = originalNow;
  }
});

test("stats webhook cannot infer a date from callback arrival time", () => {
  assert.throws(() => requireMonitoringWebhookDate(null, false), /missing measuredAt/);
  assert.equal(requireMonitoringWebhookDate(null, true), resolveMonitoringMeasuredAt(null, "manual"));
  assert.doesNotMatch(webhook, /measuredAt \|\| todayKST\(\)/);
  assert.match(webhook, /requireMonitoringWebhookDate\(measuredAt, metadataOnly\)/);
});

test("scheduled and fallback routes carry the chosen date through kickoff", () => {
  assert.match(scheduled, /resolveMonitoringMeasuredAt\(req\.nextUrl\.searchParams\.get\("date"\), "scheduled"\)/);
  assert.match(scheduled, /measuredAt=\$\{encodeURIComponent\(measuredAt\)\}/);
  assert.match(fallback, /apify-collect\?date=\$\{encodeURIComponent\(kdate\)\}/);
});

test("invalid or future explicit dates are rejected", () => {
  assert.throws(() => resolveMonitoringMeasuredAt("2026-8-1", "manual"), /invalid measured_at/);
  assert.throws(() => resolveMonitoringMeasuredAt("2999-01-01", "manual"), /invalid measured_at/);
  assert.match(scheduled, /resolveMonitoringMeasuredAt[\s\S]*?status: 400/);
  assert.match(manual, /resolveMonitoringMeasuredAt[\s\S]*?status: 400/);
});
