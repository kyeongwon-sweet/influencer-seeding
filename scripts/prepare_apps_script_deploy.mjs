import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(repoRoot, "dist", "apps-script");
const scriptId = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const push = process.argv.includes("--push");
const insightInquiryFile = "인사이트_문의_메시지_자동생성.gs";

const deployFiles = [
  ["Combined_Sheet_AppsScript.gs", "AI 트래킹 대시보드 연동.js"],
  ["_WriteGuard.gs", "_WriteGuard.js"],
  [join("apps-script", insightInquiryFile), insightInquiryFile.replace(/\.gs$/, ".js")],
  [join("apps-script", "appsscript.json"), "appsscript.json"],
];

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readDist(path) {
  return readFileSync(join(distDir, path), "utf8");
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function assertMarker(name, ok) {
  if (!ok) throw new Error(`Apps Script deploy check failed: ${name}`);
}

function stageFiles() {
  mkdirSync(distDir, { recursive: true });
  for (const [src, dest] of deployFiles) {
    copyFileSync(join(repoRoot, src), join(distDir, dest));
  }
}

function resetDistForDryRun() {
  rmSync(distDir, { recursive: true, force: true });
  stageFiles();
}

function verifyDistMatchesSource(stage) {
  for (const [src, dest] of deployFiles) {
    const expected = normalize(read(src));
    const actual = normalize(readDist(dest));
    if (actual !== expected) {
      throw new Error(`Apps Script ${stage} mismatch: ${dest} does not match ${src}`);
    }
  }
  console.log(`[APPS_SCRIPT_VERIFIED] ${stage}: ${deployFiles.length} files match source`);
}

function runClasp(args) {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd", "-y", "@google/clasp", ...args]
    : ["-y", "@google/clasp", ...args];
  const res = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (res.error) {
    console.error(`[APPS_SCRIPT_CLASP_ERROR] ${res.error.message}`);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const combined = read("Combined_Sheet_AppsScript.gs");
const guard = read("_WriteGuard.gs");
const insightInquiry = read(join("apps-script", insightInquiryFile));

assertMarker("increment V2 SEQUENCE formula", combined.includes("SEQUENCE(1,COLUMNS(rng),COLUMN("));
assertMarker("no broken COLUMN(rng) increment formula", !combined.includes("cols,COLUMN(rng)"));
assertMarker("formula audit function", combined.includes("function auditLinkedSheetFormulas_()"));
assertMarker("auto write guard", combined.includes("function withAutoWriteGuard_"));
assertMarker("URL key index helper", guard.includes("function buildUrlKeyIndex_("));
assertMarker("insight inquiry menu", combined.includes("addInsightInquiryMenu_();"));
assertMarker("insight inquiry implementation", insightInquiry.includes("function insightInquiryBuildToday()"));

resetDistForDryRun();
verifyDistMatchesSource("prepared");

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

runClasp(["pull"]);
stageFiles();
verifyDistMatchesSource("staged after live pull");
runClasp(["status"]);
runClasp(["push", "--force"]);
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
runClasp(["pull"]);
verifyDistMatchesSource("live pull");
console.log("[APPS_SCRIPT_PUSH_VERIFIED] live Apps Script matches the staged repo source.");
