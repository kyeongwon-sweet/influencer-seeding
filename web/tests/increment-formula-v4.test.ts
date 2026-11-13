import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditRows, expectedIncrementFormula, legacyIncrementFormulaV3, type SheetAuditRow } from "../lib/formula-audit.ts";

// 2026-11-13 사용자 "연동 시트가 너무 느려" — I열 증분 수식을 배열 없는 V4로 교체.
// 지킬 것: ① Apps Script 생성기 == 감사 기대식(글자 단위) ② V4 값 == V3 값 ③ 이행 기간 V3도 정상 판정.

const appsScript = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");
const helperStart = appsScript.indexOf("function metricCumulativeFormula_(");
const helperEnd = appsScript.indexOf("function repairStaleMetricFormulaRanges_", helperStart);
const gs = Function(
  appsScript.slice(helperStart, helperEnd)
    + "; return { metricIncrementFormula_, legacyIncrementFormulaV3_, standardIncrementFormulaParts_ };",
)() as {
  metricIncrementFormula_: (row: number, f: string, l: string, t?: string) => string;
  legacyIncrementFormulaV3_: (row: number, f: string, l: string, t?: string) => string;
  standardIncrementFormulaParts_: (formula: string, row: number, first?: string) => unknown;
};

test("🔒 Apps Script V4 생성기와 감사 기대식이 글자까지 같다(어긋나면 매일 전량 '수식형태 오류')", () => {
  const cases: Array<[number, string, string, string]> = [
    [2, "P", "GK", "GJ"], [5462, "P", "GK", "GK"], [10, "Q", "DU", "DT"], [7, "P", "Z", "P"], [9, "Y", "AB", "AA"],
  ];
  for (const [row, first, last, target] of cases) {
    assert.equal(
      gs.metricIncrementFormula_(row, first, last, target),
      expectedIncrementFormula(row, { firstColumn: first, lastColumn: last, targetColumn: target }),
      `${row} ${first}:${last} → ${target}`,
    );
    assert.equal(
      gs.legacyIncrementFormulaV3_(row, first, last, target),
      legacyIncrementFormulaV3(row, { firstColumn: first, lastColumn: last, targetColumn: target }),
    );
  }
});

test("🔒 V4 생성기에는 배열 계산(LET·SEQUENCE·FILTER)이 없다", () => {
  const f = gs.metricIncrementFormula_(5462, "P", "GK", "GJ");
  assert.doesNotMatch(f, /LET\(|SEQUENCE|FILTER/);
  assert.equal(f, '=IFERROR(IF($GJ5462>0,IF(MAX($P5462:$GI5462)>0,MAX(0,$GJ5462-MAX($P5462:$GI5462)),$GJ5462),""),"")');
});

// ── 값 동등성: 두 수식의 Sheets 의미를 그대로 옮긴 참조 구현으로 대조한다 ──
type Cell = number | string | null; // null=공란, string=글자
const gt0 = (v: Cell) => (typeof v === "string" ? true : typeof v === "number" ? v > 0 : false); // Sheets: 글자 > 숫자
const sheetsMax = (xs: Cell[]) => { const n = xs.filter((x): x is number => typeof x === "number"); return n.length ? Math.max(...n) : 0; };

function evalV3(cells: Cell[], t: number): number | "" {
  const tv = cells[t];
  const prevMax = sheetsMax(cells.slice(0, t).filter(gt0));          // FILTER(rng, cols<targetC, rng>0) → MAX
  if (!gt0(tv)) return "";
  if (typeof tv !== "number") return ""; // 글자 target은 두 식 모두 같은 분기(이 무작위 표본엔 글자 없음)
  return prevMax > 0 ? Math.max(0, tv - prevMax) : tv;
}
function evalV4(cells: Cell[], t: number): number | "" {
  const tv = cells[t];
  if (!gt0(tv)) return "";
  const prevMax = sheetsMax(cells.slice(0, t));                        // MAX(첫칸:직전칸)
  if (typeof tv !== "number") return "";
  return prevMax > 0 ? Math.max(0, tv - prevMax) : tv;
}

test("V4 값 == V3 값 (공란·0·음수·감소·첫 측정·target 미측정 무작위 2만 행)", () => {
  let seed = 20261113;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 20000; k++) {
    const width = 1 + Math.floor(rnd() * 12);
    const cells: Cell[] = Array.from({ length: width }, () => {
      const r = rnd();
      if (r < 0.3) return null;
      if (r < 0.38) return 0;
      if (r < 0.4) return -5;
      return Math.floor(rnd() * 100000);
    });
    const t = Math.floor(rnd() * width);
    assert.equal(evalV4(cells, t), evalV3(cells, t), JSON.stringify({ cells, t }));
  }
});

const RANGE = { firstColumn: "P", lastColumn: "DJ", targetColumn: "DI" };
function row(partial: Partial<SheetAuditRow> & { key: string }): SheetAuditRow {
  return { label: partial.key, h: null, inc: null, metricRange: RANGE, dates: [], ...partial } as SheetAuditRow;
}

test("감사: V4 정상, 이행 기간 V3도 정상, target 다른 V4는 오류", () => {
  const ok4 = row({ key: "ig:v4", sourceRow: 10, incFormula: expectedIncrementFormula(10, RANGE) });
  const ok3 = row({ key: "ig:v3", sourceRow: 11, incFormula: legacyIncrementFormulaV3(11, RANGE) });
  const bad = row({ key: "ig:v4-wrong-target", sourceRow: 12, incFormula: expectedIncrementFormula(12, { ...RANGE, targetColumn: "DH" }) });
  const r = auditRows([ok4, ok3, bad], new Map(), "2026-11-13");
  assert.equal(r.formulaShape.incInvalid, 1);
});

test("Apps Script 파서: V4·V3 모두 표준으로 인식, 수기·다른 식은 아님", () => {
  assert.deepEqual(gs.standardIncrementFormulaParts_(gs.metricIncrementFormula_(4, "P", "GK", "GJ"), 4),
    { firstLetter: "P", endLetter: "GJ", targetLetter: "GJ", legacy: false });
  assert.equal(gs.standardIncrementFormulaParts_(gs.metricIncrementFormula_(4, "P", "GK", "GJ"), 5), null, "행번호 다르면 아님");
  assert.equal(gs.standardIncrementFormulaParts_("=GJ4-GI4", 4), null);
  assert.equal(gs.standardIncrementFormulaParts_(gs.metricIncrementFormula_(4, "Q", "GK", "GJ"), 4, "P"), null, "첫 날짜열 다르면 아님");
});
