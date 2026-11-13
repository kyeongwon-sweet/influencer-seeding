// DB→시트 3시간 동기화(pullFromDB)가 사람의 시트 편집과 겹쳐도 멈추지 않고, 엉뚱한 칸에 쓰지도 않는다.
// 2026-11-04 18:04 실패 알림: 처음 읽고 3분 뒤 쓰는 사이 사람이 맨 아래에 3행을 넣어(5267→5270)
//   행 수 가드가 쓰기 전체를 취소했다(데이터 손상은 없었고 7분 뒤 재시도 성공).
// 실제 pullFromDB·쓰기 가드 함수를 가짜 시트로 그대로 돌린다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appsScript = readFileSync(join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"), "utf8");
const slice = (from: string, to: string) => {
  const start = appsScript.indexOf(from);
  const end = appsScript.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} 구간을 찾지 못함`);
  return appsScript.slice(start, end);
};
const guardSrc = slice("function assertRowCountStable_(", "// 기본 필터가 켜진 시트에서");
// 2026-11-13: pullFromDB 는 필요한 열만 읽는다(readSelectedColumns_) — 실제 도우미를 그대로 주입.
const selectSrc = slice("function readSelectedColumns_(", "function collectRows_(");
const pullStart = appsScript.indexOf("function currentRowIndexByKey_(");
const pullFnStart = appsScript.indexOf("function pullFromDB()", pullStart);
const pullEnd = appsScript.slice(pullFnStart).search(/\r?\n\}\r?\n/);
assert.ok(pullStart >= 0 && pullEnd > 0, "pullFromDB 구간을 찾지 못함");
const pullSrc = appsScript.slice(pullStart, pullFnStart + pullEnd) + "\n}\n";

// 열: 1 업로드일 · 2 게시물URL · 3 채널명 · 4 캡션. 1행 = 헤더, 데이터는 2행부터.
const COLS = { posted_at: 1, url: 2, account_name: 3, content_summary: 4 };

type Cell = string;
function makeSheet(rows: Cell[][], onFirstBlockRead?: (data: Cell[][]) => void) {
  const data: Cell[][] = [["업로드일", "게시물URL", "채널명", "캡션"], ...rows.map((r) => r.slice())];
  let blockRead = false;
  const sheet = {
    data,
    getFilter: () => null,
    getLastRow: () => {
      for (let i = data.length - 1; i >= 0; i--) if (data[i].some((v) => String(v ?? "") !== "")) return i + 1;
      return 0;
    },
    getLastColumn: () => 4,
    getRange: (row: number, col: number, nr = 1, nc = 1) => ({
      getValues: () => {
        const out = Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => (data[row - 1 + i] ?? [])[col - 1 + j] ?? ""));
        // pullFromDB가 전체 블록을 처음 읽은 '직후' 사람이 편집하는 상황을 만든다.
        if (nc > 1 && !blockRead) { blockRead = true; onFirstBlockRead?.(data); }
        return out;
      },
      setValues: (vals: Cell[][]) => {
        vals.forEach((r, i) => {
          while (data.length < row + i) data.push(["", "", "", ""]);
          r.forEach((v, j) => { data[row - 1 + i][col - 1 + j] = v; });
        });
      },
      clearContent: () => {},
    }),
  };
  return sheet;
}

function runPull(sheet: ReturnType<typeof makeSheet>, posts: Record<string, string>[]) {
  const alerts: string[] = [];
  const fn = new Function(
    "getSheet_", "buildFieldCols_", "CONFIG", "UrlFetchApp", "authHeaders_", "resolveSheetShortLinks_",
    "linkKey_", "classifySheetSyncUrl_", "fmtVal_", "SpreadsheetApp", "ensureNewRowsMetricFormulas_",
    "applyLinkedInputValidationsToRows_", "safeAlert_", "Logger", "shortLinkNote_",
    `var PULL_FROM_DB_LAST_ERROR_ = "";\nvar PULL_FROM_DB_LAST_TIMING_ = null;\n${guardSrc}\n${selectSrc}\n${pullSrc}\nreturn { pullFromDB, lastError: () => PULL_FROM_DB_LAST_ERROR_, lastTiming: () => PULL_FROM_DB_LAST_TIMING_ };`,
  )(
    () => sheet,
    () => COLS,
    { DATA_START_ROW: 2, LIST_API_URL: "x" },
    { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ posts }) }) },
    () => ({}),
    () => ({ unresolved: [] }),
    (u: string) => u.replace(/\/$/, "").split("/").pop(),
    (u: string) => ({ valid: true, url: u }),
    (_f: string, v: unknown) => (v == null ? "" : String(v)),
    { flush: () => {} },
    () => {},
    () => {},
    (m: string) => alerts.push(m),
    { log: () => {} },
    () => "",
  );
  const ok = fn.pullFromDB();
  return { ok, alerts, lastError: fn.lastError(), timing: fn.lastTiming() as Record<string, number> | null };
}

test("pullFromDB 는 단계별 소요시간을 남긴다(느려진 단계를 가르기 위해, 2026-11-13)", () => {
  const sheet = makeSheet([["2026-11-04", u("A1"), "", ""]]);
  const r = runPull(sheet, [{ url: u("A1"), account_name: "acct_a" }, { url: u("N9"), account_name: "new" }]);
  assert.equal(r.ok, true, r.alerts.join("\n"));
  const t = r.timing!;
  for (const k of ["headers_ms", "api_fetch_ms", "short_links_ms", "url_index_ms", "block_read_ms", "match_loop_ms", "fill_write_ms", "append_ms", "total_ms"]) {
    assert.equal(typeof t[k], "number", k);
  }
  assert.equal(t.posts, 2);
  assert.equal(t.added, 1);
  assert.equal(t.filled, 1);
  const stages = Object.keys(t).filter((k) => k.endsWith("_ms") && k !== "total_ms").reduce((n, k) => n + t[k], 0);
  assert.ok(stages <= t.total_ms, "단계 합 ≤ 전체");
});

const u = (id: string) => `https://www.instagram.com/p/${id}/`;

