import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripAssetFileListing } from "../lib/asset-name-policy.ts";

test("removes an appended delivery-file list but keeps the canonical asset token", () => {
  assert.equal(
    stripAssetFileListing("[26.08]F_V_JD멜_바이럴_김바다_260807_빙과_최재헌.mp4, 2. 속지.mp4, 3. 표지.png"),
    "[26.08]F_V_JD멜_바이럴_김바다_260807_빙과_최재헌",
  );
});

test("recognizes pipe and numbered cover markers", () => {
  assert.equal(stripAssetFileListing("정상소재 | delivery.zip"), "정상소재");
  assert.equal(stripAssetFileListing("정상소재 2. 속지.mp4"), "정상소재");
});

test("preserves clean names and empty semantics", () => {
  assert.equal(stripAssetFileListing("[26.08]F_V_JD멜_빙과_최재헌"), "[26.08]F_V_JD멜_빙과_최재헌");
  assert.equal(stripAssetFileListing(""), null);
  assert.equal(stripAssetFileListing(null), null);
});

test("all asset_name write paths apply the shared guard", () => {
  const files = [
    "../lib/sponsored-write.ts",
    "../app/api/marketing/sync/route.ts",
    "../app/api/sponsored-posts/route.ts",
    "../app/api/sponsored-posts/[id]/route.ts",
    "../app/api/sponsored-posts/stats-import/route.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /stripAssetFileListing/);
  }
});
