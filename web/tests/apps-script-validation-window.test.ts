import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"), "utf8");

function extract(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\nfunction ", start + 10);
  // 잘라낸 끝이 다음 함수 위의 '// 주석' 줄일 수 있다. 줄바꿈으로 닫지 않으면 뒤에 붙이는
  // `; return …`가 주석에 먹힌다 — 윈도우(CRLF 체크아웃)에선 \r 덕에 통과하고
  // 리눅스 CI(LF)에서만 깨졌다(2026-11-16 d07b5f15 이후 main CI 실패).
  return source.slice(start, next === -1 ? undefined : next) + "\n";
}

test("최근 날짜 유효성 검사창은 KST 오늘을 포함한 60일이다", () => {
  assert.match(source, /const LINKED_DATE_VALIDATION_LOOKBACK_DAYS_ = 60/);
  const cutoff = extract("linkedDateValidationCutoff_");
  assert.match(cutoff, /shiftDateStr_\(todayStr_\(\), -\(LINKED_DATE_VALIDATION_LOOKBACK_DAYS_ - 1\)\)/);

  const recent = new Function(
    "linkedDateValidationCutoff_",
    `${extract("linkedRecentDateColumns_")}; return linkedRecentDateColumns_;`,
  )(() => "2026-09-18") as (sheet: unknown, dates: Record<number, string>) => Record<number, string>;
  assert.deepEqual(recent({}, {
    16: "2026-09-17",
    17: "2026-09-18",
    18: "2026-11-15",
    19: "2026-11-16",
  }), {
    17: "2026-09-18",
    18: "2026-11-15",
    19: "2026-11-16",
  });
});

test("연속 날짜열은 최소 clear/apply 호출 수로 묶는다", () => {
  const runs = new Function(`${extract("linkedDateColumnRuns_")}; return linkedDateColumnRuns_;`)() as
    (cols: number[]) => Array<[number, number]>;
  assert.deepEqual(runs([20, 17, 16, 22, 21]), [[16, 2], [20, 3]]);
  assert.deepEqual(runs([]), []);
});

function runWindowRefresh(previous: string | null, cutoff: string, force = false) {
  const cleared: Array<[number, number, number, number]> = [];
  const writes: Array<[string, string]> = [];
  const props = {
    getProperty: () => previous,
    setProperty: (key: string, value: string) => writes.push([key, value]),
  };
  const sheet = {
    getMaxRows: () => 101,
    getRange: (row: number, col: number, rows: number, cols: number) => ({
      clearDataValidations: () => cleared.push([row, col, rows, cols]),
    }),
  };
  const fn = new Function(
    "PropertiesService", "linkedDateValidationCutoff_", "linkedDateColumns_", "linkedDateColumnRuns_", "Logger",
    `const LINKED_DATE_VALIDATION_CUTOFF_PROP_ = "LINKED_DATE_VALIDATION_CUTOFF_DATE";
     const CONFIG = { DATA_START_ROW: 2 };
     ${extract("refreshLinkedDateValidationWindow_")};
     return refreshLinkedDateValidationWindow_;`,
  )(
    { getScriptProperties: () => props },
    () => cutoff,
    () => ({ 16: "2026-09-17", 17: "2026-09-18", 18: "2026-09-19", 19: "2026-11-15" }),
    (cols: number[]) => {
      if (!cols.length) return [];
      const sorted = [...cols].sort((a, b) => a - b);
      const out: Array<[number, number]> = [];
      let start = sorted[0], prev = sorted[0];
      for (let i = 1; i <= sorted.length; i++) {
        const col = sorted[i];
        if (i < sorted.length && col === prev + 1) { prev = col; continue; }
        out.push([start, prev - start + 1]);
        start = col; prev = col;
      }
      return out;
    },
    { log: () => undefined },
  ) as (sheet: unknown, force: boolean) => Record<string, unknown>;
  return { result: fn(sheet, force), cleared, writes };
}

