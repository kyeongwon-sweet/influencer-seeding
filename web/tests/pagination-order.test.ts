import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();
const appRoot = join(root, "app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function statementAt(source: string, index: number): string {
  const start = source.lastIndexOf(";", index - 1) + 1;
  const end = source.indexOf(";", index);
  return source.slice(start, end === -1 ? source.length : end + 1);
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

const SAFE_QUERY_BUILDERS = new Map<string, RegExp>([
  // baseQuery() ends in uploaded_at + id ordering and is shared by limit and full-pagination reads.
  ["app/api/organic-mentions/route.ts", /baseQuery\(\)\.range\(/],
]);

test("every range pagination query ends with a unique id order", () => {
  const unsafe: string[] = [];

  for (const file of sourceFiles(appRoot)) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(root, file).replaceAll("\\", "/");
    for (const match of source.matchAll(/\.range\(/g)) {
      const index = match.index ?? 0;
      const statement = statementAt(source, index);
      const safeBuilder = SAFE_QUERY_BUILDERS.get(relativePath);
      if (safeBuilder?.test(statement)) continue;

      const orderKeys = [...statement.matchAll(/\.order\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
      if (orderKeys.at(-1) !== "id") {
        unsafe.push(`${relativePath}:${lineAt(source, index)} order=[${orderKeys.join(", ") || "none"}]`);
      }
    }
  }

  assert.deepEqual(
    unsafe,
    [],
    `Supabase range pagination requires a unique final order key:\n${unsafe.join("\n")}`,
  );
});

test("the organic range exception keeps its id-ordered query builder", () => {
  const source = readFileSync(join(root, "app/api/organic-mentions/route.ts"), "utf8");
  assert.match(
    source,
    /\.order\("uploaded_at", \{ ascending: false, nullsFirst: false \}\)\s*\.order\("id", \{ ascending: true \}\)/,
  );
});
