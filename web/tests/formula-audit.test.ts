import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditRows,
  dominantMetricFormulaEndColumn,
  expectedCumulativeFormula,
  expectedIncrementFormula,
  formatAuditMessage,
  metricFormulaEndColumn,
  parseHeaderDate,
  resolveMetricDateColumns,
  type AuditPost,
  type SheetAuditRow,
} from "../lib/formula-audit.ts";

test("parseHeaderDate: 월.일 / 2자리연도 접두 / 4자리연도 / 날짜셀 혼재 인식", () => {
  const st = { year: 2026, prevMonth: null as number | null };
  assert.equal(parseHeaderDate("5. 17 (일)", st), "2026-05-17");
  assert.equal(parseHeaderDate("6.1", st), "2026-06-01");
  // 2자리 연도 접두 — 기존 공용 parseMonthDay가 month=26으로 읽어 놓쳤던 형식
  assert.equal(parseHeaderDate("26.7.16.(목)", st), "2026-07-16");
  assert.equal(parseHeaderDate("2026-07-18", st), "2026-07-18");
  assert.equal(parseHeaderDate("등록상태", st), null);
  assert.equal(parseHeaderDate("", st), null);
});

test("parseHeaderDate: 연도 없는 헤더는 월 감소 시 +1년 롤오버", () => {
  const st = { year: 2026, prevMonth: null as number | null };
  assert.equal(parseHeaderDate("12.30", st), "2026-12-30");
  assert.equal(parseHeaderDate("1.2", st), "2027-01-02");
  // 연도 명시 헤더가 오면 그 연도로 재동기화
  assert.equal(parseHeaderDate("26.7.16", st), "2026-07-16");
  assert.equal(parseHeaderDate("7.17", st), "2026-07-17");
});

const TODAY = "2026-07-30";
const METRIC_RANGE = {
  firstColumn: "P",
  lastColumn: "DJ",
  targetColumn: "DJ",
  columns: ["P", "DH", "DI", "DJ"],
};

function post(measured: Record<string, number>, posted = "2026-07-20", ended: string | null = null): AuditPost {
  return { posted, ended, measured: new Map(Object.entries(measured)) };
}

function row(partial: Partial<SheetAuditRow> & { key: string }): SheetAuditRow {
  return { label: partial.key, h: null, inc: null, metricRange: METRIC_RANGE, dates: [], ...partial };
}

test("기대 수식은 전체 날짜 범위와 최신 수집 target 열을 분리해 사용", () => {
  assert.equal(
    expectedCumulativeFormula(10, METRIC_RANGE),
    '=IF(COUNT(P10:DJ10)=0,"",MAX(P10:DJ10))',
  );
  assert.match(expectedIncrementFormula(10, METRIC_RANGE), /rng,\$P10:\$DJ10/);
  assert.match(expectedIncrementFormula(10, METRIC_RANGE), /targetC,COLUMN\(\$DJ10\)/);
  assert.doesNotMatch(expectedIncrementFormula(10, METRIC_RANGE), /DH10/);
});

test("날짜열 최신 헤더가 일시적으로 빈 값이면 등록상태 직전까지 하루 단위로 복구", () => {
  const header = Array<string | number | boolean | null>(20).fill(null);
  header[15] = "2026. 8. 24"; // P
  header[16] = "2026. 8. 25"; // Q
  header[17] = "";            // R: 대량 쓰기 직후 최신 헤더만 빈 스냅샷
  header[18] = "등록상태";     // S
  const cols = resolveMetricDateColumns(header, 9, 18, 2026);
  assert.deepEqual(cols, [
    { idx: 15, date: "2026-08-24", inferred: false },
    { idx: 16, date: "2026-08-25", inferred: false },
    { idx: 17, date: "2026-08-26", inferred: true },
  ]);
});

test("비어 있지 않은 미인식 헤더는 날짜로 지어내지 않음", () => {
  const header = Array<string | number | boolean | null>(20).fill(null);
  header[15] = "2026. 8. 24";
  header[16] = "메모";
  header[17] = "등록상태";
  assert.deepEqual(resolveMetricDateColumns(header, 9, 17, 2026), [
    { idx: 15, date: "2026-08-24", inferred: false },
  ]);
});