test("🚨 동기화 중 사람이 맨 아래에 행을 넣어도 멈추지 않고, 빈칸은 같은 글 행에 채운다", () => {
  const sheet = makeSheet(
    [["2026-11-04", u("A1"), "", ""], ["2026-11-04", u("B2"), "acct_b", ""]],
    (data) => { data.push(["", u("H1"), "사람입력1", ""], ["", u("H2"), "사람입력2", ""], ["", u("H3"), "사람입력3", ""]); },
  );
  const r = runPull(sheet, [
    { url: u("A1"), account_name: "acct_a", content_summary: "캡션A" },
    { url: u("B2"), account_name: "DB값은무시", content_summary: "캡션B" },
  ]);
  assert.equal(r.ok, true, r.alerts.join("\n"));
  assert.equal(sheet.data[1][2], "acct_a");
  assert.equal(sheet.data[1][3], "캡션A");
  assert.equal(sheet.data[2][2], "acct_b", "채워져 있던 칸은 DB값으로 덮지 않는다");
  assert.equal(sheet.data[2][3], "캡션B");
  assert.deepEqual(sheet.data.slice(3).map((x) => x[2]), ["사람입력1", "사람입력2", "사람입력3"], "사람이 넣은 행은 그대로");
});

test("동기화 중 사람이 같은 빈칸을 먼저 채웠으면 사람 값을 보존한다", () => {
  const sheet = makeSheet([["2026-11-04", u("A1"), "", ""]], (data) => { data[1][3] = "사람이쓴캡션"; });
  const r = runPull(sheet, [{ url: u("A1"), content_summary: "DB캡션" }]);
  assert.equal(r.ok, true);
  assert.equal(sheet.data[1][3], "사람이쓴캡션");
});

test("동기화 중 행이 중간에 끼어들어 밀려도 값은 원래 글 행으로 간다", () => {
  const sheet = makeSheet(
    [["", u("A1"), "", ""], ["", u("B2"), "", ""]],
    (data) => { data.splice(1, 0, ["", u("X9"), "끼어든행", ""]); },
  );
  const r = runPull(sheet, [{ url: u("A1"), content_summary: "캡션A" }, { url: u("B2"), content_summary: "캡션B" }]);
  assert.equal(r.ok, true);
  assert.deepEqual(sheet.data.slice(1).map((x) => [x[1], x[3]]), [[u("X9"), ""], [u("A1"), "캡션A"], [u("B2"), "캡션B"]]);
});

