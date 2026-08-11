import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDbSheetSyncAlert } from "../lib/db-sheet-sync-alert.ts";

const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

test("DB→시트 실패 알림 라우트는 Clerk를 우회하되 자체 CRON_SECRET을 검사한다", () => {
  const route = readFileSync(
    new URL("../app/api/ops/db-sheet-sync-alert/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(middleware, /\/api\/ops\/db-sheet-sync-alert\(\.\*\)/);
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
});

test("DB→시트 실패 알림에 상태·재시도·오류를 포함한다", () => {
  const message = formatDbSheetSyncAlert({
    status: "WATCHDOG_TIMEOUT",
    source: "scheduled",
    attempt: 0,
    started_at: "2026-08-11T06:00:00.000Z",
    retry_scheduled: true,
    error: "Exceeded maximum execution time",
  });
  assert.match(message, /DB→모니터링 시트 동기화 실패/);
  assert.match(message, /WATCHDOG_TIMEOUT/);
  assert.match(message, /재시도: 예정/);
  assert.match(message, /Exceeded maximum execution time/);
});

test("알림 오류 문자열은 한 줄·제한 길이로 정리한다", () => {
  const message = formatDbSheetSyncAlert({ error: `first\n${"x".repeat(700)}` });
  assert.doesNotMatch(message, /first\n/);
  assert.ok(message.length < 900);
});
