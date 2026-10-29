// 연동시트 입력 검증 규칙은 '자기 열'에만 — 붙여넣기로 남의 열에 따라온 규칙을 지운다.
// 2026-10-29 사고: B열(게시물URL) 규칙이 C5153:C5162(채널명)로 붙여넣기에 딸려 와 채널명마다
//   '유효성 규칙 위반'이 떴다. 예전 복구 코드는 H(누적)·I(증분)만 지워서 C열은 못 막았다.
// 사용자: "각 열의 규칙이 각 열에만 적용되게 해줘".

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appsScript = readFileSync(join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"), "utf8");

function extract(name: string): string {
  const start = appsScript.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const next = appsScript.indexOf("\nfunction ", start + 10);
  return appsScript.slice(start, next === -1 ? undefined : next);
}

const clearRuns = new Function(`${extract("linkedColumnsToClearValidation_")}; return linkedColumnsToClearValidation_;`)() as (
  from: number, to: number, allowed: number[],
) => Array<[number, number]>;

// 실제 시트(2026-10-29 데이터 확인 패널): A 업로드일, B URL, D 채널분류(드롭다운), F 상품명, G 비용,
// J CPV, K·L 기획자·제작자, P~ 날짜열. 나머지(C 채널명, E 소재명, H·I 수식, M 캡션, N·O …)는 규칙 없음.
const ALLOWED = [1, 2, 4, 6, 7, 10, 11, 12, 16, 17, 18];

test("🚨 C열(채널명)만 붙여넣은 경우 — 따라온 규칙을 지운다", () => {
  assert.deepEqual(clearRuns(3, 3, ALLOWED), [[3, 1]]);
});

test("규칙 허용 열은 지우지 않는다(위에서 원래 규칙으로 다시 씌움)", () => {
  for (const col of ALLOWED) assert.deepEqual(clearRuns(col, col, ALLOWED), [], String(col));
});

test("여러 열에 걸친 붙여넣기는 무규칙 열만 연속 구간으로 묶어 지운다", () => {
  // A~P 전체 → C, E, H~I, M~O 만
  assert.deepEqual(clearRuns(1, 16, ALLOWED), [[3, 1], [5, 1], [8, 2], [13, 3]]);
});

test("허용 목록이 비어 있으면 범위 전체가 지울 대상", () => {
  assert.deepEqual(clearRuns(3, 5, []), [[3, 3]]);
});

test("허용 열 구성: 업로드일·채널분류·고정 규칙 열·날짜열, 누적·증분은 항상 지움(소스 계약)", () => {
  const body = extract("applyLinkedFixedInputValidationsRows_");
  assert.match(body, /const channelTypeCol = findHeaderCol_\(sheet, \["채널분류", "채널 분류"\]\)/);
  assert.match(body, /const allowedCols = \[1, channelTypeCol\]/);
  // 채널분류 머리글을 못 찾으면 드롭다운을 지우지 않도록 H·I만 정리하는 예전 동작으로 후퇴
  assert.match(body, /if \(channelTypeCol\) \{[\s\S]*\} else \{[\s\S]*\[cumulativeCol, incrementCol\]/);
  assert.match(body, /linkedFixedInputValidationSpecs_\(sheet, startRow\)\.map\(function\(spec\) \{ return spec\.col; \}\)/);
  assert.match(body, /Object\.keys\(linkedDateColumns_\(sheet\)\)\.map\(Number\)/);
  assert.match(body, /col !== cumulativeCol && col !== incrementCol/);
  assert.match(body, /linkedColumnsToClearValidation_\(fromCol, toCol, allowedCols\)/);
  assert.match(body, /\.clearDataValidations\(\)/);
  assert.doesNotMatch(body, /clearContent|clear\(\)|setValue/, "값은 건드리지 않는다");
});

test("붙여넣기(편집) 때마다 편집 범위에 적용된다(소스 계약)", () => {
  const repair = extract("repairLinkedInputValidationsOnEdit_");
  assert.match(repair, /applyLinkedFixedInputValidationsRows_\(sheet, rowStart, rowCount, firstCol, lastCol\)/);
  const edit = extract("onStatusEdit_");
  assert.match(edit, /repairLinkedInputValidationsOnEdit_\(e, sheet\)/);
});

// ── 실제 함수를 가짜 시트로 실행 ─────────────────────────────────────────────
// 헤더(2026-10-29 실제 시트): A 업로드일 B 게시물URL C 채널명 D 채널분류 E 소재명 F 상품명 G 비용
// H 누적 조회수 I 증분값 J CPV K 기획자 L 제작자 M 캡션 N 업체명 O 상태 P~R 날짜열 S 등록상태
function runApply(opts: { channelHeader: boolean; fromCol?: number; toCol?: number }) {
  const cleared = new Set<number>();
  const set = new Set<number>();
  const headers: Record<string, number> = {
    "누적 조회수": 8, "채널분류": opts.channelHeader ? 4 : 0, CPV: 10,
  };
  const sheet = {
    getLastColumn: () => 19,
    getRange: (_r: number, col: number, _n: number, cols = 1) => ({
      clearDataValidations: () => { for (let c = col; c < col + cols; c++) cleared.add(c); },
      setDataValidation: () => { for (let c = col; c < col + cols; c++) set.add(c); },
    }),
  };
  const src = `${extract("applyLinkedFixedInputValidationsRows_")}\n${extract("linkedColumnsToClearValidation_")}
    return applyLinkedFixedInputValidationsRows_;`;
  const fn = new Function(
    "findHeaderCol_", "getIncrementCol_", "linkedFixedInputValidationSpecs_", "linkedDateColumns_", "linkedValidationRule_",
    src,
  )(
    (_s: unknown, names: string[]) => names.map((n) => headers[n]).find((v) => v) || null,
    () => 9,
    () => [2, 6, 7, 10, 11, 12].map((col) => ({ col, formula: "=TRUE", help: "" })),
    () => ({ 16: "2026-10-27", 17: "2026-10-28", 18: "2026-10-29" }),
    () => ({}),
  );
  fn(sheet, 5153, 10, opts.fromCol, opts.toCol);
  return { cleared: [...cleared].sort((a, b) => a - b), set: [...set].sort((a, b) => a - b) };
}

test("실행: C열 붙여넣기 → C 규칙만 지우고 다른 열은 안 건드림", () => {
  assert.deepEqual(runApply({ channelHeader: true, fromCol: 3, toCol: 3 }).cleared, [3]);
});

test("실행: 전체 정리 → 무규칙 열(C·E·H·I·M·N·O·등록상태)만 지우고 A·B·D·F·G·J·K·L·날짜열은 절대 안 지움", () => {
  const r = runApply({ channelHeader: true });
  assert.deepEqual(r.cleared, [3, 5, 8, 9, 13, 14, 15, 19]);
  for (const keep of [1, 2, 4, 6, 7, 10, 11, 12, 16, 17, 18]) assert.ok(!r.cleared.includes(keep), String(keep));
  assert.deepEqual(r.set, [2, 6, 7, 10, 11, 12]);   // 고정 규칙 열은 원래 규칙으로 다시 씌움
});

test("실행: 채널분류 머리글을 못 찾으면 D 드롭다운을 지우지 않고 H·I만 정리(예전 동작)", () => {
  const r = runApply({ channelHeader: false });
  assert.deepEqual(r.cleared, [8, 9]);
});