test("새 글 추가: 사람이 넣은 행 아래에 붙이고, 사람이 이미 넣은 같은 글은 두 줄로 만들지 않는다", () => {
  const sheet = makeSheet(
    [["", u("A1"), "a", "c"]],
    (data) => { data.push(["", u("N1"), "사람이먼저넣음", ""], ["", u("H1"), "사람입력", ""]); },
  );
  const r = runPull(sheet, [
    { url: u("A1") },
    { url: u("N1"), account_name: "DB" },
    { url: u("N2"), account_name: "DB새글" },
  ]);
  assert.equal(r.ok, true, r.alerts.join("\n"));
  assert.deepEqual(sheet.data.slice(1).map((x) => x[1]), [u("A1"), u("N1"), u("H1"), u("N2")]);
  assert.equal(sheet.data[4][2], "DB새글");
  assert.match(r.alerts[0], /신규 행 추가: 1건/);
});

test("실패하면 실제 이유를 남긴다(알림에 'returned false'만 오지 않게)", () => {
  const sheet = makeSheet([["", u("A1"), "", ""]]);
  sheet.getRange = () => { throw new Error("가짜 시트 오류"); };
  const r = runPull(sheet, [{ url: u("A1"), content_summary: "x" }]);
  assert.equal(r.ok, false);
  assert.equal(r.lastError, "가짜 시트 오류");
  const attempt = slice("function runDbPullSyncAttempt_(", "function scheduledDbPullSync_(");
  assert.match(attempt, /PULL_FROM_DB_LAST_ERROR_ = "";\s*const ok = pullFromDB\(\);/);
  assert.match(attempt, /"pullFromDB returned false" \+ \(PULL_FROM_DB_LAST_ERROR_ \? " — " \+ PULL_FROM_DB_LAST_ERROR_ : ""\)/);
});

// ── 2026-11-05 09:04: 아침 dailyAuto가 문서 락을 쥐고 있어 SHEET_LOCKED로 조용히 끝났다(알림·재시도 없음) ──
function runAttempt(opts: { lockBusy: boolean; pullThrows?: string; lockWaits?: number; attempt?: number; pending?: object | null; kst?: string; source?: string }) {
  const src = slice("const DB_PULL_SYNC_INTERVAL_HOURS_", "function dbPullSyncWatchdog_(");
  const props: Record<string, string> = {};
  if (opts.pending) props.DB_PULL_SYNC_PENDING_JSON = JSON.stringify(opts.pending);
  const triggers: { handler: string; after: number }[] = [];
  const alerts: Record<string, unknown>[] = [];
  const pullCalls: number[] = [];
  const lockCalls: number[] = [];
  const logs: string[] = [];
  const env = new Function(
    "withAutoWriteGuard_", "withDocLock_", "PropertiesService", "ScriptApp", "UrlFetchApp", "CONFIG", "authHeaders_", "Logger", "pullFromDB", "Utilities",
    `${src}\nreturn { runDbPullSyncAttempt_, dbPullSyncRetry_, notifyDbPullSyncFailure_ };`,
  )(
    (fn: () => unknown) => fn(),
    (fn: () => unknown) => {
      lockCalls.push(1);
      if (opts.lockBusy) throw new Error("SHEET_LOCKED: 다른 작업이 시트를 수정 중입니다.");
      return fn();
    },
    {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
        setProperty: (k: string, v: string) => { props[k] = v; },
        setProperties: (o: Record<string, string>) => Object.assign(props, o),
        deleteProperty: (k: string) => { delete props[k]; },
      }),
    },
    {
      getProjectTriggers: () => triggers.map((t, i) => ({ getHandlerFunction: () => t.handler, i })),
      deleteTrigger: (t: { i: number }) => { triggers.splice(t.i, 1); },
      newTrigger: (handler: string) => {
        const b = { timeBased: () => b, after: (ms: number) => { triggers.push({ handler, after: ms }); return b; }, create: () => {} };
        return b;
      },
    },
    { fetch: (_u: string, o: { payload: string }) => { alerts.push(JSON.parse(o.payload)); return { getResponseCode: () => 200, getContentText: () => "" }; } },
    { DB_SHEET_SYNC_ALERT_URL: "x" },
    () => ({}),
    { log: (m: string) => { logs.push(m); } },
    () => { pullCalls.push(1); if (opts.pullThrows) throw new Error(opts.pullThrows); return true; },
    // 기본은 낮 정기 회차 시각(15:04 KST) — 자정 조용한 시간대 밖.
    { formatDate: (_d: Date, tz: string, fmt: string) => { assert.equal(tz, "Asia/Seoul"); assert.equal(fmt, "HH:mm"); return opts.kst ?? "15:04"; } },
  );
  let result: unknown; let thrown: unknown = null;
  try {
    result = opts.pending ? env.dbPullSyncRetry_() : env.runDbPullSyncAttempt_(opts.source ?? "scheduled", opts.attempt ?? 0, opts.lockWaits ?? 0);
  } catch (e) { thrown = e; }
  return { result, thrown, props, triggers, alerts, pullCalls, lockCalls, logs };
}

