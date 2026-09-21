import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(repoRoot, "dist", "apps-script");
const flatWorkDir = join(repoRoot, "dist", "apps-script-flat");
const scriptId = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const push = process.argv.includes("--push");
const insightInquiryFile = "인사이트_문의_메시지_자동생성.gs";

const deployFiles = [
  ["Combined_Sheet_AppsScript.gs", "01_연동시트_자동동기화.js"],
  ["_WriteGuard.gs", "02_시트쓰기_충돌방지.js"],
  [join("apps-script", "cumulative_formula_integrity.gs"), "03_누적조회수_수식안전.js"],
  [join("apps-script", "linked_sheet_readability_theme_20260812.gs"), "04_연동시트_기본서식.js"],
  [join("apps-script", "linked_sheet_row_format_daily.gs"), "05_연동시트_신규행_서식.js"],
  [join("apps-script", "repair_asset_name_pollution_20260813.gs"), "06_소재명_파일목록_자동정리.js"],
  [join("apps-script", insightInquiryFile), "07_배너_인사이트_문의_자동생성.js"],
  [join("apps-script", "appsscript.json"), "appsscript.json"],
];

// 라이브에만 존재하지만 실제 트리거/웹앱이 사용하는 운영 파일이다.
// fresh pull 뒤 내용은 그대로 보존하고, 파일명만 한국어 운영명으로 정규화한다.
const preservedLiveOnlyFiles = [
  {
    oldName: "바이럴 최신효율 업데이트.js",
    newName: "08_바이럴_최신효율_업데이트.js",
    markers: ["function updateExpectedViews", "function doGet", "function doPost"],
  },
  {
    oldName: "파인트집계.js",
    newName: "09_제품별_일별성과_집계.js",
    markers: ["function PT_run", "function PT_addMenu"],
  },
];

// 완료된 일회성 수리/감사 파일과 핵심 파일에 이미 병합된 중복 정의.
// 소스는 git/snapshot과 배포 전 ZIP에 보존되며 라이브 프로젝트에서는 제거한다.
const deprecatedLiveFiles = [
  "AI 트래킹 대시보드 연동.js",
  "_WriteGuard.js",
  "cumulative_formula_integrity.js",
  "인사이트_문의_메시지_자동생성.js",
  "linked_sheet_readability_theme_20260812.js",
  "linked_sheet_row_format_daily.js",
  "repair_asset_name_pollution_20260813.js",
  "바이럴 업체명 채우기.js",
  "업로드 일보다 이전 데이터 삭제.js",
  "제목 없음.js",
  "audit_cost_mapping_20260915.js",
  "cleanup_url_params_20260730.js",
  "cpv_validation_audit_20260806.js",
  "cpv_validation_rebuild_v2_20260806.js",
  "ensure_daily_report_20260827.js",
  "linked_sheet_cleanup_20260811.js",
  "linked_sheet_duplicate_audit_20260901.js",
  "metric_sheet_repairs_20260806.js",
  "rebuild_cpv_validation_20260806.js",
  "repair_banner_reach_20260901.js",
  "repair_c15_costs_20260915.js",
  "repair_duplicate_rows_20260901.js",
  "repair_issue_tiktok_duplicate_20260901.js",
  "repair_issuebox_youtube_duplicate_20260903.js",
  "repair_metric_contamination_20260828.js",
  "repair_metric_spikes_20260903.js",
  "repair_missing_date_header_20260901.js",
  "repair_posted_at_20260907.js",
  "repair_rd_main_import_20260728.js",
  "repair_shugi_0908_20260914.js",
  "repair_sidecar_manual_reach_20260907.js",
  "repair_tiktok_20260729.js",
  "repair_zero_metrics_20260728.js",
  "schedule_heartbeat.js",
];

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readDist(path, targetDir = distDir) {
  return readFileSync(join(targetDir, path), "utf8");
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function assertMarker(name, ok) {
  if (!ok) throw new Error(`Apps Script deploy check failed: ${name}`);
}

function stageFiles(targetDir = distDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const [src, dest] of deployFiles) {
    copyFileSync(join(repoRoot, src), join(targetDir, dest));
  }
}

function resetDistForDryRun() {
  rmSync(distDir, { recursive: true, force: true });
  stageFiles();
}

function verifyDistMatchesSource(stage, targetDir = distDir) {
  for (const [src, dest] of deployFiles) {
    const expected = normalize(read(src));
    const actual = normalize(readDist(dest, targetDir));
    if (actual !== expected) {
      throw new Error(`Apps Script ${stage} mismatch: ${dest} does not match ${src}`);
    }
  }
  console.log(`[APPS_SCRIPT_VERIFIED] ${stage}: ${deployFiles.length} files match source`);
}

