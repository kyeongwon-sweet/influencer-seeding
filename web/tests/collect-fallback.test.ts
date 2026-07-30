import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFallback, formatFallback } from "../lib/collect-fallback.ts";

test("정상 수집된 날은 폴백 안 함(중복수집·Apify 비용 0)", () => {
  const d = decideFallback(463); // 2026-07-29 복구 후 실측값
  assert.equal(d.act, false);
  assert.equal(d.reason, "already_collected");
  assert.match(formatFallback(d, "2026-07-29", false), /폴백 불필요/);
});

test("2026-07-30 사고 재현: 자동행 5건뿐이면 폴백 수집 시작", () => {
  const d = decideFallback(5); // 스케줄 3회 실패 직후 실측값
  assert.equal(d.act, true);
  assert.equal(d.reason, "missing_rows");
  assert.match(formatFallback(d, "2026-07-29", false, true), /Apify 폴백 수집 시작/);
});

test("임계값 경계: 기본 100 기준 99는 수집, 100은 미수집", () => {
  assert.equal(decideFallback(99).act, true);
  assert.equal(decideFallback(100).act, false);
});

test("DB 조회 이상(음수/NaN)이면 함부로 수집하지 않고 보류", () => {
  for (const bad of [-1, Number.NaN]) {
    const d = decideFallback(bad as number);
    assert.equal(d.act, false);
    assert.equal(d.reason, "threshold_unknown");
    assert.match(formatFallback(d, "2026-07-30", false), /폴백 보류/);
  }
});

test("dry-run은 판정만 하고 수집 표현을 쓰지 않는다", () => {
  const msg = formatFallback(decideFallback(0), "2026-07-30", true);
  assert.match(msg, /dry-run/);
  assert.doesNotMatch(msg, /수집 시작/);
});