test("🚨 락이 바쁘면 조용히 끝나지 않고 15분 뒤 다시 시도한다(알림 없음, 실패 재시도 횟수 보존)", () => {
  const r = runAttempt({ lockBusy: true });
  assert.equal(r.thrown, null);
  assert.deepEqual(r.triggers, [{ handler: "dbPullSyncRetry_", after: 15 * 60 * 1000 }]);
  const pending = JSON.parse(r.props.DB_PULL_SYNC_PENDING_JSON);
  assert.equal(pending.attempt, 0);
  assert.equal(pending.lock_waits, 1);
  assert.equal(r.alerts.length, 0);
});

test("락 대기 재시도는 attempt 0을 그대로 넘긴다(0이 1로 바뀌면 실패 재시도 기회를 잃음)", () => {
  const r = runAttempt({ lockBusy: true, pending: { attempt: 0, lock_waits: 2 } });
  assert.equal(JSON.parse(r.props.DB_PULL_SYNC_PENDING_JSON).lock_waits, 3);
  assert.equal(JSON.parse(r.props.DB_PULL_SYNC_PENDING_JSON).attempt, 0);
});

test("락이 약 1시간(4번) 넘게 바쁘면 알리고 이번 회차는 접는다", () => {
  const r = runAttempt({ lockBusy: true, lockWaits: 4 });
  assert.equal(r.triggers.length, 0);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].status, "LOCK_BUSY");
  assert.equal(r.props.DB_PULL_SYNC_PENDING_JSON, undefined);
});

test("락을 잡은 뒤 난 오류는 기존대로(7분 재시도·알림), 락 대기로 오인하지 않는다", () => {
  const r = runAttempt({ lockBusy: false, pullThrows: "SHEET_LOCKED: 안쪽에서 난 오류" });
  assert.ok(r.thrown);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].status, "ERROR");
  assert.deepEqual(r.triggers.filter((t) => t.handler === "dbPullSyncRetry_"), [{ handler: "dbPullSyncRetry_", after: 7 * 60 * 1000 }]);
});

test("락이 풀려 있으면 정상 실행된다", () => {
  const r = runAttempt({ lockBusy: false });
  assert.equal(r.result, true);
  assert.equal(r.pullCalls.length, 1);
  assert.equal(r.props.DB_PULL_SYNC_LAST_STATUS, "OK");
});

// ── 2026-11-13: 자정 '동기화 → 수집'(00:13 수집 전 syncNew)이 락을 잡도록 00:04 정기 회차는 쉰다 ──
test("🚨 00:04 정기 회차는 락을 잡지 않고 쉰다(재시도·알림 없음 — 다음 03:04 회차에 맡김)", () => {
  const r = runAttempt({ lockBusy: false, kst: "00:04" });
  assert.equal(r.result, true);
  assert.equal(r.lockCalls.length, 0, "문서 락을 잡으면 안 됨");
  assert.equal(r.pullCalls.length, 0);
  assert.equal(r.triggers.length, 0);
  assert.equal(r.alerts.length, 0);
  assert.equal(r.props.DB_PULL_SYNC_LAST_STATUS, undefined, "실행 기록을 건드리지 않음");
  assert.ok(r.logs.some((m) => m.includes("SKIPPED_PRE_COLLECT_WINDOW")));
});

test("조용한 시간대에 뜬 재시도 회차도 쉰다", () => {
  const r = runAttempt({ lockBusy: false, kst: "00:20", pending: { attempt: 0, lock_waits: 1 } });
  assert.equal(r.lockCalls.length, 0);
  assert.equal(r.pullCalls.length, 0);
  assert.equal(r.triggers.length, 0);
});

test("수동 실행은 자정에도 바로 돈다", () => {
  const r = runAttempt({ lockBusy: false, kst: "00:04", source: "manual" });
  assert.equal(r.pullCalls.length, 1);
  assert.equal(r.props.DB_PULL_SYNC_LAST_STATUS, "OK");
});

test("03:04 정기 회차는 평소대로 돈다", () => {
  const r = runAttempt({ lockBusy: false, kst: "03:04" });
  assert.equal(r.pullCalls.length, 1);
  assert.equal(r.props.DB_PULL_SYNC_LAST_STATUS, "OK");
});
