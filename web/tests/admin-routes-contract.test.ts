import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("delete-date-stats requires admin allowlist and validates date format", () => {
  const source = read("app/api/admin/delete-date-stats/route.ts");

  assert.match(source, /getAdminEmail/);
  assert.doesNotMatch(source, /from ["']@clerk\/nextjs\/server["']/);
  assert.match(source, /Forbidden/);
  assert.match(source, /Date must be YYYY-MM-DD/);
  assert.match(source, /\\d\{4\}-\\d\{2\}-\\d\{2\}/);
});

test("normalize-urls is admin-only and GET is dry-run only", () => {
  const source = read("app/api/admin/normalize-urls/route.ts");

  assert.match(source, /getAdminEmail/);
  assert.match(source, /export async function GET\(\)/);
  assert.match(source, /normalizeStoredUrls\(false\)/);
  assert.match(source, /export async function POST\(req: NextRequest\)/);
  assert.match(source, /body\?\.dry_run !== false && body\?\.apply !== true/);
  assert.match(source, /normalizeStoredUrls\(!dryRun\)/);
});
