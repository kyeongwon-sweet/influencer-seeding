import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// importStats '바뀐 게시물만 조회수 보내기'(2026-11-17) — 실제 .gs 코드를 가짜 스프레드시트로 여러 날 돌려 검증한다.
// 사용자 조건: ① 잘못된 숫자를 걸러내는 서버 검사가 그대로 돌 것(바뀐 게시물은 이력 전체를 보냄)
//              ② 손으로 적은 조회수가 빠짐없이 대시보드로 갈 것(사람이 고친 행은 반드시 다시 보냄)
const source = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");

function extractFunction(name: string): string {
  const start = source.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} 없음`);
  const end = source.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} 끝 없음`);
  return source.slice(start + 1, end + 3);
}

function extractConstants(): string {
  const start = source.indexOf("const IMPORT_FP_SHEET_NAME_");
  const end = source.indexOf("\nfunction importFpHash_(", start);
  assert.ok(start >= 0 && end > start, "IMPORT_FP 상수 블록 없음");
  return source.slice(start, end + 1);
}

type Cell = unknown;

class FakeRange {
  sheet: FakeSheet;
  row: number;
  col: number;
  numRows: number;
  numCols: number;

  constructor(sheet: FakeSheet, row: number, col: number, numRows: number, numCols: number) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let i = 0; i < this.numRows; i++) {
      const src = this.sheet.cells[this.row - 1 + i] || [];
      const line: Cell[] = [];
      for (let j = 0; j < this.numCols; j++) {
        const value = src[this.col - 1 + j];
        line.push(value === undefined ? "" : value);
      }
      out.push(line);
    }
    return out;
  }

  setValues(values: Cell[][]) {
    assert.equal(values.length, this.numRows, "setValues 행 수");
    if (this.row - 1 + this.numRows > this.sheet.maxRows) {
      throw new Error(`범위가 시트 크기를 넘음: ${this.row + this.numRows - 1} > ${this.sheet.maxRows}`);
    }
    for (let i = 0; i < this.numRows; i++) {
      assert.equal(values[i].length, this.numCols, "setValues 열 수");
      const r = this.row - 1 + i;
      const target = this.sheet.cells[r] || (this.sheet.cells[r] = []);
      for (let j = 0; j < this.numCols; j++) target[this.col - 1 + j] = values[i][j];
    }
    this.sheet.writes++;
    return this;
  }

  setNumberFormat(format: string) {
    this.sheet.formats.push({ row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols, format });
    return this;
  }

  clearContent() {
    for (let i = 0; i < this.numRows; i++) {
      const target = this.sheet.cells[this.row - 1 + i];
      if (!target) continue;
      for (let j = 0; j < this.numCols; j++) target[this.col - 1 + j] = "";
    }
    return this;
  }
}

class FakeSheet {
  hidden = false;
  writes = 0;
  formats: Array<{ row: number; col: number; numRows: number; numCols: number; format: string }> = [];
  parent!: FakeSpreadsheet;
  name: string;
  cells: Cell[][];
  maxRows: number;

  constructor(name: string, cells: Cell[][], maxRows: number) {
    this.name = name;
    this.cells = cells;
    this.maxRows = maxRows;
  }

