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
  for (let i = brace; i < gs.length; i++) {
    if (gs[i] === "{") depth++;
    if (gs[i] === "}" && --depth === 0) return gs.slice(start, i + 1);
  }
  throw new Error(`${name} is unterminated`);
}

function runCapacity(maxRows: number, requiredLastRow: number) {
  const inserts: Array<[number, number]> = [];
  let current = maxRows;
  const source = functionSource("ensureLinkedAppendRowCapacity_");
  const fn = new Function("Logger", `${source}; return ensureLinkedAppendRowCapacity_;`)({ log: () => {} });
  const sheet = {
    getMaxRows: () => current,
    insertRowsAfter: (after: number, count: number) => {
      inserts.push([after, count]);
      current += count;
    },
  };
  return { result: fn(sheet, requiredLastRow), inserts, maxRows: () => current };
}

test("신규 행이 현재 격자 안이면 행을 추가하지 않는다", () => {
  const r = runCapacity(5769, 5475);
  assert.deepEqual(r.result, { inserted: 0, max_rows: 5769 });
  assert.deepEqual(r.inserts, []);
});

test("신규 행이 격자 끝을 넘으면 필요한 행 + 100행 여유만 추가한다", () => {
  const r = runCapacity(5769, 5772);
  assert.deepEqual(r.inserts, [[5769, 103]]);
  assert.deepEqual(r.result, { inserted: 103, max_rows: 5872 });
  assert.equal(r.maxRows(), 5872);
});

test("pullFromDB는 신규행 범위를 만들기 전에 격자 용량을 보장한다", () => {
  const pull = functionSource("pullFromDB");
  const ensureAt = pull.indexOf("ensureLinkedAppendRowCapacity_(sheet, appendBaseRow + rowsToAppend.length)");
  const rangeAt = pull.indexOf("sheet.getRange(startRow, 1, rowsToAppend.length, lastCol)");
  assert.ok(ensureAt >= 0 && ensureAt < rangeAt);
});
