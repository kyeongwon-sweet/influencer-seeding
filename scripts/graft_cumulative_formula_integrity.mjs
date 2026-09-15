import { readFileSync, readdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const liveDir = join(root, "scratchpad", "c16-live-20260915");
const mainName = "AI 트래킹 대시보드 연동.js";
const helperName = "cumulative_formula_integrity.js";
const oldLine = "  range.setValues(out);  // '='로 시작하는 문자열은 수식으로 들어감 — 값·수식 혼합 1회 배치 쓰기";
const newLine = "  const cumulativeWrite = writeCumulativeFormulaChanges_(sheet, range, values, formulas, out, lastRow);\n  Logger.log(\"cumulative_formula_write \" + JSON.stringify(cumulativeWrite));";
const oldToast = '"누적 조회수 행별 수식 " + wrote + "행 갱신 · 수동/레거시 값 보존 " + manualKept + "건"';
const newToast = '"누적 조회수 수식 " + cumulativeWrite.verified + "행 적용 검증 · 기존 값/특수수식 보존"';
const normalize = text => text.replaceAll("\r\n", "\n");
const read = path => normalize(readFileSync(path, "utf8"));
const hash = text => createHash("sha256").update(text).digest("hex");
function clasp(args) {
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "npx.cmd", "-y", "@google/clasp", ...args], {
    cwd: liveDir, stdio: "inherit", shell: false,
  });
  if (result.status !== 0) throw new Error("C16 clasp failed");
}
clasp(["pull"]);
const originals = new Map(readdirSync(liveDir).filter(name => name !== ".clasp.json").map(name => [name, hash(read(join(liveDir, name)))]));
const live = read(join(liveDir, mainName));
const expected = read(join(root, "Combined_Sheet_AppsScript.gs"));
const patched = (live.includes(oldLine) ? live.replace(oldLine, newLine) : live).replace(oldToast, newToast);
if (patched !== expected) throw new Error("C16 graft refused: live has unrelated changes; do not overlay repo");
if (live.includes(oldLine) && live.split(oldLine).length !== 2) throw new Error("C16 graft refused: write marker is not unique");
if (!process.argv.includes("--apply")) {
  console.log("[C16_GRAFT_DRY_RUN] live files preserved; only H writer call and one helper are eligible");
  process.exit(0);
}
// These two sources are accepted only after the exact live-to-repo diff check above.
copyFileSync(join(root, "Combined_Sheet_AppsScript.gs"), join(liveDir, mainName));
copyFileSync(join(root, "apps-script", "cumulative_formula_integrity.gs"), join(liveDir, helperName));
const staged = new Map(readdirSync(liveDir).filter(name => name !== ".clasp.json").map(name => [name, hash(read(join(liveDir, name)))]));
const changed = [...staged].filter(([name, digest]) => originals.get(name) !== digest).map(([name]) => name);
if (changed.some(name => name !== mainName && name !== helperName)) throw new Error("C16 graft includes unrelated files");
const preserved = [...originals].filter(([name, digest]) => staged.get(name) === digest).length;
console.log(`[C16_GRAFT] changed=${JSON.stringify(changed)} preserved=${preserved}`);
clasp(["push", "--force"]);
clasp(["pull"]);
for (const [name, digest] of staged) {
  if (hash(read(join(liveDir, name))) !== digest) throw new Error(`C16 verification failed: ${name}`);
}
console.log(`[C16_GRAFT_VERIFIED] ${staged.size} live files match staged content; no sheet/DB function executed`);
