import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseB2bSheetRows, parseB2bDate, parseB2bSheetRows } from "../lib/b2b-sheet.ts";

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
});
