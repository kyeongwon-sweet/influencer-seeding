import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../apps-script/repair_metric_contamination_20260828.gs", import.meta.url),
  "utf8",
);

function loadHelpers() {
  const start = source.indexOf("function metricRepairNumber_(");
  const end = source.indexOf("function metricRepair20260828ExpectedByKey_(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return new Function(
    `${source.slice(0, end)}\nreturn { shouldCarry: shouldClear20260827Carry_, shouldExplicit: shouldClear20260828Explicit_ };`,
  )() as {
    shouldCarry: (previous: unknown, target: unknown, expected: unknown) => boolean;
    shouldExplicit: (key: string, date: string, value: unknown) => boolean;
  };
}

function loadDailySyncDecision() {
  const numberStart = source.indexOf("function metricRepairNumber_(");
  const carryStart = source.indexOf("function dailyMetricSyncDecision20260901_(", numberStart);
  const end = source.indexOf("function isDeleteTarget20260901_(", carryStart);
  assert.ok(numberStart >= 0 && carryStart > numberStart && end > carryStart);
  return new Function(
    `${source.slice(numberStart, end)}\nreturn dailyMetricSyncDecision20260901_;`,
  )() as (
    sheet: unknown,
    expected: unknown,
    manual: boolean | null,
    previousSheet: unknown,
    previousExpected: unknown,
    previousManual: boolean | null,
    previousWasProvenCarry?: boolean,
  ) => { action: string; reason: string };
}

test("8/27 carry-forward repair clears only stale cells that disagree with DB", () => {
  const { shouldCarry } = loadHelpers();
  assert.equal(shouldCarry(466_637, 466_637, 633_374), true);
  assert.equal(shouldCarry(100, 100, null), true);
  assert.equal(shouldCarry(100, 100, 100), false, "a legitimate flat DB measurement is preserved");
  assert.equal(shouldCarry(100, 101, 101), false, "non-carry values are preserved");
  assert.equal(shouldCarry("", 100, 200), false);
});

test("known cross-post contamination is scoped to exact keys, dates, and values", () => {
  const { shouldExplicit } = loadHelpers();
  assert.equal(shouldExplicit("tt:7677553177486478599", "2026-08-26", 466_637), true);
  assert.equal(shouldExplicit("tt:7677553177486478599", "2026-08-27", "633,000"), true);
  assert.equal(shouldExplicit("ig:Db5iVQYhJT5", "2026-08-26", 466_637), true);
  assert.equal(shouldExplicit("ig:Db5fNo6k6bI", "2026-08-27", 633_374), true);
  assert.equal(shouldExplicit("ig:Db5fNo6k6bI", "2026-08-28", 633_000), true);
  assert.equal(shouldExplicit("ig:Db5fNo6k6bI", "2026-08-29", 633_000), true);
  assert.equal(shouldExplicit("ig:Db5fNo6k6bI", "2026-08-30", 633_000), true);
  assert.equal(shouldExplicit("tt:7677969398061141255", "2026-08-31", 116_853), true);
  assert.equal(shouldExplicit("tt:7669021425163881746", "2026-08-28", 97_643), true);
  assert.equal(shouldExplicit("yt:GBWxY0RlRqA", "2026-08-26", 97_643), true);
  assert.equal(shouldExplicit("yt:GBWxY0RlRqA", "2026-08-31", 149_000), true);
  assert.equal(shouldExplicit("ig:DcfkdB4PdEq", "2026-08-27", 633_374), false, "real Meokrini metric is never cleared");
  assert.equal(shouldExplicit("ig:Db5fNo6k6bI", "2026-08-27", 816), false);
});

test("daily sheet sync repairs automatic DB truth but preserves manual and ambiguous values", () => {
  const decide = loadDailySyncDecision();
  assert.deepEqual(decide("", 123, false, null, null, null), { action: "set_db", reason: "db_fill" });
  assert.deepEqual(decide(999, 123, false, null, null, null), { action: "set_db", reason: "auto_mismatch" });
  assert.deepEqual(decide(999, 123, true, null, null, null), { action: "none", reason: "manual_preserved" });
  assert.deepEqual(decide(123, 123, false, null, null, null), { action: "none", reason: "same" });
  assert.deepEqual(decide(123, null, null, 123, 123, false), { action: "clear", reason: "proven_carry" });
  assert.deepEqual(decide(123, null, null, 123, null, null, true), { action: "clear", reason: "proven_carry" });
  assert.deepEqual(decide(123, null, null, 123, 123, true), { action: "none", reason: "sheet_only_unproven" });
  assert.deepEqual(decide(123, null, null, 120, 120, false), { action: "none", reason: "sheet_only_unproven" });
});