  getParent() { return this.parent; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after: number, howMany: number) { this.maxRows += howMany; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) {
      if ((this.cells[r] || []).some((v) => v !== "" && v != null)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    for (const row of this.cells) {
      let c = row ? row.length : 0;
      while (c > 0 && (row[c - 1] === "" || row[c - 1] == null)) c--;
      last = Math.max(last, c);
    }
    return last;
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  hideSheet() { this.hidden = true; return this; }
  activate() { this.parent.active = this; return this; }
}

class FakeSpreadsheet {
  sheets: FakeSheet[] = [];
  active: FakeSheet | null = null;
  failSheetLookup = false;

  getSheetByName(name: string) {
    if (this.failSheetLookup) throw new Error("시트 서비스 오류");
    return this.sheets.find((s) => s.name === name) || null;
  }
  insertSheet(name: string, index: number) {
    // 실제 Sheets처럼 새 탭이 활성 탭이 된다. 기본 크기를 작게 둬 행 늘리기 경로도 검증한다.
    const sheet = new FakeSheet(name, [], 3);
    sheet.parent = this;
    this.sheets.splice(index, 0, sheet);
    this.active = sheet;
    return sheet;
  }
  getActiveSheet() { return this.active; }
  getNumSheets() { return this.sheets.length; }
}

const DATE_LABELS = ["11.10", "11.11", "11.12", "11.13", "11.14", "11.15", "11.16", "11.17"];
const FIRST_DATE_COL = 5;
const dateOf = (label: string) => {
  const [m, d] = label.split(".");
  return `2026-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
};
const urlOf = (code: string) => `https://www.instagram.com/p/${code}/`;

type RowSpec = { code: string; posted?: string; channel?: string; account?: string; values?: Record<string, Cell> };
type Payload = { posts: Array<Record<string, unknown>>; stats: Array<{ url: string; measured_at: string; play_count: number }>; client_version: string; source: string };
type ServerResponse = Record<string, unknown>;

function makeWorld(rows: RowSpec[]) {
  const header: Cell[] = ["업로드일", "게시물URL", "채널분류", "계정명", ...DATE_LABELS];
  const toCells = (r: RowSpec): Cell[] => [
    r.posted ?? "2026-11-01",
    urlOf(r.code),
    r.channel ?? "협찬",
    r.account ?? `acct_${r.code}`,
    ...DATE_LABELS.map((label) => (r.values && label in r.values ? r.values[label] : "")),
  ];
  const ss = new FakeSpreadsheet();
  const linked = new FakeSheet("연동", [header, ...rows.map(toCells)], rows.length + 1);
  linked.parent = ss;
  ss.sheets.push(linked);
  ss.active = linked;

  const state = {
    today: "2026-11-16",
    calls: 0,
    failOnCall: -1,
    respond: (_payload: Payload): ServerResponse => ({}),
    payloads: [] as Payload[],
    logs: [] as string[],
    alerts: [] as string[],
  };

  const env: Record<string, unknown> = {
    getSheet_: () => linked,
    buildFieldCols_: () => ({ posted_at: 1, url: 2, channel_type: 3, account_name: 4 }),
    CONFIG: { HEADER_ROW: 1, DATA_START_ROW: 2, STATS_START_YEAR: 2026, STATS_FIRST_COL: FIRST_DATE_COL, KST_TIMEZONE: "Asia/Seoul" },
    parseMonthDay_: (value: unknown) => {
      const m = String(value ?? "").match(/^(\d{1,2})\.(\d{1,2})$/);
      return m ? { mo: Number(m[1]), da: Number(m[2]) } : null;
    },
    safeAlert_: (message: string) => { state.alerts.push(message); },
    todayStr_: () => state.today,
    classifySheetSyncUrl_: (raw: string) => ({ valid: !/invalid/.test(raw), url: raw, changed: false, skipReason: "invalid" }),
    toDateStr_: (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null),
    linkKey_: (url: string) => {
      const m = String(url).match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/);
      return m ? `ig:${m[1]}` : String(url);
    },
    postStats_: (payload: Payload) => {
      state.calls++;
      if (state.calls === state.failOnCall) throw new Error("API 500: 서버 오류");
      state.payloads.push(JSON.parse(JSON.stringify(payload)));
      return Object.assign({
        ok: true,
        inserted: payload.stats.length,
        matched_urls: new Set(payload.stats.map((s) => s.url)).size,
        missing_urls: 0,
        missing_sample: [],
        dropped_sample: [],
      }, state.respond(payload));
    },
    noteExtra_: () => "",
    blankNote_: () => "",
    Logger: { log: (message: unknown) => { state.logs.push(String(message)); } },
    IMPORTSTATS_CLIENT_VERSION: "test-version",
    Utilities: { formatDate: () => "2026-11-16 08:40:00" },
  };

  const names = [
    "toNumber_", "isBeforePostedDate_",
    "importFpHash_", "importFpDatesText_", "importFpDaysBetween_", "importFpReasonText_",
    "readImportFpStore_", "createImportFpSheet_", "writeImportFpStore_",
    "importStatsDeltaSession_", "advanceImportFpAfterExport_", "importStats",
  ];
  const body = `${extractConstants()}\n${names.map(extractFunction).join("\n")}\n`
    + "return { importStats, advanceImportFpAfterExport_, readImportFpStore_, importFpHash_, importFpDatesText_, IMPORT_FP_SHEET_NAME_ };";
  const api = new Function(...Object.keys(env), body)(...Object.values(env)) as {
    importStats: (source?: string) => boolean;
    advanceImportFpAfterExport_: (...args: unknown[]) => Record<string, unknown>;
    readImportFpStore_: (ss: FakeSpreadsheet) => { ok: boolean; reason: string; map: Record<string, { m: string; d: string }>; lastFull: string };
    importFpHash_: (text: string) => string;
    importFpDatesText_: (row: Cell[], dateCols: Array<{ col: number; date: string }>, colBase: number, today: string) => string;
    IMPORT_FP_SHEET_NAME_: string;
  };

  const rowIndexOf = (code: string) => {
    const idx = linked.cells.findIndex((row, i) => i > 0 && row[1] === urlOf(code));
    assert.ok(idx > 0, `행 없음: ${code}`);
    return idx;
  };
  const dateCols = () => DATE_LABELS.map((label, i) => ({ col: FIRST_DATE_COL + i, date: dateOf(label) }));

  const world = {
    ss,
    linked,
    api,
    state,
    setToday(day: string) { state.today = day; },
    setCell(code: string, label: string, value: Cell) {
      linked.cells[rowIndexOf(code)][FIRST_DATE_COL - 1 + DATE_LABELS.indexOf(label)] = value;
    },
    setField(code: string, col: number, value: Cell) {
      linked.cells[rowIndexOf(code)][col - 1] = value;
    },
    deleteRow(code: string) {
      linked.cells.splice(rowIndexOf(code), 1);
      linked.maxRows = linked.cells.length;
    },
    appendRow(spec: RowSpec) {
      linked.cells.push(toCells(spec));
      linked.maxRows = linked.cells.length;
    },
    store() { return api.readImportFpStore_(ss); },
    storeSheet() { return ss.sheets.find((s) => s.name === api.IMPORT_FP_SHEET_NAME_) || null; },
    // "menu"는 메뉴 실행처럼 인자 없이 부른다(실제 메뉴 addItem("…", "importStats")).
    run(src: "daily_auto" | "menu" = "daily_auto") {
      state.payloads = [];
      state.logs = [];
      state.alerts = [];
      state.calls = 0;
      const ok = src === "menu" ? api.importStats() : api.importStats(src);
      const parsed = state.logs.flatMap((line) => {
        try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
      });
      const delta = parsed.find((e) => e.event === "importStats_delta") || {};
      const timing = parsed.find((e) => e.event === "importStats_timing") || {};
      const statsByKey: Record<string, string[]> = {};
      for (const p of state.payloads) {
        for (const s of p.stats) {
          const key = String(env.linkKey_ && (env.linkKey_ as (u: string) => string)(s.url));
          (statsByKey[key] = statsByKey[key] || []).push(`${s.measured_at}=${s.play_count}`);
        }
      }
      const postsSent = state.payloads.flatMap((p) => p.posts.map((post) => String(post.url)));
      return { ok, payloads: state.payloads, statsByKey, postsSent, delta, timing, alerts: [...state.alerts] };
    },
    // exportStats가 DB 값을 날짜칸에 쓰는 장면: 쓰기 직전/직후 블록으로 지문을 당긴 뒤 실제 칸에 반영한다.
    exportWrite(changes: Array<[string, string, Cell]>) {
      const urlRows = linked.cells.slice(1).map((row) => [row[1]]);
      const before = linked.cells.slice(1).map((row) => DATE_LABELS.map((_, i) => {
        const v = row[FIRST_DATE_COL - 1 + i];
        return v === undefined ? "" : v;
      }));
      const after = before.map((row) => row.slice());
      for (const [code, label, value] of changes) {
        after[rowIndexOf(code) - 1][DATE_LABELS.indexOf(label)] = value;
      }
      state.logs = [];
      const result = api.advanceImportFpAfterExport_(linked, urlRows, before, after, dateCols(), FIRST_DATE_COL, state.today);
      for (const [code, label, value] of changes) world.setCell(code, label, value);
      return result;
    },
  };
  return world;
}

function fixtureRows(): RowSpec[] {
  return [
    { code: "A", values: { "11.10": 100, "11.11": 150, "11.12": 150, "11.13": 200 } },
    { code: "B", values: { "11.10": 50, "11.12": 80 } },
    { code: "C", posted: "2026-11-12", values: { "11.10": 999, "11.12": 10, "11.13": 20 } },
    { code: "D", channel: "배너", values: { "11.10": 1000, "11.11": 1000 } },
  ];
}

// 기존(변경 전) importStats가 보내던 것과 같은 조회수 — 업로드 전 날짜 제외, 비배너만 같은 값 연속 생략, 오늘 이후 제외.
const FULL_STATS: Record<string, string[]> = {
  "ig:A": ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200"],
  "ig:B": ["2026-11-10=50", "2026-11-12=80"],
  "ig:C": ["2026-11-12=10", "2026-11-13=20"],
  "ig:D": ["2026-11-10=1000", "2026-11-11=1000"],
};

test("첫 실행(기록 없음)은 지금과 똑같이 전부 보내고, 보낸 기록 탭을 숨김으로 만든다", () => {
  const w = makeWorld(fixtureRows());
  const r = w.run();

  assert.equal(r.ok, true);
  assert.equal(r.delta.mode, "full");
  assert.equal(r.delta.reason, "store_missing");
  assert.equal(r.payloads.length, 1);
  assert.deepEqual(r.postsSent, ["A", "B", "C", "D"].map(urlOf), "게시물 순서는 시트 순서 그대로");
  assert.deepEqual(r.statsByKey, FULL_STATS);
  assert.deepEqual(r.payloads[0].posts[2], { url: urlOf("C"), posted_at: "2026-11-12", account_name: "acct_C", channel_type: "협찬" });
  assert.equal(r.payloads[0].source, "daily_auto");
  assert.equal(r.payloads[0].client_version, "test-version");

  const sheet = w.storeSheet();
  assert.ok(sheet, "보낸 기록 탭 생성");
  assert.equal(sheet!.hidden, true, "숨김 탭");
  assert.equal(w.ss.active, w.linked, "새 탭으로 화면이 넘어가지 않음");
  assert.ok(sheet!.formats.length > 0 && sheet!.formats.every((f) => f.format === "@"), "모든 기록 칸을 글자 서식으로 씀");
  assert.ok(sheet!.formats.some((f) => f.row === 1 && f.col === 1 && f.numCols === 5), "머리글(버전·전체 전송 날짜) 글자 서식");
  assert.ok(sheet!.formats.some((f) => f.row === 2 && f.col === 1 && f.numRows === 4 && f.numCols === 3), "키·지문 칸 글자 서식");
  const store = w.store();
  assert.equal(store.ok, true);
  assert.equal(store.lastFull, "2026-11-16");
  assert.deepEqual(Object.keys(store.map).sort(), ["ig:A", "ig:B", "ig:C", "ig:D"]);
  for (const entry of Object.values(store.map)) {
    assert.match(entry.m, /^h/);
    assert.match(entry.d, /^h/);
  }
  assert.equal(r.delta.store_entries_after, 4);
  assert.match(r.alerts[0], /조회수를 전부 보냈습니다\(보낸 기록 없음\)/);
  assert.equal(r.timing.mode, "full");
  assert.equal(r.timing.stats_to_send, 9);
  assert.equal(r.timing.stats_candidates, 9);
});

test("다음 날 아무것도 안 바뀌면 조회수는 0건 보내고 게시물 정보만 전부 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  const r = w.run();

  assert.equal(r.ok, true);
  assert.equal(r.delta.mode, "delta");
  assert.equal(r.delta.changed_keys, 0);
  assert.equal(r.delta.unchanged_keys, 4);
  assert.deepEqual(r.statsByKey, {});
  assert.deepEqual(r.postsSent, ["A", "B", "C", "D"].map(urlOf), "게시물 정보(시트 정본 필드·종료 처리)는 매일 전부");
  assert.equal(r.delta.stats_sent, 0);
  assert.equal(r.delta.stats_candidates, 9);
  assert.equal(r.delta.store_entries_after, 4);
  assert.match(r.alerts[0], /바뀐 게시물만 조회수를 보냈습니다: 0개 \(안 바뀐 4개는 게시물 정보만 보냄\)/);
});

test("사람이 한 칸을 고치면 그 게시물의 조회수 이력 전체를 보내 서버 검사가 그대로 돈다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setCell("B", "11.13", 90);
  const r = w.run();

  assert.equal(r.delta.mode, "delta");
  assert.equal(r.delta.changed_keys, 1);
  assert.deepEqual(r.statsByKey, { "ig:B": ["2026-11-10=50", "2026-11-12=80", "2026-11-13=90"] });
  assert.equal(r.payloads.length, 2, "조회수 배치와 정보만 배치를 나눔");
  assert.deepEqual(r.payloads[0].posts.map((p) => p.url), [urlOf("B")]);
  assert.deepEqual(r.payloads[1].posts.map((p) => p.url), ["A", "C", "D"].map(urlOf));
  assert.deepEqual(r.payloads[1].stats, [], "정보만 배치엔 조회수 없음");
  assert.equal(r.postsSent.length, 4);

  const again = w.run();
  assert.deepEqual(again.statsByKey, {}, "보낸 뒤엔 다시 안 보냄");
});

