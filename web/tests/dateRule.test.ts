import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEntryDate, maxDateKST, MIN_ENTRY_DATE } from "../lib/dateRule.ts";

test("maxDateKST: YYYY-MM-DD 형식", () => {
  assert.match(maxDateKST(), /^\d{4}-\d{2}-\d{2}$/);
});

test("isValidEntryDate: 형식 위반 거부", () => {
  assert.equal(isValidEntryDate("2026-6-1"), false);   // zero-pad 안 됨
  assert.equal(isValidEntryDate("20260601"), false);
  assert.equal(isValidEntryDate("2026/06/01"), false);
  assert.equal(isValidEntryDate("abcd-ef-gh"), false);
  assert.equal(isValidEntryDate("99999-01-01"), false); // 5자리 연도(과거 버그)
});

test("isValidEntryDate: 범위 검증", () => {
  assert.equal(isValidEntryDate("2019-12-31"), false);  // MIN 미만
  assert.equal(isValidEntryDate(MIN_ENTRY_DATE), true);  // 경계 포함
  assert.equal(isValidEntryDate("2999-01-01"), false);   // 미래(>오늘 KST)
  assert.equal(isValidEntryDate(maxDateKST()), true);     // 오늘 허용
});
