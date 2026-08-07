import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSkipFormulaAuditReport } from "../lib/formula-audit-dedupe.ts";

test("already reported formula audit skips later automatic callers", () => {
  assert.equal(shouldSkipFormulaAuditReport({ alreadyReported: true, force: false }), true);
});

test("force bypasses the same-day formula audit Slack dedupe", () => {
  assert.equal(shouldSkipFormulaAuditReport({ alreadyReported: true, force: true }), false);
});

test("first formula audit report of the day runs normally", () => {
  assert.equal(shouldSkipFormulaAuditReport({ alreadyReported: false, force: false }), false);
});
