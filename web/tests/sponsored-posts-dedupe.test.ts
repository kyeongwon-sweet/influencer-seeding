import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { dedupeRowsById } from "../lib/dedupe-rows.ts";

test("dedupeRowsById keeps the first row and reports duplicate ids once", () => {
  const rows = [
    { id: "a", value: 1 },
    { id: "b", value: 2 },
    { id: "a", value: 3 },
    { id: "a", value: 4 },
  ];

  assert.deepEqual(dedupeRowsById(rows), {
    rows: [rows[0], rows[1]],
    duplicateIds: ["a"],
  });
});

test("sponsored-post pagination and monitoring both enforce unique post ids", () => {
  const root = process.cwd();
  const route = readFileSync(join(root, "app/api/sponsored-posts/route.ts"), "utf8");
  const page = readFileSync(join(root, "app/monitoring/page.tsx"), "utf8");

  assert.match(
    route,
    /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: true \}\)\s*\.range/,
  );
  assert.match(route, /dedupeRowsById\(posts\)/);
  assert.match(page, /dedupeRowsById\(decodedPosts\)/);
});
