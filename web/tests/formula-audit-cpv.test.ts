// CPV(J) 열 감사 — 행동 계약 (2026-09-29 추가).
//
// 왜 생겼나: "지금 CPV 열 수식 잘못된 거 없어?" 라는 질문에 답할 수단이 없었다.
// 누적(H)·증분(I)만 전수감사했고 CPV 는 감사 밖이라, 사람이 셀을 하나씩 찍어보는 수밖에
// 없었다(실제로 그렇게 2행만 확인하고 "전수는 모른다"고 답해야 했다).

import test from "node:test";
import assert from "node:assert/strict";

import { auditRows, expectedCpvFormula, type SheetAuditRow } from "../lib/formula-audit.ts";

const REFS = { costColumn: "G", cumulativeColumn: "H" };
const RANGE = { firstColumn: "P", lastColumn: "ET", targetColumn: "ET" };

function row(over: Partial<SheetAuditRow> = {}): SheetAuditRow {
  const sourceRow = over.sourceRow ?? 2;
  return {
    key: "ig:AAA", label: "테스트", sourceRow,
    h: 100, inc: 10,
    hFormula: `=IF(COUNT(P${sourceRow}:ET${sourceRow})=0,"",MAX(P${sourceRow}:ET${sourceRow}))`,
    incFormula: undefined,
    cpvFormula: expectedCpvFormula(sourceRow, REFS),
    cost: 70000,
    cpvRefs: REFS,
    metricRange: RANGE,
    dates: [{ date: "2026-09-28", value: 100, column: "ET" }],
    ...over,
  };
}

const audit = (rows: SheetAuditRow[]) => auditRows(rows, new Map(), "2026-09-29", [], "2026-09-28");

test("기대 수식과 같으면 ok", () => {
  const r = audit([row()]);
  assert.equal(r.cpv.ok, 1);
  assert.equal(r.cpv.invalid, 0);
});

test("공백·대소문자만 다른 건 같은 수식으로 본다", () => {
  const r = audit([row({ cpvFormula: '=if(G2="", "", IF(N(H2)=0,0,IFERROR(G2/H2,"?")))' })]);
  assert.equal(r.cpv.ok, 1);
});

test("🚨 수기 숫자로 덮이면 invalid — 다음날부터 갱신이 멈춘다", () => {
  const r = audit([row({ cpvFormula: 1.25 })]);
  assert.equal(r.cpv.invalid, 1);
  assert.equal(r.cpvInvalidRows[0].row, 2);
});

test("다른 열을 가리키는 수식도 invalid — 조용히 남의 값을 나눈다", () => {
  const r = audit([row({ cpvFormula: '=IF(G2="","",IF(N(H3)=0,0,IFERROR(G2/H3,"?")))' })]);
  assert.equal(r.cpv.invalid, 1);
});

test("🚨 비용이 있는데 누적이 0이면 zeroWithCost — CPV 가 0원으로 보인다", () => {
  // 0원은 '계산 불가'지 '최고 효율'이 아니다. CPV 오름차순 정렬에서 맨 위로 올라온다.
  const r = audit([row({ dates: [], h: 0, cost: 11_000_000 })]);
  assert.equal(r.cpv.zeroWithCost, 1);
  assert.equal(r.cpv.ok, 1, "수식 자체는 현행과 같으므로 invalid 가 아니다");
});

test("비용이 없으면 zeroWithCost 가 아니다 — 무상 채널은 정상", () => {
  const r = audit([row({ dates: [], h: 0, cost: null })]);
  assert.equal(r.cpv.zeroWithCost, 0);
  assert.equal(r.cpv.emptyCost, 1);
});

test("누적이 있으면 비용이 있어도 zeroWithCost 가 아니다", () => {
  const r = audit([row({ cost: 70000 })]);
  assert.equal(r.cpv.zeroWithCost, 0);
});

test("CPV 재료가 없으면 감사를 건너뛴다 — 헤더 못 찾은 시트에서 오탐 금지", () => {
  const r = audit([row({ cpvFormula: undefined, cpvRefs: undefined })]);
  assert.equal(r.cpv.ok + r.cpv.invalid, 0);
});

test("라우트가 CPV 를 실제로 넘긴다(소스 계약)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(
    join(import.meta.dirname, "../app/api/sponsored-posts/formula-audit/route.ts"), "utf8");
  assert.match(src, /cpvCol = findCol\(\["CPV", "cpv"\]\)/, "CPV 열을 안 찾으면 감사가 통째로 꺼진다");
  assert.match(src, /cpvRefs:/, "행에 cpvRefs 를 안 실으면 기대 수식을 만들 수 없다");
  assert.match(src, /Math\.max\(cumCol, incCol, cpvCol/, "수식 조회 범위에 J 가 빠지면 항상 null 이다");
  assert.match(src, /cpvZeroWithCost/, "응답에 노출돼야 사람이 본다");
});
