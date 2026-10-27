// 자정 주 수집 시작 판정 — 구글 트리거(00:05~00:35 KST)가 부르는 /api/ops/ensure-daily-collect.
// 2026-10-27 사용자: "최대한 00시 자정 가까이 수집되었으면 좋겠어" (GitHub 예약은 31일 중앙값 +4시간).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FINAL_SNAPSHOT_TAG, decideEnsureCollect, isPrimaryRun, primaryState, type CollectRun } from "../lib/collect-primary.ts";

const K = "2026-10-28"; // 실행일(KST)
const FINAL = `Daily Collect (Vercel 크론 대체) ${FINAL_SNAPSHOT_TAG}`;
const run = (o: Partial<CollectRun>): CollectRun => ({
  event: "schedule", status: "completed", conclusion: "success", created_at: "2026-10-27T15:20:00Z",
  display_title: "Daily Collect (Vercel 크론 대체)", ...o,
});

test("🚨 오늘 밤 주 수집이 없으면 시작한다", () => {
  assert.equal(decideEnsureCollect([], K, 0).action, "dispatch");
});

test("주 수집이 돌고 있거나 끝났으면 다시 시작하지 않는다(Apify 이중 과금·값 덮어쓰기 방지)", () => {
  const running = run({ event: "workflow_dispatch", display_title: FINAL, status: "in_progress", conclusion: null });
  assert.deepEqual(decideEnsureCollect([running], K, 1), { action: "skip", reason: "primary_running", state: "running" });
  const done = run({ event: "workflow_dispatch", display_title: FINAL });
  assert.equal(decideEnsureCollect([done], K, 1).reason, "primary_done");
});

test("00:41 예약이 제때(02:30 전) 떴으면 그것도 주 수집으로 본다 — 01시대 백업 호출이 중복 시작하지 않게", () => {
  const onTime = run({ created_at: "2026-10-27T15:45:00Z" }); // 00:45 KST
  assert.equal(decideEnsureCollect([onTime], K, 1).reason, "primary_done");
  const backupSlot = run({ created_at: "2026-10-27T17:50:00Z" }); // 02:50 KST
  assert.equal(isPrimaryRun(backupSlot, K), false);
});

test("실패·취소된 주 수집만 있으면 다시 시작한다", () => {
  const failed = run({ event: "workflow_dispatch", display_title: FINAL, conclusion: "failure" });
  assert.equal(primaryState([failed], K), "none");
  assert.equal(decideEnsureCollect([failed], K, 1).action, "dispatch");
});

test("어제 날짜 실행은 오늘 주 수집이 아니다", () => {
  const yesterday = run({ event: "workflow_dispatch", display_title: FINAL, created_at: "2026-10-27T14:59:00Z" }); // 23:59 KST 전날
  assert.equal(primaryState([yesterday], K), "none");
});

test("자정 전(22시 이후)에 불리면 절대 시작하지 않는다 — 트리거 시각 오차 방어", () => {
  assert.equal(decideEnsureCollect([], K, 23).reason, "before_midnight");
});

test("실행 목록을 못 읽으면 시작하지 않는다(00:41 예약이 대신 수집)", () => {
  assert.equal(decideEnsureCollect(null, K, 0).reason, "runs_unreadable");
});

test("라우트(TS)와 워크플로(scripts/collect_role.py)의 판정 규칙이 같다", () => {
  const py = readFileSync(join(import.meta.dirname, "../../scripts/collect_role.py"), "utf8");
  assert.match(py, /FINAL_SNAPSHOT_TAG = "\[final_snapshot\]"/);
  assert.match(py, /PRIMARY_SCHEDULE_CUTOFF = \(2, 30\)/);
  const ts = readFileSync(join(import.meta.dirname, "../lib/collect-primary.ts"), "utf8");
  assert.match(ts, /PRIMARY_SCHEDULE_CUTOFF_KST = "02:30"/);
  const wf = readFileSync(join(import.meta.dirname, "../../.github/workflows/cron-daily-collect.yml"), "utf8");
  assert.match(wf, /format\('\{0\} \[final_snapshot\]', github\.workflow\)/);
  const route = readFileSync(join(import.meta.dirname, "../app/api/ops/ensure-daily-collect/route.ts"), "utf8");
  assert.match(route, /inputs: \{ final_snapshot: "true" \}/);
});
