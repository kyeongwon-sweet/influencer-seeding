import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRows, formatAuditMessage, type AuditPost, type SheetAuditRow } from "../lib/formula-audit.ts";

const TODAY = "2026-07-30";

function post(measured: Record<string, number>, posted = "2026-07-20", ended: string | null = null): AuditPost {
  return { posted, ended, measured: new Map(Object.entries(measured)) };
}

function row(partial: Partial<SheetAuditRow> & { key: string }): SheetAuditRow {
  return { label: partial.key, h: null, inc: null, dates: [], ...partial };
}

test("정상 행: H=MAX, I=마지막-이전최대 → 이상 0", () => {
  const rows = [row({
    key: "ig:a", h: 300, inc: 100,
    dates: [{ date: "2026-07-28", value: 200 }, { date: "2026-07-29", value: 300 }],
  })];
  const posts = new Map([["ig:a", post({ "2026-07-28": 200, "2026-07-29": 300 })]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.h.ok, 1);
  assert.equal(r.inc.ok, 1);
  assert.ok(formatAuditMessage(r).healthy);
});

test("오류셀(#REF!)은 즉시 이상으로 집계·보고", () => {
  const rows = [row({ key: "ig:a", h: "#REF!", inc: "#REF!", dates: [{ date: "2026-07-29", value: 10 }] })];
  const r = auditRows(rows, new Map(), TODAY);
  assert.equal(r.h.errorCells, 1);
  assert.equal(r.inc.errorCells, 1);
  const m = formatAuditMessage(r);
  assert.ok(!m.healthy);
  assert.match(m.text, /🔴/);
  assert.match(m.text, /H 오류셀 1/);
});

test("데이터 있는데 H 빈칸 = 이상 / 수동 보존(값≠MAX)은 허용 집계", () => {
  const rows = [
    row({ key: "ig:empty", h: null, dates: [{ date: "2026-07-29", value: 50 }] }),
    row({ key: "ig:manual", h: 999, dates: [{ date: "2026-07-29", value: 50 }] }),
  ];
  const r = auditRows(rows, new Map(), TODAY);
  assert.equal(r.h.emptyButData, 1);
  assert.equal(r.h.manualKept, 1);
});

test("백로그(게시 7일 초과 첫 측정)의 증분 빈칸은 정상", () => {
  const rows = [row({
    key: "ig:backlog", inc: null,
    dates: [{ date: "2026-07-29", value: 5000 }],
  })];
  const posts = new Map([["ig:backlog", post({ "2026-07-29": 5000 }, "2026-06-01")]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.emptyOk, 1);
  assert.equal(r.inc.mismatch, 0);
});

test("당일 수기값 포함(V2 시트 기대값) 또는 DB 규칙 중 하나와 맞으면 정합", () => {
  // 시트에는 오늘 수기 400 존재(시트 기대=400-300=100), DB엔 오늘 측정 없음(DB 기대=300-200=100... 다른 값 시나리오)
  const rows = [row({
    key: "ig:today", inc: 100,
    dates: [{ date: "2026-07-28", value: 200 }, { date: "2026-07-29", value: 300 }, { date: "2026-07-30", value: 400 }],
  })];
  const posts = new Map([["ig:today", post({ "2026-07-28": 200, "2026-07-29": 300 })]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.ok, 1); // 시트 기대값(400-300=100)과 일치
});

test("두 기대값 어느 쪽과도 다르면 불일치로 보고", () => {
  const rows = [row({
    key: "ig:bad", inc: 7777,
    dates: [{ date: "2026-07-28", value: 200 }, { date: "2026-07-29", value: 300 }],
  })];
  const posts = new Map([["ig:bad", post({ "2026-07-28": 200, "2026-07-29": 300 })]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.mismatch, 1);
  assert.match(formatAuditMessage(r).text, /I 오류셀 0·불일치 1/);
});
