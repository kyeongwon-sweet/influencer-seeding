import assert from "node:assert/strict";
import test from "node:test";
import {
  buildB2bDailyRecords,
  diagnoseB2bSheetRows,
  parseB2bDate,
  parseB2bSheetRows,
  type B2bDayValues,
} from "../lib/b2b-sheet.ts";

test("B2B parser finds the real date column after the July layout change", () => {
  const rows = [
    [null, null, "[일자별 현황]"],
    [null, "날짜", null, "CVS 발주량", "B2B 발주량", "인지 광고비", "CVS 손익(300원)"],
    [null, "26.09. W4", "2026. 9. 28", 0, 0, 100, -100],
    [null, "26.09. W5", "2026. 9. 29", 95_160, 0, 200, 28_656_396],
    [null, "26.09. W5", "2026. 9. 30", 117_680, 0, 300, 35_304_000],
  ];
  const result = parseB2bSheetRows(rows, {
    nowKST: new Date("2026-09-30T01:00:00.000Z"),
    maxDate: "2026-09-29",
  });
  assert.equal(result.get("2026-09-29")?.order, 95_160);
  assert.equal(result.get("2026-09-29")?.ad, 200);
  assert.equal(result.get("2026-09-29")?.contrib, 28_656_396);
  assert.equal(result.has("2026-09-30"), false);
  assert.equal(diagnoseB2bSheetRows(rows, new Date("2026-09-30T01:00:00.000Z")).dateColumn, 2);
});

test("week labels are not accepted as dates", () => {
  assert.equal(parseB2bDate("26.09. W5", new Date("2026-09-30T01:00:00.000Z")), null);
  assert.equal(parseB2bDate("2026-09-29", new Date("2026-09-30T01:00:00.000Z")), "2026-09-29");
  assert.equal(parseB2bDate("9. 29 (화)", new Date("2026-09-30T01:00:00.000Z")), "2026-09-29");
});

test("B2B parser preserves explicit zero but keeps blank order cells null", () => {
  const rows = [
    ["[일자별 현황]"],
    ["날짜", "CVS 발주량", "B2B 발주량", "인지 광고비", "CVS 손익(300원)"],
    ["2026-09-24", 0, 0, 100, -100],
    ["2026-09-25", "", null, 100, -100],
  ];
  const result = parseB2bSheetRows(rows, { nowKST: new Date("2026-09-30T01:00:00.000Z") });
  assert.equal(result.get("2026-09-24")?.order, 0);
  assert.equal(result.get("2026-09-25")?.order, null);
});

test("B2B record merge does not invent zero for a product with no date row", () => {
  const known = (order: number | null): B2bDayValues => ({ order, profit: null, ad: null, contrib: null });
  const records = buildB2bDailyRecords(
    new Map([["2026-07-31", known(17_370)]]),
    new Map([
      ["2026-07-31", known(12_000)],
      ["2026-09-24", known(0)],
      ["2026-09-29", known(95_160)],
    ]),
    "2026-09-30T00:00:00.000Z",
  );
  const holiday = records.find((row) => row.date === "2026-09-24");
  const latest = records.find((row) => row.date === "2026-09-29");
  assert.equal(holiday?.dumbuk_order, null);
  assert.equal(holiday?.jjondeuk_order, 0);
  assert.equal(holiday?.total_order, 0);
  assert.equal(latest?.dumbuk_order, null);
  assert.equal(latest?.jjondeuk_order, 95_160);
  assert.equal(latest?.total_order, 95_160);
});
