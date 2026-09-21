import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repair = readFileSync(
  new URL("../../apps-script/repair_sidecar_manual_reach_20260907.gs", import.meta.url),
  "utf8",
);
const combined = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url), "utf8");

test("Sidecar 수기 도달수 복구는 URL·날짜·값·고아행을 exact guard 한다", () => {
  assert.match(repair, /targetKey: "ig:Dcz8HU6kRe7"/);
  assert.match(repair, /targetDate: "2026-09-06"/);
  assert.match(repair, /value: 114525/);
  assert.match(repair, /orphanRow: 3990/);
  assert.match(repair, /targetRows\.length !== 1/);
  assert.match(repair, /Number\(orphanMetric\) !== cfg\.value/);
  assert.match(repair, /unexpectedOrphan\.length/);
  assert.match(repair, /const urlCol = fieldCols\.url/);
  assert.match(repair, /findHeaderCol_\(sheet, \["누적 조회수", "누적조회수"\]\)/);
  assert.match(repair, /const incrementCol = getIncrementCol_\(sheet\)/);
  assert.doesNotMatch(repair, /CONFIG\.(?:URL|CUMULATIVE|INCREMENT)_COL/);
});

test("Sidecar 복구는 쓰기 전에 compact 백업을 남기고 목표 셀·고아행만 쓴다", () => {
  const backup = repair.indexOf("props.setProperty(cfg.backupProperty");
  const targetWrite = repair.indexOf("sheet.getRange(targetRow, dateCol).setValue(cfg.value)");
  const orphanClear = repair.indexOf("orphanRange.clearContent()");
  assert.ok(backup >= 0 && targetWrite > backup && orphanClear > backup);
  assert.doesNotMatch(repair, /deleteRow|deleteRows|setFormula|setFormulas/);
});

test("완료된 Sidecar 복구는 기록 소스로 보존하되 일상 동기화에서는 분리된다", () => {
  assert.match(repair, /if \(props\.getProperty\(cfg\.doneProperty\)\) return \{ status: "ALREADY_DONE" \}/);
  assert.match(repair, /LockService\.getDocumentLock\(\)/);
  assert.doesNotMatch(combined, /runSidecarManualReachRepair20260907IfNeeded_\(\)/);
  assert.doesNotMatch(combined, /repairSidecarManualReach20260907/);
  const exportStart = combined.indexOf("function exportStatsWithOptions_(options)");
  const exportEnd = combined.indexOf("function parseMonthDay_", exportStart);
  assert.ok(exportStart >= 0 && exportEnd > exportStart);
  assert.doesNotMatch(combined.slice(exportStart, exportEnd), /runSidecarManualReachRepair20260907IfNeeded_\(\)/);
});

test("guarded clasp 정리 목록이 완료된 Sidecar 복구 파일의 재배포를 막는다", () => {
  const deployList = deploy.slice(deploy.indexOf("const deployFiles"), deploy.indexOf("const preservedLiveOnlyFiles"));
  const deprecatedList = deploy.slice(deploy.indexOf("const deprecatedLiveFiles"), deploy.indexOf("function read("));
  assert.doesNotMatch(deployList, /repair_sidecar_manual_reach_20260907\.gs/);
  assert.match(deprecatedList, /repair_sidecar_manual_reach_20260907\.js/);
});
