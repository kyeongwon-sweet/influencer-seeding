import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const gs = readFileSync(join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"), "utf8").replace(/\r\n/g, "\n");

function functionSource(name: string): string {
  const start = gs.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const brace = gs.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < gs.length; i++) {
    const ch = gs[i];
    const next = gs[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return gs.slice(start, i + 1);
  }
  throw new Error(`${name} is unterminated`);
}

type Criterion = { name: string };

function fakeSheet(options: {
  startRow?: number;
  startCol?: number;
  numRows?: number;
  numCols?: number;
  lastRow?: number;
  criteria?: Record<number, Criterion>;
  failExtendedOnce?: boolean;
  noFilter?: boolean;
}) {
  const calls = { removed: 0, created: [] as Array<{ row: number; col: number; numRows: number; numCols: number }>, flushed: 0 };
  let failExtendedOnce = !!options.failExtendedOnce;
  let activeFilter: any = null;

  const makeFilter = (row: number, col: number, numRows: number, numCols: number, criteria: Record<number, Criterion>) => ({
    getRange: () => ({
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      getLastRow: () => row + numRows - 1,
      getLastColumn: () => col + numCols - 1,
    }),
    getColumnFilterCriteria: (position: number) => criteria[position] || null,
    setColumnFilterCriteria: (position: number, criterion: Criterion) => {
      criteria[position] = criterion;
      return activeFilter;
    },
    remove: () => {
      calls.removed++;
      activeFilter = null;
    },
  });

  const startRow = options.startRow ?? 1;
  const startCol = options.startCol ?? 1;
  const numRows = options.numRows ?? 5;
  const numCols = options.numCols ?? 4;
  const oldCriteria = { ...(options.criteria || {}) };
  if (!options.noFilter) activeFilter = makeFilter(startRow, startCol, numRows, numCols, oldCriteria);

  const sheet = {
    getFilter: () => activeFilter,
    getLastRow: () => options.lastRow ?? startRow + numRows - 1,
    getRange: (row: number, col: number, nextNumRows: number, nextNumCols: number) => ({
      createFilter: () => {
        calls.created.push({ row, col, numRows: nextNumRows, numCols: nextNumCols });
        const nextLastRow = row + nextNumRows - 1;
        const oldLastRow = startRow + numRows - 1;
        if (failExtendedOnce && nextLastRow > oldLastRow) {
          failExtendedOnce = false;
          throw new Error("simulated extended filter failure");
        }
        activeFilter = makeFilter(row, col, nextNumRows, nextNumCols, {});
        return activeFilter;
      },
    }),
  };
  return { sheet, calls, getActiveFilter: () => activeFilter };
}

function filterHelpers(flushCounter: { count: number }, logs: string[]) {
  const source = [
    functionSource("linkedBasicFilterState_"),
    functionSource("restoreLinkedBasicFilter_"),
    functionSource("extendLinkedBasicFilterToLastRow_"),
  ].join("\n");
  return new Function(
    "SpreadsheetApp",
    "Logger",
    `${source}; return { linkedBasicFilterState_, restoreLinkedBasicFilter_, extendLinkedBasicFilterToLastRow_ };`,
  )(
    { flush: () => { flushCounter.count++; } },
    { log: (message: string) => logs.push(message) },
  );
}

test("공유 기본 필터는 조건·시작점·너비를 보존하고 마지막 데이터 행까지만 늘린다", () => {
  const c2 = { name: "channel" };
  const c5 = { name: "status" };
  const state = fakeSheet({ startRow: 1, startCol: 2, numRows: 5414, numCols: 4, lastRow: 5462, criteria: { 2: c2, 5: c5 } });
  const flush = { count: 0 };
  const logs: string[] = [];
  const { extendLinkedBasicFilterToLastRow_ } = filterHelpers(flush, logs);

  const result = extendLinkedBasicFilterToLastRow_(state.sheet);

  assert.deepEqual(result, { extended: true, old_last_row: 5414, new_last_row: 5462 });
  assert.equal(state.calls.removed, 1);
  assert.deepEqual(state.calls.created, [{ row: 1, col: 2, numRows: 5462, numCols: 4 }]);
  assert.equal(state.getActiveFilter().getColumnFilterCriteria(2), c2);
  assert.equal(state.getActiveFilter().getColumnFilterCriteria(5), c5);
  assert.match(logs[0], /"status":"OK"/);
  assert.ok(flush.count >= 2);
});

test("필터가 없거나 이미 최신 행을 포함하면 제거·재생성하지 않고 절대 줄이지 않는다", () => {
  for (const options of [
    { noFilter: true, lastRow: 10 },
    { numRows: 20, lastRow: 15 },
    { numRows: 20, lastRow: 20 },
  ]) {
    const state = fakeSheet(options);
    const { extendLinkedBasicFilterToLastRow_ } = filterHelpers({ count: 0 }, []);
    const result = extendLinkedBasicFilterToLastRow_(state.sheet);
    assert.equal(result.extended, false);
    assert.equal(state.calls.removed, 0);
    assert.equal(state.calls.created.length, 0);
  }
});

test("확장 생성이 실패하면 기존 범위·조건으로 복구하고 동기화 자체는 계속한다", () => {
  const criterion = { name: "url" };
  const state = fakeSheet({ numRows: 5, lastRow: 8, criteria: { 1: criterion }, failExtendedOnce: true });
  const logs: string[] = [];
  const { extendLinkedBasicFilterToLastRow_ } = filterHelpers({ count: 0 }, logs);

  const result = extendLinkedBasicFilterToLastRow_(state.sheet);

  assert.equal(result.extended, false);
  assert.equal(result.reason, "ERROR_ROLLED_BACK");
  assert.deepEqual(state.calls.created, [
    { row: 1, col: 1, numRows: 8, numCols: 4 },
    { row: 1, col: 1, numRows: 5, numCols: 4 },
  ]);
  assert.equal(state.getActiveFilter().getRange().getLastRow(), 5);
  assert.equal(state.getActiveFilter().getColumnFilterCriteria(1), criterion);
  assert.match(logs[0], /ERROR_ROLLED_BACK/);
});

test("syncNew·pullFromDB·I열 수식 복원이 필터 끝 행을 자동 확장하도록 배선돼 있다", () => {
  const runSync = functionSource("runSync_");
  const pull = functionSource("pullFromDB");
  const formulaWrite = functionSource("setColumnFormulasWithFilterRestore_");

  assert.ok(runSync.indexOf("extendLinkedBasicFilterToLastRow_(sheet)") < runSync.indexOf("collectRows_(onlyNew)"));
  assert.ok(runSync.indexOf("extendLinkedBasicFilterToLastRow_(sheet)") < runSync.indexOf("if (rows.length === 0)"));
  assert.ok(pull.lastIndexOf("extendLinkedBasicFilterToLastRow_(sheet)") > pull.indexOf("applyLinkedInputValidationsToRows_"));
  assert.ok(pull.lastIndexOf("extendLinkedBasicFilterToLastRow_(sheet)") < pull.indexOf('lap("append")'));
  assert.match(formulaWrite, /restoreLinkedBasicFilter_\(sheet, filterState, sheet\.getLastRow\(\)\)/);
  assert.doesNotMatch(formulaWrite, /filterState\.rangeA1/);
});