function resetDistForLivePull() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, ".clasp.json"), JSON.stringify({ scriptId }, null, 2) + "\n", "utf8");
}

function projectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...projectFiles(path));
    else if (name !== ".clasp.json") out.push(path);
  }
  return out;
}

function flattenPulledProject() {
  const files = projectFiles(distDir);
  const byName = new Map();
  let nested = 0;
  for (const path of files) {
    const name = basename(path);
    if (byName.has(name)) throw new Error(`Apps Script pull has duplicate basename: ${name}`);
    byName.set(name, path);
    if (resolve(path) !== resolve(join(distDir, name))) nested++;
  }
  if (!byName.has("appsscript.json")) {
    throw new Error("Apps Script pull did not produce appsscript.json.");
  }

  rmSync(flatWorkDir, { recursive: true, force: true });
  mkdirSync(flatWorkDir, { recursive: true });
  for (const [name, path] of byName) copyFileSync(path, join(flatWorkDir, name));

  resetDistForLivePull();
  for (const name of readdirSync(flatWorkDir)) copyFileSync(join(flatWorkDir, name), join(distDir, name));
  rmSync(flatWorkDir, { recursive: true, force: true });
  console.log(`[APPS_SCRIPT_PULL_FLATTENED] files=${byName.size} nested=${nested}`);
}

function normalizePreservedLiveFiles(targetDir = distDir) {
  for (const { oldName, newName, markers } of preservedLiveOnlyFiles) {
    const oldPath = join(targetDir, oldName);
    const newPath = join(targetDir, newName);
    const oldExists = existsSync(oldPath);
    const newExists = existsSync(newPath);
    if (!oldExists && !newExists) {
      throw new Error(`Apps Script required live-only file is missing: ${oldName} / ${newName}`);
    }
    if (oldExists && newExists) {
      const oldSource = normalize(readFileSync(oldPath, "utf8"));
      const newSource = normalize(readFileSync(newPath, "utf8"));
      if (oldSource !== newSource) {
        throw new Error(`Apps Script rename collision has different contents: ${oldName} / ${newName}`);
      }
      rmSync(oldPath, { force: true });
    } else if (oldExists) {
      copyFileSync(oldPath, newPath);
      rmSync(oldPath, { force: true });
    }
    const source = readFileSync(newPath, "utf8");
    for (const marker of markers) {
      assertMarker(`${newName} marker ${marker}`, source.includes(marker));
    }
    console.log(`[APPS_SCRIPT_RENAMED] ${oldName} -> ${newName}`);
  }
}

function removeDeprecatedLiveFiles(targetDir = distDir) {
  const removed = [];
  for (const name of deprecatedLiveFiles) {
    const path = join(targetDir, name);
    if (!existsSync(path)) continue;
    rmSync(path, { force: true });
    removed.push(name);
  }
  console.log(`[APPS_SCRIPT_DEPRECATED_REMOVED] count=${removed.length}`);
}

function expectedLiveFileNames() {
  return new Set([
    ...deployFiles.map(([, dest]) => dest),
    ...preservedLiveOnlyFiles.map(({ newName }) => newName),
  ]);
}

function verifyLiveInventory(stage, targetDir = distDir) {
  const expected = expectedLiveFileNames();
  const actual = new Set(projectFiles(targetDir).map(path => basename(path)));
  const missing = [...expected].filter(name => !actual.has(name));
  const extra = [...actual].filter(name => !expected.has(name));
  if (missing.length || extra.length) {
    throw new Error(`Apps Script ${stage} inventory mismatch: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
  }
  console.log(`[APPS_SCRIPT_INVENTORY_VERIFIED] ${stage}: ${actual.size} files`);
}

function runClasp(args, cwd = repoRoot) {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd", "-y", "@google/clasp", ...args]
    : ["-y", "@google/clasp", ...args];
  const res = spawnSync(command, commandArgs, {
    cwd,
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

resetDistForLivePull();
runClasp(["pull"], distDir);
flattenPulledProject();
normalizePreservedLiveFiles();
removeDeprecatedLiveFiles();
stageFiles();
verifyDistMatchesSource("staged after live pull");
verifyLiveInventory("staged after cleanup");
runClasp(["status"], distDir);
runClasp(["push", "--force"], distDir);
resetDistForLivePull();
runClasp(["pull"], distDir);
flattenPulledProject();
verifyDistMatchesSource("live pull");
verifyLiveInventory("live pull");
console.log("[APPS_SCRIPT_PUSH_VERIFIED] live Apps Script matches the staged repo source.");
