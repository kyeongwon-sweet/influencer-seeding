import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = readFileSync(
  new URL("../../.github/workflows/auto-end-reconcile.yml", import.meta.url),
  "utf8",
);
const reconcile = readFileSync(
  new URL("../../scripts/reconcile_auto_end.py", import.meta.url),
  "utf8",
);
const dailyReportWorkflow = readFileSync(
  new URL("../../.github/workflows/injibot-daily-report.yml", import.meta.url),
  "utf8",
);
const dailyReport = readFileSync(
  new URL("../../scripts/daily_collect_report.py", import.meta.url),
  "utf8",
);

test("auto-end reconciliation runs daily before collection in safe end-only mode", () => {
  assert.match(workflow, /^  schedule:\s*\n\s+- cron: "17 15 \* \* \*"/m);
  assert.match(workflow, /github\.event_name.*schedule/);
  assert.match(workflow, /end_only="--end-only"/);
  assert.doesNotMatch(workflow, /end_only=""/);
  assert.match(workflow, /apply_mode="dry-run-end-only"/);
  assert.match(workflow, /target_date=\$\(TZ=Asia\/Seoul date \+%F\)/);
  assert.match(workflow, /group: auto-end-reconcile/);
});

test("scheduled reconciliation preserves manual tracking and never reopens ended posts", () => {
  assert.match(reconcile, /parser\.add_argument\(\s*"--end-only"/);
  assert.match(reconcile, /and not args\.end_only/);
  assert.match(reconcile, /manual_tracked_ids/);
  assert.match(reconcile, /manual_tracked=\(post\["id"\] in manual_tracked_ids\)/);
  assert.match(reconcile, /asset_name/);
  assert.match(reconcile, /manual_fields/);
});

test("an independent daily report warns when auto-end reconciliation silently misses posts", () => {
  assert.match(dailyReportWorkflow, /Check overdue auto-end backlog/);
  assert.match(dailyReportWorkflow, /continue-on-error: true/);
  assert.match(dailyReportWorkflow, /AUTO_END_WATCHDOG_OUTCOME/);
  assert.match(dailyReport, /자동종료 누락 \{count\}건/);
  assert.match(dailyReport, /자동종료 워치독 검사 실패/);
});
