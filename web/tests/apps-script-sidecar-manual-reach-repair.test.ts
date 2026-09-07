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
});

test("Sidecar 복구는 쓰기 전에 compact 백업을 남기고 목표 셀·고아행만 쓴다", () => {
  const backup = repair.indexOf("props.setProperty(cfg.backupProperty");
  const targetWrite = repair.indexOf("sheet.getRange(targetRow, dateCol).setValue(cfg.value)");
  const orphanClear = repair.indexOf("orphanRange.clearContent()");
  assert.ok(backup >= 0 && targetWrite > backup && orphanClear > backup);
  assert.doesNotMatch(repair, /deleteRow|deleteRows|setFormula|setFormulas/);
});

test("Sidecar 복구는 완료 마커로 재실행을 no-op 하고 독립 잠금 단계·정기 동기화에 배선된다", () => {
  assert.match(repair, /if \(props\.getProperty\(cfg\.doneProperty\)\) return \{ status: "ALREADY_DONE" \}/);
  assert.match(repair, /LockService\.getDocumentLock\(\)/);
  assert.match(combined, /function scheduledDbPullSync_\(\) \{[\s\S]*?runSidecarManualReachRepair20260907IfNeeded_\(\)/);
  assert.match(combined, /\["repairSidecarManualReach20260907", function\(\) \{[\s\S]*?runSidecarManualReachRepair20260907IfNeeded_\(\)/);
  const exportStart = combined.indexOf("function exportStatsWithOptions_(options)");
  const exportEnd = combined.indexOf("function parseMonthDay_", exportStart);
  assert.ok(exportStart >= 0 && exportEnd > exportStart);
  assert.doesNotMatch(combined.slice(exportStart, exportEnd), /runSidecarManualReachRepair20260907IfNeeded_\(\)/);
});

test("guarded clasp 배포에 Sidecar 수기 도달수 복구 파일이 포함된다", () => {
  assert.match(deploy, /repair_sidecar_manual_reach_20260907\.gs/);
});