test("H/I 수식의 지배적 끝열로 혼합 스냅샷을 감지", () => {
  const hDm = '=IF(COUNT(P2:DM2)=0,"",MAX(P2:DM2))';
  const iDm = '=IFERROR(LET(rng,$P2:$DM2,cols,SEQUENCE(1,COLUMNS(rng),COLUMN($P2),1),lastC,1),"")';
  const hDl = '=IF(COUNT(P3:DL3)=0,"",MAX(P3:DL3))';
  assert.equal(metricFormulaEndColumn(hDm), "DM");
  assert.equal(metricFormulaEndColumn(iDm), "DM");
  assert.deepEqual(dominantMetricFormulaEndColumn([hDm, iDm, hDm, hDl, 123, null]), {
    column: "DM",
    count: 3,
    total: 4,
  });
});

test("감사 라우트는 헤더를 별도 재조회하고 혼합 스냅샷을 실패 닫기", () => {
  const source = readFileSync(new URL("../app/api/sponsored-posts/formula-audit/route.ts", import.meta.url), "utf8");
  assert.match(source, /fetchSheetTabValues\(SHEET_ID, SHEET_GID, "A1:ZZ1"\)/);
  assert.match(source, /snapshotAhead\(dateCols, dominantFormulaEnd\)/);
  assert.match(source, /sheet_snapshot_not_ready/);
  assert.match(source, /status:\s*503/);
  assert.match(source, /const targetDateColumn = \[\.\.\.dateCols\]\.reverse\(\)\.find/);
  assert.match(source, /dc\.date < kdate/);
  assert.match(source, /targetColumn: columnNumberToA1\(targetDateColumn\.idx \+ 1\)/);
});

test("과거 끝열 수식은 그 뒤 날짜에 값이 없을 때만 정상", () => {
  const historicalFormula = expectedCumulativeFormula(10, { ...METRIC_RANGE, lastColumn: "DH" });
  const safe = row({
    key: "ig:safe-old-range",
    sourceRow: 10,
    hFormula: historicalFormula,
    incFormula: expectedIncrementFormula(10, METRIC_RANGE),
    dates: [{ date: "2026-08-21", value: 100, column: "DH" }],
  });
  const stale = row({
    key: "ig:stale-old-range",
    sourceRow: 10,
    hFormula: historicalFormula,
    incFormula: expectedIncrementFormula(10, { ...METRIC_RANGE, lastColumn: "DH", targetColumn: "DH" }),
    dates: [{ date: "2026-08-23", value: 120, column: "DJ" }],
  });

  const r = auditRows([safe, stale], new Map(), TODAY);
  assert.equal(r.formulaShape.hInvalid, 1);
  assert.equal(r.formulaShape.incInvalid, 1);
});

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

