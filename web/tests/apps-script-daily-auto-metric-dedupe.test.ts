// dailyAuto의 exportStats는 내부에서 H 갱신, gate에서 H/I/J 범위 복구까지 끝낸다.
// 성공 뒤 같은 작업을 다시 하지 않되, gate 지연·시간초과·재시도에는 기존 안전망을 유지한다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appsScript = readFileSync(
  join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"),
  "utf8",
).replace(/\r\n/g, "\n");

const fnSrc = (name: string) => {
  const start = appsScript.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 없음`);
  const end = appsScript.indexOf("\n}\n", start);
  assert.ok(end >= 0, `${name} 끝 없음`);
  return appsScript.slice(start, end + 3);
};

type Scenario = {
  completed?: boolean;
  attempt?: number;
  lookupError?: Error;
  exportError?: Error;
  exportResult?: boolean;
  cumulativeRefreshConfirmed?: boolean;
  preexistingMaintenanceMarker?: boolean;
};

function runScenario(scenario: Scenario) {
  const targetDate = "2026-11-15";
  const values: Record<string, string> = {
    IMPORT_STATS_COLLECTION_GATE_LAST_STATUS: "OK",
    IMPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE: targetDate,
  };
  if (scenario.preexistingMaintenanceMarker) {
    values.DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_DATE = targetDate;
    values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS = "OK";
    values.EXPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE = targetDate;
  }
  const props = {
    getProperty: (key: string) => values[key] ?? null,
    setProperty: (key: string, value: string) => { values[key] = String(value); },
    setProperties: (next: Record<string, unknown>) => {
      Object.entries(next).forEach(([key, value]) => { values[key] = String(value); });
    },
    deleteProperty: (key: string) => { delete values[key]; },
  };
  let exportCalls = 0;
  let refreshCalls = 0;
  let repairCalls = 0;
  let deferredCalls = 0;
  let timeoutAlerts = 0;

  const source = [
    fnSrc("runExportStatsCollectionGate_"),
    fnSrc("dailyAutoExportMaintenanceCompleted_"),
    fnSrc("refreshCumulativeViewsDailyAuto_"),
    fnSrc("repairMetricFormulaRangesDailyAuto_"),
  ].join("\n");

  const run = new Function(
    "PropertiesService",
    "collectionTargetDate_",
    "fetchCollectionStatus_",
    "dailyAutoErrorText_",
    "scheduleExportStatsAfterCollection_",
    "clearExportStatsGatePending_",
    "notifyExportStatsGateTimeout_",
    "withDocLock_",
    "exportStatsWithOptions_",
    "repairStaleMetricFormulaRanges_",
    "refreshCumulativeViews",
    "getSheet_",
    "scheduleDailyAutoRetry_",
    "Logger",
    "EXPORT_STATS_GATE_MAX_ATTEMPTS_",
    "IMPORT_STATS_GATE_STATUS_PROP_",
    "IMPORT_STATS_GATE_TARGET_PROP_",
    "DAILY_AUTO_IMPORT_RETRY_AFTER_EXPORT_PROP_",
    "DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_PROP_",
    `${source}\nreturn { runExportStatsCollectionGate_, refreshCumulativeViewsDailyAuto_, repairMetricFormulaRangesDailyAuto_ };`,
  )(
    { getScriptProperties: () => props },
    () => targetDate,
    () => {
      if (scenario.lookupError) throw scenario.lookupError;
      return { completed: scenario.completed !== false, run: null };
    },
    (error: unknown) => String(error),
    (_target: string, _attempt: number, _started: string, reason: string) => {
      deferredCalls += 1;
      values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS = "DEFERRED";
      values.EXPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE = targetDate;
      values.EXPORT_STATS_COLLECTION_GATE_LAST_REASON = reason;
      return true;
    },
    () => {},
    () => { timeoutAlerts += 1; },
    (fn: () => unknown) => fn(),
    (options: { metricMaintenanceState?: { cumulativeRefreshed: boolean } }) => {
      exportCalls += 1;
      if (scenario.exportError) throw scenario.exportError;
      if (scenario.exportResult === false) return false;
      // 실제 exportStatsWithOptions_가 내부에서 수행하는 H 갱신을 모사한다.
      refreshCalls += 1;
      if (options.metricMaintenanceState && scenario.cumulativeRefreshConfirmed !== false) {
        options.metricMaintenanceState.cumulativeRefreshed = true;
      }
      return true;
    },
    () => { repairCalls += 1; return true; },
    () => { refreshCalls += 1; return true; },
    () => ({}),
    () => [],
    { log: () => {} },
    16,
    "IMPORT_STATS_COLLECTION_GATE_LAST_STATUS",
    "IMPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE",
    "DAILY_AUTO_IMPORT_RETRY_AFTER_EXPORT_DATE",
    "DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_DATE",
  ) as {
    runExportStatsCollectionGate_: (source: string, pending: object | null) => boolean;
    refreshCumulativeViewsDailyAuto_: () => boolean;
    repairMetricFormulaRangesDailyAuto_: () => boolean;
  };

  const pending = scenario.attempt == null ? null : {
    target_date: targetDate,
    attempt: scenario.attempt,
    source_started_at: "2026-11-16T00:00:00.000Z",
  };
  assert.equal(run.runExportStatsCollectionGate_("dailyAuto", pending), true);
  assert.equal(run.refreshCumulativeViewsDailyAuto_(), true);
  assert.equal(run.repairMetricFormulaRangesDailyAuto_(), true);

  return {
    values,
    exportCalls,
    refreshCalls,
    repairCalls,
    deferredCalls,
    timeoutAlerts,
  };
}

test("실제 exportStats는 H 갱신 성공 여부를 gate에 전달하고 실패를 성공으로 표시하지 않는다", () => {
  const start = appsScript.indexOf("function exportStatsWithOptions_(options)");
  const end = appsScript.indexOf("\n// ═", start);
  const body = appsScript.slice(start, end);
  assert.match(body, /const metricMaintenanceState = options && options\.metricMaintenanceState/);
  assert.match(body, /metricMaintenanceState\.cumulativeRefreshed = false/);
  assert.match(
    body,
    /try \{ const cumulativeRefreshResult = refreshCumulativeViews\(\);[\s\S]*?metricMaintenanceState\.cumulativeRefreshed = cumulativeRefreshResult !== false;[\s\S]*?\} catch \(e\) \{ Logger\.log\(e\); \}/,
  );
});

test("성공한 export는 내부 H 갱신·gate 수식 복구만 수행하고 뒤 dailyAuto 중복 단계를 건너뛴다", () => {
  const result = runScenario({ completed: true });
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS, "OK");
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE, "2026-11-15");
  assert.equal(result.exportCalls, 1);
  assert.equal(result.refreshCalls, 1, "export 내부 H 갱신 뒤 중복 H 갱신 금지");
  assert.equal(result.repairCalls, 1, "gate 수식 복구 뒤 중복 범위 복구 금지");
});

test("수집 gate pending이면 export를 건너뛰고 뒤 H 갱신·수식 복구 안전망을 유지한다", () => {
  const result = runScenario({ completed: false, attempt: 0, preexistingMaintenanceMarker: true });
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS, "DEFERRED");
  assert.equal(result.values.DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_DATE, undefined, "이번 attempt가 이전 성공 표식을 먼저 지움");
  assert.equal(result.exportCalls, 0);
  assert.equal(result.deferredCalls, 1);
  assert.equal(result.refreshCalls, 1);
  assert.equal(result.repairCalls, 1);
});

test("수집 gate timeout이면 알림 후에도 뒤 H 갱신·수식 복구 안전망을 유지한다", () => {
  const result = runScenario({ completed: false, attempt: 16 });
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS, "COLLECTION_TIMEOUT");
  assert.equal(result.exportCalls, 0);
  assert.equal(result.deferredCalls, 0);
  assert.equal(result.timeoutAlerts, 1);
  assert.equal(result.refreshCalls, 1);
  assert.equal(result.repairCalls, 1);
});

test("export 실패로 재시도 예약 중이면 뒤 H 갱신·수식 복구 안전망을 유지한다", () => {
  const result = runScenario({ completed: true, exportError: new Error("temporary") });
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS, "DEFERRED");
  assert.equal(result.exportCalls, 1);
  assert.equal(result.deferredCalls, 1);
  assert.equal(result.refreshCalls, 1);
  assert.equal(result.repairCalls, 1);
});

test("collection retry에서 export가 성공해도 같은 target의 뒤 중복 단계를 건너뛴다", () => {
  const result = runScenario({ completed: true, attempt: 3 });
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS, "OK");
  assert.equal(result.exportCalls, 1);
  assert.equal(result.refreshCalls, 1);
  assert.equal(result.repairCalls, 1);
});

test("export가 H 갱신 성공을 확인하지 못하면 OK여도 뒤 H 갱신·수식 복구를 다시 수행한다", () => {
  const result = runScenario({ completed: true, cumulativeRefreshConfirmed: false });
  assert.equal(result.values.EXPORT_STATS_COLLECTION_GATE_LAST_STATUS, "OK");
  assert.equal(result.values.DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_DATE, undefined);
  assert.equal(result.refreshCalls, 2, "실패한 내부 시도 뒤 fallback H 갱신");
  assert.equal(result.repairCalls, 2, "marker가 없으므로 수식 범위도 보수적으로 재확인");
});

test("이전 target의 OK 표식은 오늘 H 갱신·수식 복구를 건너뛰지 않는다", () => {
  const values: Record<string, string> = {
    DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_DATE: "2026-11-14",
    EXPORT_STATS_COLLECTION_GATE_LAST_STATUS: "OK",
    EXPORT_STATS_COLLECTION_GATE_LAST_TARGET_DATE: "2026-11-14",
  };
  const helper = new Function(
    "DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_PROP_",
    `${fnSrc("dailyAutoExportMaintenanceCompleted_")}\nreturn dailyAutoExportMaintenanceCompleted_;`,
  )("DAILY_AUTO_EXPORT_MAINTENANCE_TARGET_DATE") as
    (props: { getProperty: (key: string) => string | null }, target: string) => boolean;
  assert.equal(helper({ getProperty: (key) => values[key] ?? null }, "2026-11-15"), false);
});