test("매일 기준일 이동은 새로 만료된 하루치 규칙만 해제한다", () => {
  const out = runWindowRefresh("2026-09-18", "2026-09-19");
  assert.deepEqual(out.cleared, [[2, 17, 100, 1]]);
  assert.deepEqual(out.writes, [["LINKED_DATE_VALIDATION_CUTOFF_DATE", "2026-09-19"]]);
  assert.equal(out.result.cleared_columns, 1);
  assert.equal(out.result.cleared_cells, 100);
});

test("첫 실행은 창 밖 규칙 전체를, 같은 날 재실행은 0개를 해제한다", () => {
  const first = runWindowRefresh(null, "2026-09-19");
  assert.deepEqual(first.cleared, [[2, 16, 100, 2]]);
  assert.equal(first.result.cleared_columns, 2);

  const sameDay = runWindowRefresh("2026-09-19", "2026-09-19");
  assert.deepEqual(sameDay.cleared, []);
  assert.deepEqual(sameDay.writes, []);
  assert.equal(sameDay.result.cleared_columns, 0);
});

test("모든 설치·복구 경로와 감사가 같은 최근 60일 정책을 쓴다", () => {
  assert.match(extract("applyLinkedFixedInputValidationsRows_"), /linkedRecentDateColumns_\(sheet\)/);
  assert.match(extract("applyLinkedInputValidationsToRows_"), /linkedRecentDateColumns_\(sheet\)/);
  assert.match(extract("repairLinkedInputValidationsOnEdit_"), /linkedRecentDateColumns_\(sheet\)/);
  const repair = extract("repairLinkedInputValidationsWithBackup");
  assert.match(repair, /linkedRecentDateColumns_\(sheet, dateColumns\)/);
  // 규칙 복구는 기존 A열 값 오류를 숨기지 않고 별도 경고로 남기되,
  // 값 정규화 책임까지 떠안아 정상적인 규칙 복구를 실패시키지 않는다.
  assert.match(repair, /const remaining = afterRules\.a_missing_rule/);
  assert.doesNotMatch(repair, /const remaining = afterValues\.a_invalid_values/);
  assert.match(repair, /a_invalid_rows: afterValues\.a_invalid_rows/);
  // 전체 규칙 복구가 성공하면 그날의 60일 기준일도 함께 저장해야 한다.
  // 그렇지 않으면 다음 exportStats가 창 밖 열 전체를 불필요하게 다시 clear한다.
  assert.match(
    repair,
    /setProperty\(LINKED_DATE_VALIDATION_CUTOFF_PROP_, linkedDateValidationCutoff_\(\)\)/,
  );
  assert.match(extract("applyLinkedSheetInputValidation_"), /linkedRecentDateColumns_\(sheet\)/);
  assert.match(extract("inspectLinkedInputValidationSamples_"), /DATE_RULE_OUTSIDE_WINDOW/);
  const exportBody = extract("exportStatsWithOptions_");
  assert.match(exportBody, /if \(!formulaOnly\) refreshLinkedDateValidationWindow_\(sheet, false\)/);

  // 셀 규칙이 없는 오래된 날짜도 onEdit 값 검증(숫자·업로드일·미래)은 전 기간 유지한다.
  assert.match(extract("validateLinkedSheetInputOnEdit_"), /const dateColumns = linkedDateColumns_\(sheet\)/);
  assert.match(extract("validateLinkedSheetInputOnEdit_"), /if \(statDate > today\)/);
  assert.match(extract("applyDateInputValidationRows_"), /<=TODAY\(\)/);
});

test("이동 장치는 유효성 규칙만 지우고 값·수식·행은 건드리지 않는다", () => {
  const body = extract("refreshLinkedDateValidationWindow_");
  assert.match(body, /clearDataValidations\(\)/);
  assert.doesNotMatch(body, /setValue|setValues|setFormula|clearContent|deleteRow|deleteRows/);
});