test("exportStats가 DB 값을 쓴 행은 기록을 당겨 다시 안 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  const adv = w.exportWrite([["A", "11.14", 250], ["C", "11.14", 30]]);
  assert.equal(adv.status, "OK");
  assert.equal(adv.rows_written, 2);
  assert.equal(adv.advanced, 2);
  assert.equal(adv.mismatched, 0);

  const r = w.run();
  assert.equal(r.delta.mode, "delta");
  assert.deepEqual(r.statsByKey, {}, "DB에서 온 값은 다시 보내지 않음");
});

test("import 뒤 사람이 고친 행은 export가 기록을 당기지 않아 다음 날 반드시 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setCell("A", "11.15", 777); // 사람이 고침(아직 안 보냄)
  const adv = w.exportWrite([["A", "11.14", 260]]); // 같은 행에 DB 값 쓰기
  assert.equal(adv.advanced, 0);
  assert.equal(adv.mismatched, 1);

  const r = w.run();
  assert.deepEqual(r.statsByKey, {
    "ig:A": ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200", "2026-11-14=260", "2026-11-15=777"],
  });
});

test("서버가 경고·격리·누락을 알리면 그 배치의 게시물은 다음 날 다시 보낸다(경고가 매일 이어짐)", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setCell("B", "11.13", 5000);
  w.state.respond = (payload) => (payload.stats.length ? { spike_suspected_warned: 1, spike_suspected_skipped: 1 } : {});
  const first = w.run();
  assert.deepEqual(Object.keys(first.statsByKey), ["ig:B"]);
  assert.equal(first.delta.unsettled_keys, 1);
  assert.equal(first.delta.unsettled_batches, 1);
  assert.equal(first.delta.settled_keys, 0);

  const second = w.run();
  assert.deepEqual(Object.keys(second.statsByKey), ["ig:B"], "경고가 난 게시물은 다시 보냄");

  w.state.respond = () => ({});
  w.run();
  const fourth = w.run();
  assert.deepEqual(fourth.statsByKey, {}, "경고가 사라지면 그때 기록");

  for (const field of ["copy_suspected_warned", "dup_column_skipped", "missing_urls", "non_video_play_rejected", "rejected_invalid_url"]) {
    const v = makeWorld(fixtureRows());
    v.run();
    v.setCell("A", "11.14", 300);
    v.state.respond = (payload) => (payload.stats.length ? { [field]: 1 } : {});
    v.run();
    v.state.respond = () => ({});
    assert.deepEqual(Object.keys(v.run().statsByKey), ["ig:A"], `${field} 다음 날 다시 보냄`);
  }
});

