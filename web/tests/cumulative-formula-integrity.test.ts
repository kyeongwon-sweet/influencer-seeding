import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const helper = readFileSync(new URL("../../apps-script/cumulative_formula_integrity.gs", import.meta.url), "utf8");
const main = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../../scripts/prepare_apps_script_deploy.mjs", import.meta.url), "utf8");

function fixture(options: { fail?: boolean; ignore?: boolean } = {}) {
  const cells = [
    { formula: '=IF(COUNT(P2:EE2)=0,"",MAX(P2:EE2))', value: 50 },
    { formula: "", value: 77 },
    { formula: '=IF(COUNT(P4:EF4)=0,"",MAX(P4:EF4))', value: 99 },
    { formula: '=""', value: "" },
  ];
  const values = cells.map(c => [c.value]);
  const formulas = cells.map(c => [c.formula]);
  const expected = [[formulas[0][0].replaceAll("EE", "EF")], ['=MAX(P3:EF3)'], [formulas[2][0]], ['=MAX(P5:EF5)']];
  let activeFilter: unknown = filter();
  let restored = 0;
  const writes: Array<{ row: number; value: string }> = [];
  function filter() {
    return {
      getRange: () => ({ getColumn: () => 1, getLastColumn: () => 140, getA1Notation: () => "A1:EF5000" }),
      getColumnFilterCriteria: (col: number) => col === 3 ? "team criterion" : null,
      remove: () => { activeFilter = null; },
    };
  }
  const sheet = {
    getLastRow: () => 5,
    getFilter: () => activeFilter,
    getRange: () => ({ createFilter: () => {
      activeFilter = filter();
      return { setColumnFilterCriteria: (col: number, criterion: string) => {
        assert.equal(col, 3); assert.equal(criterion, "team criterion"); restored++;
      } };
    } }),
    getRangeList: (addresses: string[]) => ({ setFormulaR1C1: (formula: string) => {
      assert.equal(formula, '=IF(COUNT(RC[8]:RC[128])=0,"",MAX(RC[8]:RC[128]))');
      assert.equal(activeFilter, null, "hidden rows must not be skipped");
      if (options.fail) throw new Error("write failed");
      addresses.forEach(address => {
        assert.match(address, /^H\d+$/);
        const row = Number(address.slice(1));
        const value = '=IF(COUNT(P' + row + ':EF' + row + ')=0,"",MAX(P' + row + ':EF' + row + '))';
        writes.push({ row, value });
        if (!options.ignore) cells[row - 2].formula = value;
      });
    } }),
  };
  const range = {
    getRow: () => 2, getColumn: () => 8,
    getValues: () => cells.map(c => [c.value]),
    getFormulas: () => cells.map(c => [c.formula]),
  };
  const context: Record<string, unknown> = {
    SpreadsheetApp: { flush: () => {} },
    withDocLock_: (fn: () => unknown) => fn(),
    standardCumulativeFormulaParts_: (formula: string) => {
      const match = formula.match(/^=IF\(COUNT\(([A-Z]+)\d+:([A-Z]+)\d+\)/);
      return match ? { firstLetter: match[1], endLetter: match[2] } : null;
    },
    metricColumnNumber_: (letter: string) => letter === "P" ? 16 : letter === "EF" ? 136 : 0,
    colLetter_: (col: number) => { assert.equal(col, 8); return "H"; },
    assertRowCountStable_: () => {},
  };
  runInNewContext(helper, context);
  const write = context.writeCumulativeFormulaChanges_ as (...args: unknown[]) => { written: number; verified: number };
  return { cells, writes, values, formulas, expected, sheet, range, restored: () => restored,
    hasFilter: () => activeFilter !== null, run: () => write(sheet, range, values, formulas, expected, 5) };
}

test("H refresh uses a differential verified writer, not an unverified whole-column overwrite", () => {
  const body = main.slice(main.indexOf("function refreshCumulativeViews()"), main.indexOf("function auditLinkedSheetFormulas_"));
  assert.match(body, /writeCumulativeFormulaChanges_\(sheet, range, values, formulas, out, lastRow\)/);
  assert.doesNotMatch(body, /range\.setValues\(out\)/);
  assert.match(deploy, /cumulative_formula_integrity\.gs/);
});

test("hidden stale H is repaired and manual / current / custom formulas are untouched", () => {
  const f = fixture(); const result = f.run();
  assert.equal(result.written, 1); assert.equal(result.verified, 1);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].row, 2);
  assert.equal(f.cells[1].value, 77); assert.equal(f.cells[1].formula, "");
  assert.equal(f.cells[3].formula, '=""');
  assert.equal(f.restored(), 1); assert.equal(f.hasFilter(), true);
});

test("idempotent current formulas do not cause any writes or filter changes", () => {
  const f = fixture(); f.formulas[0][0] = f.expected[0][0] as string; f.cells[0].formula = f.formulas[0][0];
  assert.equal(f.run().written, 0); assert.equal(f.writes.length, 0); assert.equal(f.restored(), 0);
});

