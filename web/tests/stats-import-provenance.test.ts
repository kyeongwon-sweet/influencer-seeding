import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveImportedManualFlag } from "../lib/stats-import-provenance.ts";

const automatic = {
  manual: false,
  play_count: 100,
  reach_count: 80,
};

test("manual_sheet writes are always manual", () => {
  assert.equal(resolveImportedManualFlag({
    source: "manual_sheet",
    metric: "play_count",
    incomingValue: 100,
    existing: automatic,
  }), true);
});

test("daily_auto marks a new sheet-only row manual", () => {
  assert.equal(resolveImportedManualFlag({
    source: "daily_auto",
    metric: "play_count",
    incomingValue: 100,
  }), true);
});

test("daily_auto preserves an identical automatic DB value", () => {
  assert.equal(resolveImportedManualFlag({
    source: "daily_auto",
    metric: "play_count",
    incomingValue: 100,
    existing: automatic,
  }), false);
});

test("daily_auto marks a changed sheet value manual", () => {
  assert.equal(resolveImportedManualFlag({
    source: "daily_auto",
    metric: "play_count",
    incomingValue: 120,
    existing: automatic,
  }), true);
});

test("daily_auto never clears an existing manual flag", () => {
  assert.equal(resolveImportedManualFlag({
    source: "daily_auto",
    metric: "play_count",
    incomingValue: 100,
    existing: { ...automatic, manual: true },
  }), true);
});

test("reach provenance uses reach_count rather than play_count", () => {
  assert.equal(resolveImportedManualFlag({
    source: "daily_auto",
    metric: "reach_count",
    incomingValue: 80,
    existing: automatic,
  }), false);
  assert.equal(resolveImportedManualFlag({
    source: "daily_auto",
    metric: "reach_count",
    incomingValue: 81,
    existing: automatic,
  }), true);
});
