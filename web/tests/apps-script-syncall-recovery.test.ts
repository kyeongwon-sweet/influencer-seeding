// 2026-11-19 syncAll 시간초과 재발 방지:
// 등록상태 표식은 수집 시 비어 있던 행만, URL/행 안정성을 확인한 뒤 연속 구간으로 묶어 쓴다.

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

type RowRef = { row: number; key: string };
type Write = { row: number; col: number; numRows: number; numCols: number; values: unknown[][] };

test("collectRows_: syncAll 대상 전체와 별개로 등록상태가 빈 행 참조만 분리한다", () => {
  const rows = [
    ["2026-11-18", "ig:a", "account-a", "협찬", "P말", "P말", 100],
    ["2026-11-18", "ig:b", "account-b", "협찬", "P말", "P말", 200],
    ["2026-11-18", "ig:a", "account-a-dup", "협찬", "P말", "P말", 100],
  ];
  rows[0][19] = "";
  rows[1][19] = "✅ 2026-11-01 09:00";
  rows[2][19] = "";
  const collect = new Function(
    "CONFIG", "getSheet_", "buildFieldCols_", "getStatusCol_", "todayStr_",
    "readSelectedColumns_", "fieldColList_", "classifySheetSyncUrl_", "toDateStr_",
    "toNumber_", "linkKey_",
    `${fnSrc("collectRows_")}\nreturn collectRows_;`,
  )(
    { DATA_START_ROW: 2 },
    () => ({ getLastRow: () => 4 }),
    () => ({ posted_at: 1, url: 2, account_name: 3, channel_type: 4, project_name: 5, product_name: 6, cost: 7 }),
    () => 20,
    () => "2026-11-19",
    () => rows,
    () => [1, 2, 3, 4, 5, 6, 7],
    (url: string) => ({ valid: true, url, changed: false }),
    (value: unknown) => String(value || ""),
    (value: unknown) => Number(value || 0),
    (url: string) => url,
  ) as (onlyNew: boolean) => { rowRefs: RowRef[]; unregisteredRowRefs: RowRef[] };

  const all = collect(false);
  assert.deepEqual(all.rowRefs, [
    { row: 2, key: "ig:a" },
    { row: 3, key: "ig:b" },
    { row: 4, key: "ig:a" },
  ]);
  assert.deepEqual(all.unregisteredRowRefs, [
    { row: 2, key: "ig:a" },
    { row: 4, key: "ig:a" },
  ]);
});

function runMarkRegistered_(opts: {
  refs: RowRef[];
  urls?: Record<number, string>;
  actualLastRow?: number;
  expectedLastRow?: number;
}) {
  const writes: Write[] = [];
  let lastRowReads = 0;
  const actualLastRow = opts.actualLastRow ?? 6;
  const expectedLastRow = opts.expectedLastRow ?? 6;
  const urls = opts.urls ?? {};
  const sheet = {
    getLastRow: () => { lastRowReads += 1; return actualLastRow; },
    getRange: (row: number, col: number, numRows?: number, numCols?: number) => {
      if (col === 2 && numRows == null) return { getValue: () => urls[row] ?? "" };
      return {
        setValues: (values: unknown[][]) => {
          writes.push({ row, col, numRows: numRows ?? 1, numCols: numCols ?? 1, values });
        },
      };
    },
  };
  const source = [
    fnSrc("assertRowCountStable_"),
    fnSrc("writeColumnRuns_"),
    fnSrc("assertSyncRowsStable_"),
    fnSrc("markRegistered_"),
  ].join("\n");
  const mark = new Function(
    "CONFIG", "Utilities", "Session", "buildFieldCols_", "linkKey_",
    `${source}\nreturn markRegistered_;`,
  )(
    { DATA_START_ROW: 2 },
    { formatDate: () => "2026-11-19 09:30" },
    { getScriptTimeZone: () => "Asia/Seoul" },
    () => ({ url: 2 }),
    (value: unknown) => String(value || ""),
  ) as (sheet: object, statusCol: number, refs: RowRef[], expectedLastRow: number) => number;

  return {
    invoke: () => mark(sheet, 20, opts.refs, expectedLastRow),
    writes,
    lastRowReads: () => lastRowReads,
  };
}

test("markRegistered_: 비어 있던 행 참조만 쓰고 연속/비연속 행을 각각 한 번씩 묶는다", () => {
  const run = runMarkRegistered_({
    // 4행은 이미 등록된 행이라 collectRows_가 refs에 넣지 않았다고 가정한다.
    refs: [
      { row: 2, key: "ig:a" },
      { row: 3, key: "ig:b" },
      { row: 5, key: "ig:c" },
      { row: 5, key: "ig:c" }, // 중복 참조도 한 칸만 쓴다.
    ],
    urls: { 2: "ig:a", 3: "ig:b", 4: "ig:registered", 5: "ig:c" },
  });

  assert.equal(run.invoke(), 3);
  assert.deepEqual(run.writes.map((w) => [w.row, w.numRows]), [[2, 2], [5, 1]]);
  assert.deepEqual(run.writes.flatMap((w) => w.values).map((v) => v[0]), [
    "✅ 2026-11-19 09:30",
    "✅ 2026-11-19 09:30",
    "✅ 2026-11-19 09:30",
  ]);
  assert.equal(run.writes.some((w) => w.row <= 4 && 4 < w.row + w.numRows), false, "이미 등록된 4행은 쓰지 않음");
});

test("markRegistered_: 이미 모두 등록되어 빈 참조면 시트 접근과 쓰기가 0건이다", () => {
  const run = runMarkRegistered_({ refs: [], actualLastRow: 999, expectedLastRow: 6 });
  assert.equal(run.invoke(), 0);
  assert.equal(run.lastRowReads(), 0);
  assert.deepEqual(run.writes, []);
});

test("markRegistered_: 실행 중 행 수가 바뀌면 상태를 한 칸도 쓰지 않는다", () => {
  const run = runMarkRegistered_({
    refs: [{ row: 2, key: "ig:a" }],
    urls: { 2: "ig:a" },
    actualLastRow: 7,
    expectedLastRow: 6,
  });
  assert.throws(run.invoke, /실행 중 행 수가 6 → 7로 변경/);
  assert.deepEqual(run.writes, []);
});

test("markRegistered_: URL 키가 바뀌면 상태를 한 칸도 쓰지 않는다", () => {
  const run = runMarkRegistered_({
    refs: [{ row: 2, key: "ig:a" }, { row: 3, key: "ig:b" }],
    urls: { 2: "ig:a", 3: "ig:someone-else" },
  });
  assert.throws(run.invoke, /신규 등록 중 행 위치가 바뀌었습니다/);
  assert.deepEqual(run.writes, []);
});