test("filter criteria are restored even when a write throws", () => {
  const f = fixture({ fail: true });
  assert.throws(f.run, /write failed/); assert.equal(f.restored(), 1); assert.equal(f.hasFilter(), true);
});

test("a silently ignored write fails verification instead of logging OK", () => {
  const f = fixture({ ignore: true });
  assert.throws(f.run, /H_FORMULA_WRITE_FAILED/); assert.equal(f.hasFilter(), true);
});

test("concurrent H edits are detected before any writes", () => {
  const f = fixture(); f.cells[0].formula = "=123";
  assert.throws(f.run, /H_FORMULAS_CHANGED/); assert.equal(f.writes.length, 0);
});

test("a genuinely empty H cell can regain its generated formula", () => {
  const f = fixture();
  f.cells[0].formula = ""; f.cells[0].value = "";
  f.formulas[0][0] = ""; f.values[0][0] = "";
  assert.equal(f.run().verified, 1); assert.equal(f.cells[0].formula, f.expected[0][0]);
});

test("concurrent manual values are never overwritten", () => {
  const f = fixture(); f.cells[1].value = 78;
  assert.throws(f.run, /H_MANUAL_CHANGED/); assert.equal(f.writes.length, 0);
});

test("backup is verified in a separate spreadsheet before H writes, without new Drive permissions", () => {
  const body = helper.slice(helper.indexOf("function backupAndRefreshCumulativeFormulaIntegrity()"));
  assert.doesNotMatch(body, /DriveApp/);
  assert.match(body, /SpreadsheetApp\.create\(/);
  assert.ok(body.indexOf("H_BACKUP_VERIFY_FAILED") < body.indexOf("refreshCumulativeViews();"));
  assert.match(body, /verifyCumulativeSourceCells_\(before, after, hCol\)/);
});

test("source canary permits derived CPV recalculation but rejects input and formula edits", () => {
  const context: Record<string, unknown> = { CONFIG: { DATA_START_ROW: 2 }, standardCumulativeFormulaParts_: () => null };
  runInNewContext(helper, context);
  const verify = context.verifyCumulativeSourceCells_ as (...args: unknown[]) => void;
  const before = { lastRow: 2, values: [[50, 2, 50]], allFormulas: [['=MAX(C2)', '=100/A2', '']], iFormulas: [['']] };
  const after = { lastRow: 2, values: [[60, 1.6, 50]], allFormulas: [['=MAX(C2)', '=100/A2', '']], iFormulas: [['']] };
  assert.doesNotThrow(() => verify(before, after, 1));
  after.values[0][2] = 60;
  assert.throws(() => verify(before, after, 1), /non-H cell changed/);
  after.values[0][2] = 50; after.allFormulas[0][1] = '=200/A2';
  assert.throws(() => verify(before, after, 1), /non-H cell changed/);
});

test("the source canary preserves manual H even in a zero-write idempotent run", () => {
  const context: Record<string, unknown> = { CONFIG: { DATA_START_ROW: 2 }, standardCumulativeFormulaParts_: () => null };
  runInNewContext(helper, context);
  const verify = context.verifyCumulativeSourceCells_ as (...args: unknown[]) => void;
  const before = { lastRow: 2, values: [[77]], allFormulas: [['']], iFormulas: [['']] };
  const after = { lastRow: 2, values: [[77]], allFormulas: [['']], iFormulas: [['']] };
  assert.doesNotThrow(() => verify(before, after, 1));
  after.values[0][0] = 78;
  assert.throws(() => verify(before, after, 1), /manual or custom H changed/);
});

test("sparse H batches retain dynamic date bounds and never exceed 500 cells per call", () => {
  const calls: Array<{ addresses: string[]; formula: string }> = [];
  const context: Record<string, unknown> = {
    standardCumulativeFormulaParts_: () => ({ firstLetter: "P", endLetter: "EG" }),
    metricColumnNumber_: (letter: string) => letter === "P" ? 16 : 137,
    colLetter_: () => "H", assertRowCountStable_: () => {},
  };
  runInNewContext(helper, context);
  const batch = context.setCumulativeFormulaBatches_ as (...args: unknown[]) => number;
  const edits = Array.from({ length: 1201 }, (_, i) => ({ row: 2 + i * 2, value: "standard formula" }));
  const sheet = { getRangeList: (addresses: string[]) => ({ setFormulaR1C1: (formula: string) => calls.push({ addresses, formula }) }) };
  assert.equal(batch(sheet, 8, edits, 3000), 1201);
  assert.deepEqual(calls.map(call => call.addresses.length), [500, 500, 201]);
  assert.equal(calls[0].addresses[0], "H2"); assert.equal(calls[0].addresses[1], "H4");
  assert.equal(calls[2].addresses.at(-1), "H2402");
  assert.equal(calls[0].formula, '=IF(COUNT(RC[8]:RC[129])=0,"",MAX(RC[8]:RC[129]))');
});
