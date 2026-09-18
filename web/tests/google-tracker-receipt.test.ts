import { test } from "node:test";
import assert from "node:assert/strict";
import { signRun, verifyRun, type TrackerRun } from "../lib/google-tracker-receipt.ts";
test("run receipt rejects tampered, foreign, expired and unsigned actor IDs", () => {
  const prior = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = "unit-test-only-key";
  try {
    const run: TrackerRun = { userId: "user-a", runId: "actor-a", kind: "trends", config: { groups: [{ id: "g0", label: "brand", terms: ["brand"], tags: [] }], start: "2026-01-01", end: "2026-02-01", geo: "KR", category: "0", multiplier: 2.5, minIndex: 5, gapDays: 7, windowDays: 7 }, group: 0, date: "2026-01-01", expires: Date.now() + 60000 };
    const token = signRun(run);
    assert.equal(verifyRun(token, "user-a").runId, "actor-a");
    assert.throws(() => verifyRun(token, "user-b"), /다른 사용자/);
    const [payload, signature] = token.split(".");
    const changed = Buffer.from(JSON.stringify({ ...run, runId: "actor-secret" })).toString("base64url");
    assert.throws(() => verifyRun(`${changed}.${signature}`, "user-a"), /서명/);
    assert.throws(() => verifyRun(payload, "user-a"), /서명/);
    assert.throws(() => verifyRun(signRun({ ...run, expires: Date.now() - 1 }), "user-a"), /만료/);
    assert.throws(() => verifyRun(token + ".extra", "user-a"), /서명/);
  } finally { if (prior === undefined) delete process.env.WEBHOOK_SECRET; else process.env.WEBHOOK_SECRET = prior; }
});
