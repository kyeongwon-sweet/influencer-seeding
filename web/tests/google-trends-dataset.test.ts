import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGoogleTrendDataset } from "../lib/google-trends-dataset.ts";

test("normalizes SignalBench interest-over-time rows while preserving a real zero", () => {
  const rows = parseGoogleTrendDataset([
    {
      searchTerm: " 라라스윗 ",
      interestOverTime: [
        { timestamp: 1782000000, value: 0, isPartial: false },
        { timestamp: 1782086400, value: 42, isPartial: false },
        { timestamp: "invalid", value: 99 },
      ],
    },
  ]);

  assert.deepEqual(rows, [
    { measured_at: "2026-06-21", keyword: "라라스윗", value: 0 },
    { measured_at: "2026-06-22", keyword: "라라스윗", value: 42 },
  ]);
});

test("keeps compatibility with an already-running legacy Apify dataset", () => {
  const rows = parseGoogleTrendDataset([
    {
      searchTerm: "멜론쫀득바",
      interestOverTime_timelineData: [
        { time: "1782000000", value: [17] },
        { time: "1782086400", value: [] },
      ],
    },
  ]);

  assert.deepEqual(rows, [
    { measured_at: "2026-06-21", keyword: "멜론쫀득바", value: 17 },
    { measured_at: "2026-06-22", keyword: "멜론쫀득바", value: null },
  ]);
});
