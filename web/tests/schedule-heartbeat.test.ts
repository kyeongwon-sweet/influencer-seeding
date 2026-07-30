import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCH_TARGETS, evaluateSchedules, formatHeartbeat } from "../lib/schedule-heartbeat.ts";

const NOW = new Date("2026-07-30T02:30:00Z"); // KST 11:30
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

function allFresh(over: Record<string, string | null> = {}): Record<string, string | null> {
  const base: Record<string, string | null> = {};
  for (const t of WATCH_TARGETS) base[t.workflow] = iso(0.5);
  return { ...base, ...over };
}

test("정상 주기 내면 findings 0 · healthy", () => {
  const f = evaluateSchedules(allFresh(), NOW);
  assert.equal(f.length, 0);
  const m = formatHeartbeat(f, "repo");
  assert.ok(m.healthy);
  assert.match(m.text, /✅/);
});

test("2026-07-30 사고 재현: 스케줄 성공 기록 없음 + 주기 초과 동시 검출", () => {
  const f = evaluateSchedules(
    allFresh({ "formula-audit.yml": null, "cron-daily-collect.yml": iso(29.4) }),
    NOW,
  );
  assert.equal(f.length, 2);
  const m = formatHeartbeat(f, "kyeongwon-sweet/influencer-seeding");
  assert.ok(!m.healthy);
  assert.match(m.text, /수식감사.*스케줄 성공 기록 없음/s);
  assert.match(m.text, /자정수집.*29\.4시간 전/s);
  // 이 알림이 GitHub 밖에서 온다는 사실이 본문에 남아야 한다(운영자 오해 방지)
  assert.match(m.text, /GitHub 크론이 죽어도 도착/);
});

test("배너 sync는 3시간 기준 — 2시간은 정상, 4시간은 이상", () => {
  assert.equal(evaluateSchedules(allFresh({ "banner-reach-sync.yml": iso(2) }), NOW).length, 0);
  const f = evaluateSchedules(allFresh({ "banner-reach-sync.yml": iso(4) }), NOW);
  assert.equal(f.length, 1);
  assert.equal(f[0].workflow, "banner-reach-sync.yml");
});

test("일일 크론은 26시간 기준 — 25시간은 정상(스케줄 지연 허용), 27시간은 이상", () => {
  assert.equal(evaluateSchedules(allFresh({ "injibot-daily-report.yml": iso(25) }), NOW).length, 0);
  assert.equal(evaluateSchedules(allFresh({ "injibot-daily-report.yml": iso(27) }), NOW).length, 1);
});

test("감시 대상에 4종 아침 점검이 모두 포함", () => {
  const wfs = WATCH_TARGETS.map((t) => t.workflow);
  for (const need of [
    "cron-daily-collect.yml",      // ① 동기화(수집)
    "banner-reach-sync.yml",       // ① 동기화(배너)
    "formula-audit.yml",           // ③ 수식 전수감사
    "injibot-daily-report.yml",    // ④ 오류 게시글 리포트
  ]) {
    assert.ok(wfs.includes(need), `${need} 누락`);
  }
});
