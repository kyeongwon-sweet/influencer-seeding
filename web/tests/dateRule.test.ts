import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEntryDate, maxDateKST, MIN_ENTRY_DATE, yesterdayKST } from "../lib/dateRule.ts";

test("maxDateKST: returns YYYY-MM-DD", () => {
  assert.match(maxDateKST(), /^\d{4}-\d{2}-\d{2}$/);
});

test("yesterdayKST: after-midnight KST collection belongs to previous day", () => {
  const originalNow = Date.now;
  Date.now = () => new Date("2026-07-09T17:30:00Z").getTime(); // 2026-07-10 02:30 KST
  try {
    assert.equal(yesterdayKST(), "2026-07-09");
  } finally {
    Date.now = originalNow;
  }
});

test("isValidEntryDate: rejects invalid formats", () => {
  assert.equal(isValidEntryDate("2026-6-1"), false);
  assert.equal(isValidEntryDate("20260601"), false);
  assert.equal(isValidEntryDate("2026/06/01"), false);
  assert.equal(isValidEntryDate("abcd-ef-gh"), false);
  assert.equal(isValidEntryDate("99999-01-01"), false);
});

test("isValidEntryDate: validates allowed range", () => {
  assert.equal(isValidEntryDate("2019-12-31"), false);
  assert.equal(isValidEntryDate(MIN_ENTRY_DATE), true);
  assert.equal(isValidEntryDate("2999-01-01"), false);
  assert.equal(isValidEntryDate(maxDateKST()), true);
});
