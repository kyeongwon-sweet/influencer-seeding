import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("admin workspace pages are blocked at the middleware boundary", () => {
  const source = read("middleware.ts");

  assert.match(source, /isAdminEmail/);
  assert.match(source, /const isAdminPage = createRouteMatcher/);
  for (const path of ["listup", "screening", "contact"]) {
    assert.match(source, new RegExp(`/${path}\\(\.\\*\\)`));
  }
  assert.match(source, /isAdminPage\(request\)\s*&&\s*!isAdminEmail\(email\)/);
  assert.match(source, /url\.pathname = "\/access-denied"/);
  assert.match(source, /url\.searchParams\.set\("reason", "admin"\)/);
});

test("admin-only workspace APIs require the server allowlist", () => {
  const protectedRoutes = [
    "app/api/contact-templates/route.ts",
    "app/api/screening-criteria/route.ts",
    "app/api/keyword-impact/route.ts",
    "app/api/keywords/route.ts",
    "app/api/keywords/[id]/route.ts",
    "app/api/blacklist/route.ts",
    "app/api/naver-trends/route.ts",
    "app/api/influencers/[id]/route.ts",
  ];

  for (const path of protectedRoutes) {
    const source = read(path);
    assert.match(source, /getAdminEmail/);
    assert.match(source, /Forbidden/);
    assert.match(source, /status:\s*403/);
  }
});

test("shared APIs keep public reads but protect admin-only writes", () => {
  const influencers = read("app/api/influencers/route.ts");
  const getBody = influencers.slice(
    influencers.indexOf("export async function GET"),
    influencers.indexOf("export async function POST"),
  );
  const postBody = influencers.slice(influencers.indexOf("export async function POST"));
  assert.doesNotMatch(getBody, /getAdminEmail/);
  assert.match(postBody, /getAdminEmail/);
  assert.match(postBody, /Forbidden/);

  const jobs = read("app/api/jobs/route.ts");
  assert.match(jobs, /type === ['"]listup['"]\s*\|\|\s*type === ['"]screening['"]/);
  assert.match(jobs, /getAdminEmail/);
  assert.match(jobs, /Forbidden/);
});

test("the existing two-person admin allowlist remains unchanged", () => {
  const admin = read("lib/admin.ts");
  assert.match(admin, /hwangkw@lalasweet\.kr/);
  assert.match(admin, /choeseoeun@lalasweet\.kr/);
});