test("target일 미측정이면 과거 마지막 증분을 재노출하지 않고 I 공란이 정상", () => {
  const rows = [row({
    key: "ig:missing-target", h: 88418, inc: null,
    dates: [{ date: "2026-07-28", value: 88418 }],
  })];
  const posts = new Map([["ig:missing-target", post({ "2026-07-28": 88418 })]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.emptyOk, 1);
  assert.equal(r.inc.blankExpected, 0);
  assert.equal(r.inc.mismatch, 0);
});

test("target일 미측정인데 과거 증분 숫자가 남으면 불일치", () => {
  const rows = [row({
    key: "ig:stale-inc", h: 88418, inc: 88418,
    dates: [{ date: "2026-07-28", value: 88418 }],
  })];
  const posts = new Map([["ig:stale-inc", post({ "2026-07-28": 88418 })]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.mismatch, 1);
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

test("URL 없이 조회수만 남은 고아 행은 행번호와 함께 즉시 이상", () => {
  const r = auditRows([], new Map(), TODAY, ["고아행 1877: URL 없음 · H=1923 · 최근=2026-08-07 1923"]);
  assert.equal(r.orphanRows, 1);
  const m = formatAuditMessage(r);
  assert.equal(m.healthy, false);
  assert.match(m.text, /고아행 1/);
  assert.match(m.text, /1877/);
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
    key: "ig:backlog", sourceRow: 12, h: 5000, inc: null, incFormula: '=""',
    dates: [{ date: "2026-07-29", value: 5000 }],
  })];
  const posts = new Map([["ig:backlog", post({ "2026-07-29": 5000 }, "2026-06-01")]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.emptyOk, 1);
  assert.equal(r.inc.mismatch, 0);
  assert.equal(r.formulaShape.incInvalid, 0);
  assert.equal(formatAuditMessage(r).healthy, true);
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

test("신규 첫측정: 누적값 있는데 증분 빈칸 = blankExpected로 분리·집계(조용한 누락 방지)", () => {
  // 실제 사고(2026-08-06 바이럴영상 4건): 어제 추가·오늘 첫 수집됐는데
  // 라이브 시트 증분 수식이 '첫 유효측정=그날 전체'를 자동표시 못 해 사람이 수기로 채움.
  const rows = [row({
    key: "ig:new", h: 57000, inc: null,
    dates: [{ date: "2026-07-29", value: 57000 }],
  })];
  const posts = new Map([["ig:new", post({ "2026-07-29": 57000 }, "2026-07-29")]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.blankExpected, 1);
  assert.equal(r.inc.emptyOk, 0);
  assert.equal(r.inc.mismatch, 0); // 불일치가 아니라 전용 카운트로
  const m = formatAuditMessage(r);
  assert.ok(!m.healthy);
  assert.match(m.text, /증분빈칸\(값있어야함\) 1/);
  assert.match(r.anomalies.join("\n"), /신규첫측정/);
});

test("두 기대값 어느 쪽과도 다르면 불일치로 보고", () => {
  const rows = [row({
    key: "ig:bad", sourceRow: 432, h: 300, inc: 7777,
    dates: [{ date: "2026-07-28", value: 200 }, { date: "2026-07-29", value: 300 }],
  })];
  const posts = new Map([["ig:bad", post({ "2026-07-28": 200, "2026-07-29": 300 })]]);
  const r = auditRows(rows, posts, TODAY);
  assert.equal(r.inc.mismatch, 1);
  assert.match(formatAuditMessage(r).text, /I 오류셀 0·불일치 1/);
  assert.match(r.anomalies[0], /ig:bad · 행 432/);
});

test("수식 형태 감사: 정상 수식은 통과하고 숫자 덮어쓰기·빈 스텁은 값과 무관하게 검출", () => {
  const valid = row({
    key: "ig:valid",
    sourceRow: 10,
    h: 300,
    inc: 100,
    hFormula: expectedCumulativeFormula(10, METRIC_RANGE),
    incFormula: expectedIncrementFormula(10, METRIC_RANGE),
    dates: [{ date: "2026-07-28", value: 200 }, { date: "2026-07-29", value: 300 }],
  });
  const broken = row({
    key: "ig:broken",
    sourceRow: 11,
    h: 300,
    inc: null,
    hFormula: 300,
    incFormula: '=""',
    dates: [{ date: "2026-07-29", value: 300 }],
  });
  const posts = new Map([
    ["ig:valid", post({ "2026-07-28": 200, "2026-07-29": 300 })],
    ["ig:broken", post({}, "2026-06-01")],
  ]);

  const r = auditRows([valid, broken], posts, TODAY);
  assert.equal(r.formulaShape.hInvalid, 1);
  assert.equal(r.formulaShape.hManual, 0);
  assert.equal(r.formulaShape.incInvalid, 1);
  assert.equal(formatAuditMessage(r).healthy, false);
  assert.match(r.anomalies.join("\n"), /H수식형태 오류/);
  assert.match(r.anomalies.join("\n"), /I수식형태 오류/);
});

test("수식 형태 감사: 날짜 이력 없는 H의 수기 누적값은 보존·별도 집계", () => {
  const r = auditRows([row({
    key: "tt:satellite",
    sourceRow: 568,
    h: 43201,
    hFormula: 43201,
    incFormula: expectedIncrementFormula(568, METRIC_RANGE),
    dates: [],
  })], new Map(), TODAY);
  assert.equal(r.formulaShape.hInvalid, 0);
  assert.equal(r.formulaShape.hManual, 1);
  assert.equal(r.formulaShape.incInvalid, 0);
  assert.equal(r.h.valueOnly, 1);
  assert.equal(formatAuditMessage(r).healthy, true);
});

test("수식 형태 감사: 다른 행을 참조하는 복사 오류도 검출", () => {
  const r = auditRows([row({
    key: "ig:wrong-row",
    sourceRow: 20,
    hFormula: expectedCumulativeFormula(19, METRIC_RANGE),
    incFormula: expectedIncrementFormula(19, METRIC_RANGE),
  })], new Map(), TODAY);
  assert.equal(r.formulaShape.hInvalid, 1);
  assert.equal(r.formulaShape.incInvalid, 1);
});
