import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePreCollectSync, preCollectSyncAlert } from "../lib/pre-collect-sync.ts";

// 2026-11-13: 수집 전 신규 등록 동기화(syncNew)를 무조건 먼저. 실패해도 수집은 진행, 경고만.

test("동기화 성공이면 경고 없음", () => {
  const s = parsePreCollectSync({ pre_sync: { ok: true, created: 15, compared: 15, attempt: 1, ms: 4200 } });
  assert.equal(s?.ok, true);
  assert.equal(s?.created, 15);
  assert.equal(preCollectSyncAlert("2026-11-14", s), null);
});

test("동기화 실패면 사유와 함께 경고", () => {
  const s = parsePreCollectSync({ pre_sync: { ok: false, error: "SHEET_LOCKED: 다른 작업", attempt: 2 } });
  const msg = preCollectSyncAlert("2026-11-14", s);
  assert.ok(msg && msg.includes("SHEET_LOCKED") && msg.includes("2026-11-14"));
});

test("pre_sync 미보고(옛 Apps Script·GET)는 판정·경고 안 함", () => {
  assert.equal(parsePreCollectSync(null), null);
  assert.equal(parsePreCollectSync({}), null);
  assert.equal(preCollectSyncAlert("2026-11-14", null), null);
});

test("ok가 true가 아닌 값(문자열 등)은 실패로 본다", () => {
  const s = parsePreCollectSync({ pre_sync: { ok: "true" } });
  assert.equal(s?.ok, false);
  assert.ok(preCollectSyncAlert("2026-11-14", s));
});

test("🔒 Apps Script ensureDailyCollect 는 dispatch 전에 syncNew 를 먼저 돌리고 결과를 넘긴다", () => {
  const gs = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");
  const body = gs.slice(gs.indexOf("function ensureDailyCollect()"), gs.indexOf("function installEnsureDailyCollectTrigger()"));
  const syncAt = body.indexOf("preCollectSyncNew_()");
  const fetchAt = body.indexOf("UrlFetchApp.fetch(CONFIG.ENSURE_DAILY_COLLECT_URL");
  assert.ok(syncAt > 0 && fetchAt > syncAt, "동기화가 dispatch 호출보다 먼저여야 한다");
  assert.ok(body.includes("pre_sync"), "동기화 결과를 서버로 넘겨야 한다");
});

test("🔒 라우트는 pre_sync 실패를 경고만 하고 dispatch를 막지 않는다", () => {
  const src = readFileSync(new URL("../app/api/ops/ensure-daily-collect/route.ts", import.meta.url), "utf8");
  assert.ok(src.includes("preCollectSyncAlert("));
  assert.ok(!/preSync[^\n]*return NextResponse/.test(src), "동기화 실패로 조기 반환 금지");
});
