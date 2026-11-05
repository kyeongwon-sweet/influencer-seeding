// 아침 dailyAuto가 30분 실행 한도에 걸리지 않게(2026-11-05 근본 수정).
// - 10-31·11-05: exportStats(15~22분) 뒤 나머지 6단계(약 9분)를 같은 실행창에서 돌다 시간 초과.
// - exportStats가 칸 하나만 바뀌어도 날짜열 그룹 전체(5,269행×170열≈90만 칸)를 매일 다시 썼다.
// - 09:04 DB→시트 동기화가 단계 사이에 끼어 락을 잡아 다음 단계가 SHEET_LOCKED(11-01).
// 실제 함수를 가짜 시트·트리거·프로퍼티로 그대로 돌린다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appsScript = readFileSync(join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"), "utf8").replace(/\r\n/g, "\n");
const fnSrc = (name: string) => {
  const start = appsScript.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 없음`);
  return appsScript.slice(start, appsScript.indexOf("\n}\n", start) + 3);
};
const constSrc = (name: string) => {
  const m = appsScript.match(new RegExp(`const ${name} = [^\\n]+\\n`));
  assert.ok(m, `${name} 없음`);
  return m[0];
};

// ── 1) exportStats: 바뀐 칸만 쓴다 ──
type Rect = { biStart: number; biEnd: number; rowStart: number; rowEnd: number };
const changedRects = new Function(`${fnSrc("exportStatsChangedRects_")}\nreturn exportStatsChangedRects_;`)() as
  (before: unknown[][], after: unknown[][], startBi: number, width: number) => Rect[];

const grid = (rows: number, cols: number, fill: (r: number, c: number) => unknown = () => "") =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => fill(r, c)));

test("🚨 새 날짜열 하나만 바뀌면 그 열의 첫~끝 바뀐 행만 쓴다(그룹 전체 아님)", () => {
  const before = grid(5000, 170, (r, c) => (c < 169 ? r * 10 + c : ""));
  const after = before.map((row) => row.slice());
  after[3][169] = 111;
  after[4800][169] = 222;
  assert.deepEqual(changedRects(before, after, 0, 170), [{ biStart: 169, biEnd: 169, rowStart: 3, rowEnd: 4800 }]);
});

test("붙어 있는 바뀐 열은 하나로, 떨어진 열은 따로 묶는다", () => {
  const before = grid(10, 8);
  const after = before.map((row) => row.slice());
  after[2][1] = 1; after[5][2] = 2; after[7][6] = 3;
  assert.deepEqual(changedRects(before, after, 0, 8), [
    { biStart: 1, biEnd: 2, rowStart: 2, rowEnd: 5 },
    { biStart: 6, biEnd: 6, rowStart: 7, rowEnd: 7 },
  ]);
});

test("바뀐 게 없으면 아무것도 안 쓰고, 같은 시각의 Date는 안 바뀐 것으로 본다", () => {
  const before = grid(4, 3, () => new Date(2026, 10, 4));
  const after = grid(4, 3, () => new Date(2026, 10, 4));
  assert.deepEqual(changedRects(before, after, 0, 3), []);
});

test("직사각형만 덮어써도 결과는 그룹 전체를 쓴 것과 똑같다(무작위 200회)", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 200; k++) {
    const rows = 1 + Math.floor(rand() * 30), cols = 1 + Math.floor(rand() * 12);
    const before = grid(rows, cols, () => (rand() < 0.5 ? "" : Math.floor(rand() * 5)));
    const after = before.map((row) => row.map((v) => (rand() < 0.08 ? Math.floor(rand() * 5) : v)));
    const sheet = before.map((row) => row.slice());
    for (const r of changedRects(before, after, 0, cols)) {
      for (let i = r.rowStart; i <= r.rowEnd; i++) for (let j = r.biStart; j <= r.biEnd; j++) sheet[i][j] = after[i][j];
    }
    assert.deepEqual(sheet, after);
  }
});

// ── 2) 이어서 돌기: export는 자기 실행창, 20분 넘게 쓴 창에선 다음 단계를 새 창으로 ──
function runContinuation(stages: string[], stageMinutes: Record<string, number>, nextIndex = 0) {
  const props: Record<string, string> = {
    DAILY_AUTO_CONTINUATION_PENDING_JSON: JSON.stringify({ stages, next_index: nextIndex, completed_stages: [], attempt: 0 }),
  };
  let clock = Date.UTC(2026, 10, 4, 23, 40);
  class FakeDate extends Date {
    constructor(...a: unknown[]) { super(...((a.length ? a : [clock]) as [number])); }
    static now() { return clock; }
  }
  const ran: string[] = [];
  const enqueued: number[] = [];
  const src = [
    constSrc("DAILY_AUTO_CONTINUATION_PROP_"),
    constSrc("DAILY_AUTO_OWN_WINDOW_STAGES_"),
    constSrc("DAILY_AUTO_STAGE_START_BUDGET_MS_"),
    fnSrc("parseDailyAutoContinuation_"),
    fnSrc("mergeDailyAutoStages_"),
    fnSrc("saveDailyAutoContinuation_"),
    fnSrc("dailyAutoContinuation_"),
  ].join("\n");
  const run = new Function(
    "Date", "withAutoWriteGuard_", "PropertiesService", "removeDailyAutoContinuationTriggers_",
    "scheduleDailyAutoContinuationWatchdog_", "enqueueDailyAutoContinuation_", "dailyAutoStageDefs_",
    "runDailyAutoStage_", "scheduleDailyAutoRetry_", "collectionTargetDate_", "Logger",
    "DAILY_AUTO_CONTINUATION_DELAY_MS_", "DAILY_AUTO_IMPORT_RETRY_AFTER_EXPORT_PROP_",
    `${src}\nreturn dailyAutoContinuation_;`,
  )(
    FakeDate,
    (fn: () => unknown) => fn(),
    {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
        setProperty: (k: string, v: string) => { props[k] = v; },
        setProperties: (o: Record<string, string>) => Object.assign(props, o),
        deleteProperty: (k: string) => { delete props[k]; },
      }),
    },
    () => {},
    () => {},
    (pending: object) => { props.DAILY_AUTO_CONTINUATION_PENDING_JSON = JSON.stringify(pending); enqueued.push(1); return true; },
    () => stages.map((name) => [name, () => true]),
    (name: string) => { ran.push(name); clock += (stageMinutes[name] ?? 1) * 60 * 1000; return { name, status: "OK", duration_ms: 0 }; },
    () => [],
    () => "2026-11-04",
    { log: () => {} },
    60 * 1000,
    "DAILY_AUTO_IMPORT_RETRY_AFTER_EXPORT",
  ) as () => boolean;
  run();
  const pending = props.DAILY_AUTO_CONTINUATION_PENDING_JSON ? JSON.parse(props.DAILY_AUTO_CONTINUATION_PENDING_JSON) : null;
  return { ran, enqueued: enqueued.length, pending, status: props.DAILY_AUTO_LAST_STATUS };
}

const AFTER_IMPORT = ["exportStats", "syncStatus", "refreshCumulativeViews", "repairMetricFormulaRanges", "syncCreators"];

test("🚨 exportStats가 끝나면 남은 단계는 새 30분 실행창으로 넘긴다", () => {
  const r = runContinuation(AFTER_IMPORT, { exportStats: 15 });
  assert.deepEqual(r.ran, ["exportStats"]);
  assert.equal(r.enqueued, 1);
  assert.equal(r.pending.next_index, 1);
  assert.equal(r.status, "STAGE_CONTINUATION_SCHEDULED");
});

test("다음 창: 나머지 단계를 이어서 돌고 끝낸다", () => {
  const r = runContinuation(AFTER_IMPORT, { syncStatus: 2, refreshCumulativeViews: 2 }, 1);
  assert.deepEqual(r.ran, ["syncStatus", "refreshCumulativeViews", "repairMetricFormulaRanges", "syncCreators"]);
  assert.equal(r.enqueued, 0);
  assert.equal(r.pending, null, "다 끝나면 이어서 돌기 표식을 지운다");
});

test("한 창에서 20분 넘게 썼으면 다음 단계는 시작하지 않고 새 창으로 넘긴다", () => {
  const r = runContinuation(AFTER_IMPORT, { syncStatus: 12, refreshCumulativeViews: 9, repairMetricFormulaRanges: 5 }, 1);
  assert.deepEqual(r.ran, ["syncStatus", "refreshCumulativeViews"]);
  assert.equal(r.enqueued, 1);
  assert.equal(r.pending.next_index, 3);
});

test("창의 첫 단계는 시간과 관계없이 시작한다(무한 넘기기 방지)", () => {
  const r = runContinuation(["syncStatus", "syncCreators"], { syncStatus: 25 }, 0);
  assert.deepEqual(r.ran, ["syncStatus"]);
  assert.equal(r.pending.next_index, 1);
});

test("importStats 뒤 넘기기는 예전과 같다", () => {
  const r = runContinuation(["importStats", ...AFTER_IMPORT], { importStats: 10 });
  assert.deepEqual(r.ran, ["importStats"]);
  assert.equal(r.status, "EXPORT_CONTINUATION_SCHEDULED");
});

// ── 3) DB→시트 동기화는 아침 dailyAuto가 도는 동안 비켜 간다 ──
const busy = new Function(
  "DAILY_AUTO_CONTINUATION_PROP_",
  `${constSrc("DAILY_AUTO_BUSY_MAX_MS_")}\n${fnSrc("isDailyAutoBusy_")}\nreturn isDailyAutoBusy_;`,
)("DAILY_AUTO_CONTINUATION_PENDING_JSON") as (props: { getProperty: (k: string) => string | null }, now: number) => boolean;
const propsOf = (o: Record<string, string>) => ({ getProperty: (k: string) => o[k] ?? null });
const NOW = Date.UTC(2026, 10, 5, 0, 4);
const minAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

test("🚨 dailyAuto가 이어서 도는 중이면 동기화는 비켜 간다", () => {
  assert.equal(busy(propsOf({ DAILY_AUTO_LAST_STARTED_AT: minAgo(36), DAILY_AUTO_LAST_STATUS: "STAGE_CONTINUATION_SCHEDULED", DAILY_AUTO_CONTINUATION_PENDING_JSON: "{}" }), NOW), true);
  assert.equal(busy(propsOf({ DAILY_AUTO_LAST_STARTED_AT: minAgo(5), DAILY_AUTO_LAST_STATUS: "RUNNING" }), NOW), true);
});

test("dailyAuto가 끝났거나 2시간 30분 넘게 지난 흔적이면 비켜 가지 않는다", () => {
  assert.equal(busy(propsOf({ DAILY_AUTO_LAST_STARTED_AT: minAgo(60), DAILY_AUTO_LAST_STATUS: "OK" }), NOW), false);
  assert.equal(busy(propsOf({ DAILY_AUTO_LAST_STARTED_AT: minAgo(200), DAILY_AUTO_LAST_STATUS: "RUNNING", DAILY_AUTO_CONTINUATION_PENDING_JSON: "{}" }), NOW), false);
  assert.equal(busy(propsOf({}), NOW), false);
});

test("정기 동기화만 비켜 가고 수동 실행은 바로 돈다", () => {
  const body = fnSrc("runDbPullSyncAttempt_");
  assert.match(body, /if \(source !== "manual" && isDailyAutoBusy_\(PropertiesService\.getScriptProperties\(\), Date\.now\(\)\)\) \{\s*return handleDbPullSyncLockBusy_\(/);
});