test("정보만 보낸 배치의 서버 경고는 조회수를 보낸 게시물 기록을 막지 않는다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setCell("A", "11.14", 300);
  w.state.respond = (payload) => (payload.stats.length ? {} : { rejected_invalid_url: 1 });
  const r = w.run();
  assert.deepEqual(Object.keys(r.statsByKey), ["ig:A"]);
  assert.equal(r.delta.settled_keys, 1);
  assert.equal(r.delta.unsettled_keys, 0);
  w.state.respond = () => ({});
  assert.deepEqual(w.run().statsByKey, {});
});

test("역행으로 막힌 값(dropped_decrease)은 보낸 것으로 기록한다(주 1회 전체 전송에서 다시 확인)", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setCell("A", "11.14", 120);
  w.state.respond = (payload) => (payload.stats.length ? { dropped_decrease: 1, dropped_sample: [] } : {});
  w.run();
  w.state.respond = () => ({});
  assert.deepEqual(w.run().statsByKey, {});
});

test("중간 배치가 실패하면 성공한 배치만 기록하고 남은 게시물은 다음 실행이 보낸다", () => {
  const rows: RowSpec[] = Array.from({ length: 650 }, (_, i) => ({ code: `P${i}`, values: { "11.10": 10 + i } }));
  const w = makeWorld(rows);
  assert.equal(w.run().ok, true);
  for (let i = 0; i < 350; i++) w.setCell(`P${i}`, "11.11", 1000 + i);
  w.state.failOnCall = 2;
  const failed = w.run();
  assert.equal(failed.ok, false, "실패는 실패로 보고");
  assert.equal(failed.delta.completed, false);
  assert.equal(failed.delta.settled_keys, 300);
  assert.equal(Object.keys(failed.statsByKey).length, 300);

  w.state.failOnCall = -1;
  const retry = w.run();
  assert.equal(retry.delta.mode, "delta");
  assert.deepEqual(Object.keys(retry.statsByKey).sort(), Array.from({ length: 50 }, (_, i) => `ig:P${300 + i}`).sort());
  assert.equal(w.store().lastFull, "2026-11-16", "부분 실패한 delta는 전체 전송 날짜를 바꾸지 않음");
  assert.ok(w.storeSheet()!.maxRows >= 651, "기록 탭 행을 필요한 만큼 늘림");
});

