import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const appsScript = readFileSync(new URL("Combined_Sheet_AppsScript.gs", root), "utf8");
const route = readFileSync(new URL("web/app/api/ops/ensure-daily-report/route.ts", root), "utf8");
const workflow = readFileSync(new URL(".github/workflows/daily-increment-report.yml", root), "utf8");
const report = readFileSync(new URL("scripts/notify_increments.py", root), "utf8");

function functionBody(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} 함수가 있어야 한다`);
  assert.ok(end > start, `${name} 다음 ${nextName} 함수가 있어야 한다`);
  return source.slice(start, end);
}

test("리포트 워치독은 미게시일 때 syncAll을 먼저 실행한 뒤 dispatch한다", () => {
  const body = functionBody(appsScript, "ensureDailyReport()", "installEnsureDailyReportTrigger()");
  const probeAt = body.indexOf('requestEnsureDailyReport_("probe=1")');
  const postedGuardAt = body.indexOf("probe.posted === true");
  const syncAt = body.indexOf("runSync_(false)");
  const dispatchAt = body.indexOf("requestEnsureDailyReport_(query)");

  assert.ok(probeAt >= 0 && postedGuardAt > probeAt, "게시 여부를 먼저 조회해야 한다");
  assert.ok(syncAt > postedGuardAt, "이미 게시된 날에는 syncAll을 생략해야 한다");
  assert.ok(dispatchAt > syncAt, "syncAll 완료 뒤에만 dispatch 라우트를 호출해야 한다");
  assert.match(body, /withDocLock_\(function\(\) \{ return runSync_\(false\); \}\)/);
  assert.match(body, /Utilities\.formatDate\(new Date\(\), "Asia\/Seoul", "HH"\)/);
  assert.match(body, /final_retry=/);
  assert.match(body, /sync_ok=/);
});

test("probe 요청은 알림이나 GitHub dispatch 없이 게시 여부만 반환한다", () => {
  const probeAt = route.indexOf("if (probe)");
  const dispatchAt = route.indexOf("dispatchReport(finalRetry)");
  const notifyAt = route.indexOf("await notifyBot(msg)");

  assert.ok(probeAt >= 0);
  assert.ok(dispatchAt > probeAt);
  assert.ok(notifyAt > probeAt);
  const probeBlock = route.slice(probeAt, dispatchAt);
  assert.match(probeBlock, /probe: true/);
  assert.doesNotMatch(probeBlock, /notifyBot|dispatchReport/);
});

test("16시 최종 재시도 표식이 workflow와 담당자 DM까지 전달된다", () => {
  assert.match(route, /inputs: \{ final_retry: finalRetry \? "true" : "false" \}/);
  assert.match(workflow, /final_retry:[\s\S]*?type: boolean[\s\S]*?default: false/);
  assert.match(workflow, /FINAL_RETRY: \$\{\{ github\.event\.inputs\.final_retry == 'true' && '1' \|\| '' \}\}/);
  assert.match(report, /_final_retry = os\.getenv\("FINAL_RETRY"\) == "1"/);
  assert.match(report, /if _final_retry:[\s\S]*?_dest = _uid[\s\S]*?_hist_ch = _open_dm\(token, _uid\)/);
  assert.match(report, /최종 재시도 후 발송 보류/);
  assert.match(report, /final_retry=_final_retry/);
});
