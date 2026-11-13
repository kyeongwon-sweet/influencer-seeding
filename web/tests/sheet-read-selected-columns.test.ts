import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-13 "연동 시트 너무 느려" — 메타데이터 몇 칸만 쓰는 함수들이 A:GL 전체(약 106만 셀)를 읽던 병목 제거.

const gs = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");

function fnBody(name: string): string {
  const start = gs.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} 없음`);
  const next = gs.indexOf("\nfunction ", start + 10);
  return gs.slice(start, next === -1 ? undefined : next);
}

const helpers = Function(
  fnBody("readSelectedColumns_(") + fnBody("fieldColList_(") + "; return { readSelectedColumns_, fieldColList_ };",
)() as {
  readSelectedColumns_: (sheet: unknown, startRow: number, numRows: number, cols: unknown[]) => unknown[][];
  fieldColList_: (fieldCols: Record<string, number>, fields?: string[]) => number[];
};

// 가짜 시트: grid[r][c] (1-based 좌표), 읽은 범위를 기록한다.
function fakeSheet(rows: number, cols: number) {
  const reads: Array<[number, number, number, number]> = [];
  const val = (r: number, c: number) => `r${r}c${c}`;
  return {
    reads,
    val,
    getRange(row: number, col: number, nr: number, nc: number) {
      reads.push([row, col, nr, nc]);
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const r = row + i, c = col + j;
          return r <= rows && c <= cols ? val(r, c) : "";
        })),
      };
    },
  };
}

test("필요한 열만 읽고, row[col-1] 접근은 원래 전체 읽기와 같은 값", () => {
  const sheet = fakeSheet(10, 194);
  const cols = [2, 3, 4, 5, 9, 194];           // 메타 몇 칸 + 맨 오른쪽 등록상태
  const out = helpers.readSelectedColumns_(sheet, 2, 9, cols);
  assert.equal(out.length, 9);
  for (let i = 0; i < 9; i++) for (const c of cols) assert.equal(out[i][c - 1], sheet.val(2 + i, c));
  const cells = sheet.reads.reduce((s, [, , nr, nc]) => s + nr * nc, 0);
  assert.ok(cells <= 9 * 9, `읽은 셀 ${cells} — 날짜열을 읽으면 안 됨`);
  assert.ok(!sheet.reads.some(([, c, , nc]) => c <= 100 && c + nc - 1 >= 100), "중간 날짜열(100) 미포함");
});

test("가까운 열은 묶어 읽고(호출 수↓), 먼 열은 따로", () => {
  const sheet = fakeSheet(5, 194);
  helpers.readSelectedColumns_(sheet, 2, 4, [2, 3, 5, 7, 194]);
  assert.deepEqual(sheet.reads.map(([, c, , nc]) => [c, nc]), [[2, 6], [194, 1]]);
});

test("빈 목록·없는 열(undefined)·0행은 안전", () => {
  const sheet = fakeSheet(5, 20);
  assert.deepEqual(helpers.readSelectedColumns_(sheet, 2, 0, [2]), []);
  assert.deepEqual(helpers.readSelectedColumns_(sheet, 2, 2, [undefined, 0, null]), [[], []]);
  assert.equal(sheet.reads.length, 0);
  assert.deepEqual(helpers.fieldColList_({ url: 2, cost: 7 }, ["url", "missing", "cost"]), [2, 7]);
});

test("🔒 자주 도는 6개 함수는 전체 너비로 읽지 않는다", () => {
  const full = /getRange\(CONFIG\.DATA_START_ROW,\s*1,\s*[^,]+,\s*(sheet\.getLastColumn\(\)|lastCol)\)\s*\.getValues\(\)/;
  for (const name of [
    "collectRows_(", "scanBlanks_(", "pullFromDB(", "fillExistingMetadataFromDB_(", "syncPricing(", "auditCreatorAssetIntegrity_(",
  ]) {
    const body = fnBody(name);
    assert.doesNotMatch(body.replace(/\n\s*\./g, "."), full, `${name} 전체 너비 읽기`);
    assert.match(body, /readSelectedColumns_\(/, `${name} 는 필요한 열만 읽어야 함`);
  }
});

test("🔒 collectRows_ 는 등록상태 열(날짜열 오른쪽 끝)을 반드시 함께 읽는다 — 빠지면 전 행이 '신규'", () => {
  const body = fnBody("collectRows_(");
  assert.match(body, /readSelectedColumns_\([\s\S]*?\.concat\(\[statusCol\]\)/);
  assert.match(body, /const status = String\(row\[statusCol - 1\]/);
});