test("전체 전송이 중간에 실패하면 전체 전송 날짜를 남기지 않아 다음 실행도 전부 보낸다", () => {
  const rows: RowSpec[] = Array.from({ length: 650 }, (_, i) => ({ code: `P${i}`, values: { "11.10": 10 + i } }));
  const w = makeWorld(rows);
  w.state.failOnCall = 2;
  assert.equal(w.run().ok, false);
  assert.equal(w.store().lastFull, "");
  w.state.failOnCall = -1;
  const next = w.run();
  assert.equal(next.delta.mode, "full");
  assert.equal(next.delta.reason, "weekly_full");
  assert.equal(Object.keys(next.statsByKey).length, 650);
});

test("마지막 전체 전송 뒤 7일이 되면 다시 전부 보내고, 6일까지는 바뀐 것만 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.setToday("2026-11-13");
  assert.equal(w.run().delta.mode, "full");
  assert.equal(w.store().lastFull, "2026-11-13");
  w.setToday("2026-11-19");
  const sixth = w.run();
  assert.equal(sixth.delta.mode, "delta");
  assert.deepEqual(sixth.statsByKey, {});
  w.setToday("2026-11-20");
  const r = w.run();
  assert.equal(r.delta.mode, "full");
  assert.equal(r.delta.reason, "weekly_full");
  assert.deepEqual(r.statsByKey, FULL_STATS);
  assert.equal(w.store().lastFull, "2026-11-20");
  assert.match(r.alerts[0], /주 1회 전체 확인/);
});

