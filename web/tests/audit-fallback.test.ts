import { test } from "node:test";
import assert from "node:assert/strict";
import { countTodaySuccess, decideAuditFallback, formatAuditFallback } from "../lib/audit-fallback.ts";

test("오늘 이미 감사가 성공했으면 폴백 안 함(중복 Slack 0)", () => {
  const d = decideAuditFallback(1);
  assert.equal(d.act, false);
  assert.equal(d.reason, "already_done");
  assert.match(formatAuditFallback(d, "2026-08-03", false), /폴백 불필요/);
});

test("2026-08-03 사고 재현: 오늘 감사 0회면 폴백 실행", () => {
  // 이 날 10:17까지 formula-audit 스케줄이 미발화라 사람이 손으로 dispatch해야 했다.
  const d = decideAuditFallback(0);
  assert.equal(d.act, true);
  assert.equal(d.reason, "missing_today");
  assert.match(formatAuditFallback(d, "2026-08-03", false, true), /폴백 감사 실행/);
});

test("GitHub 조회 실패는 '보류'가 아니라 '실행' — 감사는 읽기 전용이라 미실행 피해가 더 크다", () => {
  for (const bad of [-1, Number.NaN]) {
    const d = decideAuditFallback(bad as number);
    assert.equal(d.act, true, "조회 실패 시 실행해야 함(자정수집 폴백과 정책이 반대)");
    assert.equal(d.reason, "lookup_failed");
    assert.match(formatAuditFallback(d, "2026-08-03", false, true), /안전하게 폴백 감사 실행/);
  }
});

test("dry-run은 판정만 하고 실행 표현을 쓰지 않는다", () => {
  const msg = formatAuditFallback(decideAuditFallback(0), "2026-08-03", true);
  assert.match(msg, /dry-run/);
  assert.doesNotMatch(msg, /폴백 감사 실행\*\*/);
});

test("실행 실패는 조용히 넘기지 않고 사람 확인 요청", () => {
  const msg = formatAuditFallback(decideAuditFallback(0), "2026-08-03", false, false);
  assert.match(msg, /실행 실패/);
});

test("오늘 성공 카운트는 KST 날짜 경계로 센다(어제 13:31 성공이 오늘로 새지 않음)", () => {
  const runs = [
    { updatedAt: "2026-08-02T04:31:00Z", conclusion: "success" }, // KST 08-02 13:31 — 어제
    { updatedAt: "2026-08-03T01:19:00Z", conclusion: "success" }, // KST 08-03 10:19 — 오늘
    { updatedAt: "2026-08-03T01:25:00Z", conclusion: "failure" }, // 오늘이지만 실패
  ];
  assert.equal(countTodaySuccess(runs, "2026-08-03"), 1);
  assert.equal(countTodaySuccess(runs, "2026-08-02"), 1);
});

test("UTC 자정 직전 성공은 KST 다음날로 잡힌다(15:00 UTC = 익일 00:00 KST)", () => {
  const runs = [{ updatedAt: "2026-08-02T15:10:00Z", conclusion: "success" }];
  assert.equal(countTodaySuccess(runs, "2026-08-03"), 1);
  assert.equal(countTodaySuccess(runs, "2026-08-02"), 0);
});
