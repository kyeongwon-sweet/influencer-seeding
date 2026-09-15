// H수식형태 오류의 **원인 판별** — 진단 계약.
//
// 배경(2026-09-15): hInvalid 가 하루 만에 1 → 42 로 뛰었는데, 요약 라인은 상한 12건이라
// 어떤 행이 왜 걸렸는지 볼 방법이 없었다. hInvalid 는 원인이 둘이고 **조치가 정반대**다:
//   · overwritten  — 날짜 이력이 있는데 H가 숫자로 덮임 → 수식 복원
//   · stale_range  — 수식은 살아 있는데 끝 열이 최신 데이터 열보다 앞섬 → 범위 확장
// 숫자만 보고 한쪽으로 단정하면 엉뚱한 쪽을 고친다(2026-08-06 H열 1,765행 사고와 같은 계열).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describeHInvalid, type SheetAuditRow } from "../lib/formula-audit.ts";

const RANGE = { firstColumn: "P", lastColumn: "EF", targetColumn: "EF" };

function row(over: Partial<SheetAuditRow>): SheetAuditRow {
  return {
    key: "ig:ABC", label: "테스트채널", sourceRow: 820,
    h: null, inc: null, metricRange: RANGE,
    dates: [{ date: "2026-09-14", value: 100, column: "EF" }],
    ...over,
  } as SheetAuditRow;
}

test("숫자로 덮인 H는 overwritten 으로 분류된다", () => {
  const d = describeHInvalid(row({ hFormula: 45795 }));
  assert.equal(d.cause, "overwritten");
  assert.equal(d.endColumn, null);
  assert.equal(d.latestDataColumn, "EF");
  assert.equal(d.row, 820);
});

test("끝 열이 최신 데이터 열보다 앞서면 stale_range 로 분류된다", () => {
  const d = describeHInvalid(row({ hFormula: '=IF(COUNT(P820:EE820)=0,"",MAX(P820:EE820))' }));
  assert.equal(d.cause, "stale_range", "새 날짜열이 MAX 범위 밖 → 누적이 조용히 멈춘다");
  assert.equal(d.endColumn, "EE");
  assert.equal(d.latestDataColumn, "EF");
});

test("끝 열이 최신 데이터 열을 덮으면 stale_range 가 아니다", () => {
  const d = describeHInvalid(row({ hFormula: '=IF(COUNT(P820:EF820)=0,"",MAX(P820:EF820))' }));
  assert.notEqual(d.cause, "stale_range");
});

test("날짜 이력이 없으면 최신 데이터 열은 null 이고 stale_range 로 단정하지 않는다", () => {
  const d = describeHInvalid(row({
    hFormula: '=IF(COUNT(P820:EE820)=0,"",MAX(P820:EE820))', dates: [],
  }));
  assert.equal(d.latestDataColumn, null);
  assert.equal(d.dateCount, 0);
  assert.notEqual(d.cause, "stale_range", "비교할 데이터 열이 없으면 범위 뒤처짐을 단정할 수 없다");
});

test("알 수 없는 형태는 other 로 남긴다 — 억지로 분류하지 않는다", () => {
  const d = describeHInvalid(row({ hFormula: "=SOMETHING_ELSE(1)" }));
  assert.equal(d.cause, "other");
  assert.equal(d.endColumn, null);
});

test("Slack 메시지에는 상세가 들어가지 않는다(상한 12건 요약 유지)", () => {
  const src = readFileSync(join(import.meta.dirname, "../lib/formula-audit.ts"), "utf8");
  const fmt = src.slice(src.indexOf("export function formatAuditMessage"));
  assert.ok(!fmt.includes("hInvalidRows"),
    "상세를 Slack 본문에 넣으면 매일 아침 메시지가 수십 줄로 늘어난다");
});