test("메뉴에서 직접 실행하면 지금처럼 전부 보낸다(manual_sheet)", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  const r = w.run("menu");
  assert.equal(r.delta.mode, "full");
  assert.equal(r.delta.reason, "manual_menu");
  assert.equal(r.payloads[0].source, "manual_sheet");
  assert.deepEqual(r.statsByKey, FULL_STATS);
  assert.match(r.alerts[0], /메뉴에서 직접 실행/);
});

test("기록 탭 버전이 다르거나 행이 손상되면 안전하게 다시 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  const sheet = w.storeSheet()!;
  const rowB = sheet.cells.findIndex((row) => row[0] === "ig:B");
  sheet.cells[rowB][2] = "손상"; // 지문이 h로 시작하지 않음
  const damaged = w.run();
  assert.equal(damaged.delta.mode, "delta");
  assert.deepEqual(Object.keys(damaged.statsByKey), ["ig:B"]);

  sheet.cells[0][0] = "other_version";
  const versioned = w.run();
  assert.equal(versioned.delta.mode, "full");
  assert.equal(versioned.delta.reason, "store_version");
  assert.deepEqual(versioned.statsByKey, FULL_STATS);
});

test("빈 날짜열이 새로 생겨도 바뀐 것으로 보지 않는다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.linked.cells[0].push("11.18"); // 미래 빈 열
  for (let i = 1; i < w.linked.cells.length; i++) w.linked.cells[i].push("");
  assert.deepEqual(w.run().statsByKey, {});
});

