import { test } from "node:test";
import assert from "node:assert/strict";
import { decideEnsure, formatEnsureSummary, needsNotify } from "../lib/ensure-daily-audits.ts";

// 아침 감사 보장(2026-08-07). GitHub cron이 상시 3시간 지연 + 이틀 완전 누락한 실측에서 출발.
// Apps Script(09:40)가 이 판정을 호출해 "오늘 안 돈 것만" 깨운다.

test("오늘 이미 성공했으면 건드리지 않는다(중복 실행 방지)", () => {
  const a = decideEnsure({ workflow: "formula-audit.yml", todaySuccess: 1 });
  assert.equal(a.act, false);
  assert.equal(a.reason, "already_done");
});

test("오늘 성공이 없으면 깨운다", () => {
  const a = decideEnsure({ workflow: "invalid-creator-fields.yml", todaySuccess: 0 });
  assert.equal(a.act, true);
  assert.equal(a.reason, "not_run_today");
});

test("🔴 조회 실패(-1)는 '실행 쪽'으로 기운다", () => {
  // 감사는 읽기 전용이라 중복 실행 피해 < 미실행 피해. audit-fallback과 같은 규약.
  const a = decideEnsure({ workflow: "formula-audit.yml", todaySuccess: -1 });
  assert.equal(a.act, true);
  assert.equal(a.reason, "lookup_failed");
});

test("전부 이미 돌았으면 알림을 보내지 않는다(매일 아침 소음 방지)", () => {
  const actions = [
    decideEnsure({ workflow: "formula-audit.yml", todaySuccess: 1 }),
    decideEnsure({ workflow: "invalid-creator-fields.yml", todaySuccess: 2 }),
  ];
  assert.equal(needsNotify(actions), false);
});

test("하나라도 깨웠으면 알린다 — 스케줄러가 놀았다는 사실 자체가 정보다", () => {
  const actions = [
    decideEnsure({ workflow: "formula-audit.yml", todaySuccess: 1 }),
    decideEnsure({ workflow: "invalid-creator-fields.yml", todaySuccess: 0 }),
  ];
  assert.equal(needsNotify(actions), true);
});

test("요약문이 상태별로 구분된다(성공/실패/dry-run)", () => {
  const skip = decideEnsure({ workflow: "formula-audit.yml", todaySuccess: 3 });
  const woke = { ...decideEnsure({ workflow: "invalid-creator-fields.yml", todaySuccess: 0 }), dispatched: true };
  const failed = { ...decideEnsure({ workflow: "formula-audit.yml", todaySuccess: 0 }), dispatched: false };

  const ok = formatEnsureSummary([skip, woke], "2026-08-07", false);
  assert.match(ok, /✅ formula-audit\.yml/);
  assert.match(ok, /▶️ invalid-creator-fields\.yml.*실행 요청 성공/);

  const bad = formatEnsureSummary([failed], "2026-08-07", false);
  assert.match(bad, /🔴/, "실패는 눈에 띄어야 한다");
  assert.match(bad, /실행 요청 실패/);

  const dry = formatEnsureSummary([{ ...woke, dispatched: undefined }], "2026-08-07", true);
  assert.match(dry, /dry-run/);
  assert.doesNotMatch(dry, /실행 요청 성공/, "dry-run은 실행했다고 말하면 안 된다");
});

test("날짜가 요약문에 들어간다(언제치 감사인지 헷갈리지 않게)", () => {
  const s = formatEnsureSummary([decideEnsure({ workflow: "formula-audit.yml", todaySuccess: 1 })], "2026-08-07", false);
  assert.match(s, /2026-08-07/);
});