test("repair applies backup-before-clear and rehydrates only through exportStats", () => {
  const dbBeforeIndex = source.indexOf("const dbBefore = requestMetricContaminationDbRepair20260828_(false)");
  const backupIndex = source.indexOf("metricRepair20260828Backup_(scan.sheet, scan.edits, dbBefore.rows || [])");
  const clearIndex = source.indexOf("writeColumnRuns_(scan.sheet");
  const dbRepairIndex = source.indexOf("repairMetricContaminationDb20260828_()", clearIndex);
  const refreshIndex = source.indexOf("const refreshedExpected = metricRepair20260828ExpectedByKey_()", dbRepairIndex);
  const exportIndex = source.indexOf("const exported = exportStatsWithOptions_({ skipFormulaRefresh: true })");
  const preserveBlankIndex = source.indexOf("const blankExpected = scan.edits.filter", exportIndex);
  const verifyIndex = source.indexOf("const mismatches = scan.edits.filter", preserveBlankIndex);
  assert.ok(dbBeforeIndex >= 0 && backupIndex > dbBeforeIndex && clearIndex > backupIndex && dbRepairIndex > clearIndex);
  assert.ok(refreshIndex > dbRepairIndex && exportIndex > refreshIndex);
  assert.ok(preserveBlankIndex > exportIndex && verifyIndex > preserveBlankIndex);
  assert.match(source, /post_export_blank_preserved/);
  assert.match(source, /expectedValue == null\) return actualValue !== ""/);
  assert.match(source, /function auditMetricContaminationDb20260828\(\)/);
  assert.match(source, /method: apply \? "post" : "get"/);
  assert.match(source, /assertRowCountStable_\(scan\.sheet, scan\.lastRow\)/);
  assert.match(source, /Object\.keys\(explicitValues\)\.forEach/);
  assert.match(source, /while \(ss\.getSheetByName\(backupName\)\)/);
  assert.match(source, /db_stat_snapshot/);
  assert.match(source, /METRIC_REPAIR_20260901_DELETE_COUNT_ = 19/);
  assert.match(source, /METRIC_REPAIR_20260901_SHEET_CLEAR_COUNT_ = 7/);
  assert.match(source, /삭제 대상 시트 셀 수 불일치/);
  assert.match(source, /삭제 대상 DB 행 수 불일치/);
  assert.doesNotMatch(source, /importStats\(/);
  assert.match(source, /function auditDailyMetricSync20260901\(\)/);
  assert.match(source, /function repairDailyMetricSync20260901\(\)/);
  assert.match(source, /dailyMetricSyncBackup20260901_\(scan\.sheet, scan\.edits\)/);
  assert.match(source, /dailyMetricSyncAssertStable20260901_\(scan\.sheet, scan\.edits, scan\.lastRow, urlCol\)/);
  assert.match(source, /dailyMetricSyncWriteColumns20260901_\(scan\.sheet, scan\.edits, scan\.lastRow, urlCol\)/);
  assert.match(source, /if \(!editedRows\[i\] && formulas\[i\]\[0\]\) values\[i\]\[0\] = formulas\[i\]\[0\]/);
  assert.doesNotMatch(source, /getRange\(edit\.row, urlCol\)\.getValue\(\)/);
  assert.match(source, /after\.edits\.length/);
  assert.doesNotMatch(
    source,
    /if \([^)]*post\.ended_at[^)]*\)\s*continue/,
    "carry-forward chains after ended_at must remain visible to the conservative audit",
  );
  assert.match(
    source,
    /const expectedItem = afterTrackingEnd \? null : \(post\.dates\[date\] \|\| null\)/,
    "DB rows after ended_at must not be re-filled into the sheet",
  );
});