test("미리 적어 둔 미래 날짜칸은 그 날짜가 오는 날 바뀜으로 잡혀 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setCell("A", "11.17", 300); // 오늘(11/16) 기준 미래
  const today = w.run();
  assert.deepEqual(today.statsByKey, {}, "미래 칸은 지금처럼 보내지 않음");
  w.setToday("2026-11-17");
  const tomorrow = w.run();
  assert.deepEqual(tomorrow.statsByKey, {
    "ig:A": ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200", "2026-11-17=300"],
  });
});

test("업로드일·채널분류가 바뀌면 조회수 전송 규칙이 달라지므로 다시 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.setField("C", 1, "2026-11-09");
  w.setField("D", 3, "협찬");
  const r = w.run();
  assert.deepEqual(r.statsByKey, {
    "ig:C": ["2026-11-10=999", "2026-11-12=10", "2026-11-13=20"],
    "ig:D": ["2026-11-10=1000"],
  });
});

test("같은 게시물이 두 줄이면 두 줄을 합쳐 판단하고, export는 그 게시물 기록을 당기지 않는다", () => {
  const rows = fixtureRows();
  rows.push({ code: "A", posted: "2026-11-01", values: { "11.14": 400 } });
  const w = makeWorld(rows);
  const first = w.run();
  assert.deepEqual(first.statsByKey["ig:A"], ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200", "2026-11-14=400"]);

  w.linked.cells[5][FIRST_DATE_COL - 1 + DATE_LABELS.indexOf("11.15")] = 450; // 두 번째 줄만 고침
  const second = w.run();
  assert.deepEqual(Object.keys(second.statsByKey), ["ig:A"]);

  const adv = w.exportWrite([["B", "11.14", 90]]);
  assert.equal(adv.advanced, 1);
  w.state.logs = [];
  const urlRows = w.linked.cells.slice(1).map((row) => [row[1]]);
  const block = w.linked.cells.slice(1).map((row) => DATE_LABELS.map((_, i) => row[FIRST_DATE_COL - 1 + i] ?? ""));
  const after = block.map((row) => row.slice());
  after[0][DATE_LABELS.indexOf("11.15")] = 210; // 첫 번째 A 줄에 DB 값
  const dupAdv = w.api.advanceImportFpAfterExport_(w.linked, urlRows, block, after,
    DATE_LABELS.map((label, i) => ({ col: FIRST_DATE_COL + i, date: dateOf(label) })), FIRST_DATE_COL, "2026-11-16");
  assert.equal(dupAdv.dup_skipped, 1);
  assert.equal(dupAdv.advanced, 0);
});

test("같은 게시물 두 번째 줄의 업로드일·채널분류만 바뀌어도 다시 보낸다(첫 줄 정보에 안 드러나는 변화)", () => {
  const rows = fixtureRows();
  rows.push({ code: "A", posted: "2026-11-01", channel: "협찬", values: { "11.14": 400, "11.15": 400 } });
  const w = makeWorld(rows);
  const first = w.run();
  assert.deepEqual(first.statsByKey["ig:A"], ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200", "2026-11-14=400"]);

  w.linked.cells[5][2] = "배너"; // 두 번째 A 줄만 배너로 → 같은 값 연속도 보내야 함
  const r = w.run();
  assert.deepEqual(r.statsByKey["ig:A"], ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200", "2026-11-14=400", "2026-11-15=400"]);

  w.linked.cells[5][0] = "2026-11-15"; // 두 번째 A 줄 업로드일만 늦춤 → 11/14 값은 업로드 전이라 빠져야 함
  const r2 = w.run();
  assert.deepEqual(r2.statsByKey["ig:A"], ["2026-11-10=100", "2026-11-11=150", "2026-11-13=200", "2026-11-15=400"]);
});

test("행을 지우면 기록에서도 빠지고, 다시 생기면 새로 보낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.deleteRow("B");
  const afterDelete = w.run();
  assert.equal(afterDelete.delta.store_entries_after, 3);
  assert.deepEqual(Object.keys(w.store().map).sort(), ["ig:A", "ig:C", "ig:D"]);
  const sheet = w.storeSheet()!;
  assert.equal(sheet.getLastRow(), 4, "남은 옛 행은 지움");

  w.appendRow({ code: "B", values: { "11.10": 50, "11.12": 80 } });
  assert.deepEqual(w.run().statsByKey, { "ig:B": ["2026-11-10=50", "2026-11-12=80"] });
});

test("보낼 조회수가 하나도 없으면 지금처럼 아무것도 보내지 않고 기록도 만들지 않는다", () => {
  const w = makeWorld([{ code: "Z", values: {} }]);
  const r = w.run();
  assert.equal(r.ok, true);
  assert.equal(r.payloads.length, 0);
  assert.equal(w.storeSheet(), null);
});

test("export 기록 당기기는 어떤 오류도 밖으로 던지지 않는다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.ss.failSheetLookup = true;
  const adv = w.exportWrite([["A", "11.14", 250]]);
  assert.equal(adv.status, "ERROR");
  assert.match(String(adv.error), /시트 서비스 오류/);
  assert.ok(w.state.logs.some((line) => line.startsWith("importStats_fp_advance ")));
  w.ss.failSheetLookup = false;
  assert.deepEqual(Object.keys(w.run().statsByKey), ["ig:A"], "못 당긴 행은 다시 보냄");
});

test("기록 탭을 못 읽으면 전부 보내고, 기록 저장 실패는 알림에 남기되 성공으로 끝낸다", () => {
  const w = makeWorld(fixtureRows());
  w.run();
  w.ss.failSheetLookup = true;
  const r = w.run();
  assert.equal(r.ok, true);
  assert.equal(r.delta.mode, "full");
  assert.equal(r.delta.reason, "store_read_error");
  assert.deepEqual(r.statsByKey, FULL_STATS);
  assert.match(String(r.delta.store_error), /시트 서비스 오류/);
  assert.match(r.alerts[0], /보낸 기록을 저장하지 못했습니다/);
});

test("지문은 날짜=값 원문에서 만들고 빈칸·미래·글자 없는 칸은 넣지 않는다", () => {
  const w = makeWorld(fixtureRows());
  const cols = [{ col: 1, date: "2026-11-10" }, { col: 2, date: "2026-11-11" }, { col: 3, date: "2026-11-17" }];
  assert.equal(w.api.importFpDatesText_([100, "", 5], cols, 1, "2026-11-16"), "2026-11-10=100;");
  assert.equal(w.api.importFpDatesText_(["1,234", null, ""], cols, 1, "2026-11-17"), "2026-11-10=1234;");
  assert.notEqual(w.api.importFpHash_("2026-11-10=100;"), w.api.importFpHash_("2026-11-10=101;"));
  assert.equal(w.api.importFpHash_("x"), w.api.importFpHash_("x"));
  assert.match(w.api.importFpHash_(""), /^h[0-9a-z]+\.0$/);
});

test("exportStats는 날짜값을 쓴 직후(수식 전용 갱신이 아닐 때만) 기록 당기기를 부른다", () => {
  const start = source.indexOf("function exportStatsWithOptions_(options)");
  const end = source.indexOf("\nfunction ", start + 1);
  const body = source.slice(start, end);
  const writeAt = body.indexOf("dateCellsRewritten += values.length * values[0].length;");
  const callAt = body.indexOf("advanceImportFpAfterExport_(sheet, latestUrlsForDates, latestDateBlock, finalDateBlock, dateCols, firstCol, today);");
  const markAt = body.indexOf('markTiming("dates_written");');
  assert.ok(writeAt > 0 && callAt > writeAt && markAt > callAt, "날짜값 쓰기 → 기록 당기기 → dates_written 순서");
  const guardAt = body.lastIndexOf("if (!formulaOnly) {", callAt);
  assert.ok(guardAt > 0 && guardAt < writeAt, "formulaOnly가 아닐 때만");
});
