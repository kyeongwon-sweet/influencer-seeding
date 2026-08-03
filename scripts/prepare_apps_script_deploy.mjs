import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(repoRoot, "dist", "apps-script");
const scriptId = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const push = process.argv.includes("--push");

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function assertMarker(name, ok) {
  if (!ok) throw new Error(`Apps Script deploy check failed: ${name}`);
}

const combined = read("Combined_Sheet_AppsScript.gs");
const guard = read("_WriteGuard.gs");
const insightInquiry = read("apps-script/인사이트_문의_메시지_자동생성.gs");
assertMarker("increment V2 SEQUENCE formula", combined.includes("SEQUENCE(1,COLUMNS(rng),COLUMN("));
assertMarker("no broken COLUMN(rng) increment formula", !combined.includes("cols,COLUMN(rng)"));
assertMarker("formula audit function", combined.includes("function auditLinkedSheetFormulas_()"));
assertMarker("auto write guard", combined.includes("function withAutoWriteGuard_"));
assertMarker("URL key index helper", guard.includes("function buildUrlKeyIndex_("));
assertMarker("insight inquiry menu", combined.includes("addInsightInquiryMenu_();"));
assertMarker("insight inquiry implementation", insightInquiry.includes("function insightInquiryBuildToday()"));

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
copyFileSync(join(repoRoot, "Combined_Sheet_AppsScript.gs"), join(distDir, "Code.gs"));
copyFileSync(join(repoRoot, "_WriteGuard.gs"), join(distDir, "_WriteGuard.gs"));
copyFileSync(
  join(repoRoot, "apps-script", "인사이트_문의_메시지_자동생성.gs"),
  join(distDir, "인사이트_문의_메시지_자동생성.gs"),
);
copyFileSync(join(repoRoot, "apps-script", "appsscript.json"), join(distDir, "appsscript.json"));

console.log(`[APPS_SCRIPT_PREPARED] rootDir=${distDir}`);
console.log(`[APPS_SCRIPT_TARGET] scriptId=${scriptId}`);

if (!push) {
  console.log("[APPS_SCRIPT_DRY_RUN] dist prepared only. To push, rerun with --push and set APPS_SCRIPT_ALLOW_PUSH=1 plus APPS_SCRIPT_EXPECTED_SCRIPT_ID.");
  process.exit(0);
}

if (process.env.APPS_SCRIPT_ALLOW_PUSH !== "1") {
  throw new Error("Refusing clasp push: set APPS_SCRIPT_ALLOW_PUSH=1 explicitly.");
}
if (process.env.APPS_SCRIPT_EXPECTED_SCRIPT_ID !== scriptId) {
  throw new Error("Refusing clasp push: APPS_SCRIPT_EXPECTED_SCRIPT_ID does not match the production scriptId.");
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
for (const args of [
  ["-y", "@google/clasp", "status"],
  ["-y", "@google/clasp", "push"],
]) {
  const res = spawnSync(npx, args, { cwd: repoRoot, stdio: "inherit", shell: false });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
