import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appsScript = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");

function extractFunction(name: string) {
  const start = appsScript.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 없음`);
  const end = appsScript.indexOf("\n}\n", start);
  assert.ok(end >= 0, `${name} 끝 없음`);
  return appsScript.slice(start, end + 3);
}

type ImportPayload = {
  posts: Array<Record<string, unknown>>;
  stats: Array<Record<string, unknown>>;
  client_version: string;
  source: string;
};

type TimingLog = {
  event: string;
  status: string;
  [key: string]: unknown;
};

function runImportStats(dateValue: unknown) {
  const url = "https://www.instagram.com/p/ABC/";
  const header = [["업로드일", "게시물URL", "채널분류", "11.15"]];
  const rows = [["2026-11-01", url, "협찬", dateValue]];
  const logs: string[] = [];
  const alerts: string[] = [];
  const payloads: ImportPayload[] = [];
  const sheet = {
    getLastRow: () => 2,
    getLastColumn: () => 4,
    getRange: (row: number) => ({
      getValues: () => row === 1 ? header : rows,
    }),
  };
  const env = {
    getSheet_: () => sheet,
    buildFieldCols_: () => ({ posted_at: 1, url: 2, channel_type: 3 }),
    CONFIG: { HEADER_ROW: 1, DATA_START_ROW: 2, STATS_START_YEAR: 2026, STATS_FIRST_COL: 4 },
    parseMonthDay_: (value: unknown) => value === "11.15" ? { mo: 11, da: 15 } : null,
    safeAlert_: (message: string) => { alerts.push(message); },
    todayStr_: () => "2026-11-16",
    classifySheetSyncUrl_: (rawUrl: string) => ({ valid: true, url: rawUrl, changed: false }),
    toDateStr_: (value: unknown) => String(value || "") || null,
    linkKey_: () => "ig:ABC",
    toNumber_: (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null,
    isBeforePostedDate_: (date: string, postedAt: string | null) => Boolean(postedAt && date < postedAt),
    postStats_: (payload: ImportPayload) => {
      payloads.push(payload);
      return { inserted: 1, matched_urls: 1, missing_sample: [], dropped_sample: [] };
    },
    noteExtra_: () => "",
    blankNote_: () => "",
    Logger: { log: (message: unknown) => { logs.push(String(message)); } },
    IMPORTSTATS_CLIENT_VERSION: "test-version",
    // '바뀐 게시물만 보내기' 세션은 별도 테스트(apps-script-import-stats-delta)가 실제 코드로 검증한다.
    // 여기서는 기록이 없어 전부 보내는 첫 실행(전체 전송)과 같게 둔다.
    importStatsDeltaSession_: () => ({
      info: { mode: "full", reason: "store_missing", changed_keys: 1, unchanged_keys: 0, store_error: "" },
      addRow: () => {},
      plan: (postByKey: Record<string, unknown>) => Object.keys(postByKey),
      isChanged: () => true,
      settleBatch: () => {},
      save: () => {},
    }),
    importFpReasonText_: () => "보낸 기록 없음",
  };
  const importStats = new Function(
    ...Object.keys(env),
    `${extractFunction("importStats")}\nreturn importStats;`,
  )(...Object.values(env)) as (source?: string) => boolean;

  const ok = importStats("daily_auto");
  const parsed = logs.flatMap((line) => {
    try { return [JSON.parse(line) as TimingLog]; } catch { return []; }
  });
  const timing = parsed.filter((entry) => entry.event === "importStats_timing");
  return { ok, url, alerts, payloads, timing };
}

function assertTimingFields(log: TimingLog) {
  for (const key of ["read_ms", "headers_ms", "block_read_ms", "scan_ms", "group_ms", "post_ms", "total_ms"]) {
    assert.equal(typeof log[key], "number", `${key} 숫자 로그`);
    assert.ok((log[key] as number) >= 0, `${key} 음수 금지`);
  }
  assert.equal(log.read_ms, (log.headers_ms as number) + (log.block_read_ms as number));
}

test("importStats는 READ/SCAN/POST 시간과 처리 건수를 한 번 기록하고 기존 payload를 보존한다", () => {
  const result = runImportStats(123);

  assert.equal(result.ok, true);
  assert.equal(result.timing.length, 1);
  assertTimingFields(result.timing[0]);
  assert.deepEqual(
    Object.fromEntries([
      "event", "status", "rows", "last_col", "date_columns", "date_cells_scanned",
      "stats_to_send", "posts", "batches", "inserted",
    ].map((key) => [key, result.timing[0][key]])),
    {
      event: "importStats_timing",
      status: "OK",
      rows: 1,
      last_col: 4,
      date_columns: 1,
      date_cells_scanned: 1,
      stats_to_send: 1,
      posts: 1,
      batches: 1,
      inserted: 1,
    },
  );
  assert.deepEqual(result.payloads, [{
    posts: [{ url: result.url, posted_at: "2026-11-01", channel_type: "협찬" }],
    stats: [{ url: result.url, measured_at: "2026-11-15", play_count: 123 }],
    client_version: "test-version",
    source: "daily_auto",
  }]);
});

test("importStats는 보낼 통계가 없어도 시간·0건을 기록하고 POST하지 않는다", () => {
  const result = runImportStats("");

  assert.equal(result.ok, true);
  assert.equal(result.timing.length, 1);
  assertTimingFields(result.timing[0]);
  assert.equal(result.timing[0].status, "NO_STATS");
  assert.equal(result.timing[0].rows, 1);
  assert.equal(result.timing[0].date_columns, 1);
  assert.equal(result.timing[0].date_cells_scanned, 1);
  assert.equal(result.timing[0].stats_to_send, 0);
  assert.equal(result.timing[0].posts, 1);
  assert.equal(result.timing[0].batches, 0);
  assert.equal(result.timing[0].inserted, 0);
  assert.equal(result.timing[0].post_ms, 0);
  assert.deepEqual(result.payloads, []);
});
