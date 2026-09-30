import assert from "node:assert/strict";
import test from "node:test";
import { buildProductSearchTrends } from "../lib/product-search-trends.ts";

test("service-account rows reproduce the former two-level gviz headers", () => {
  const result = buildProductSearchTrends([
    ["날짜", "라라스윗", "쫀득바", null, "파인트"],
    [null, "라라스윗", "쫀득바", "망고쫀득바", "파인트"],
    ["2026. 9. 29", 2518, 1023, 96, 218],
  ]);
  assert.equal(result.brandKey, "라라스윗 라라스윗");
  assert.deepEqual(result.products, ["쫀득바 쫀득바", "쫀득바 망고쫀득바", "파인트 파인트"]);
  assert.deepEqual(result.data[0], {
    date: "2026-09-29",
    values: {
      "라라스윗 라라스윗": 2518,
      "쫀득바 쫀득바": 1023,
      "쫀득바 망고쫀득바": 96,
      "파인트 파인트": 218,
    },
  });
});
