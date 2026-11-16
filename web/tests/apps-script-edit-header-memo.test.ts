// 편집 트리거(onStatusEdit_)는 편집 1번에 제목 줄(1행)을 한 번만 읽는다 — 2026-11-16 "연동 시트가 너무 느려".
// 11-16 오전 실측: 칸 하나 편집에 onStatusEdit_ 20~50초. 원인 = 검사 함수마다 제목 줄을 다시 읽음
//   (findHeaderCol_·buildFieldCols_·getIncrementCol_·linkedDateColumns_·warnDateColumnEdit_, 날짜칸 편집 1번에 15회).
// 실제 .gs 두 파일을 그대로 불러와 가짜 시트로 편집을 흉내 낸다.
//   ① 제목 줄 읽기 횟수: 기억 켬 = 1회, 기억 끔(예전 동작) = 여러 번
//   ② 기억을 켜도 쓰기·규칙·알림·DB 호출·로그가 예전 동작과 완전히 같다(동작 동등성)
//   ③ 기억은 편집 처리 범위 밖으로 새지 않는다(배치 작업은 매번 새로 읽음)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const SOURCE_FILES = ["Combined_Sheet_AppsScript.gs", "apps-script/repair_asset_name_pollution_20260813.gs"];
const SOURCES = SOURCE_FILES.map((f) => readFileSync(join(ROOT, f), "utf8"));
const MAIN = SOURCES[0];

const GID = 1937186871;
const KST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

// KST 날짜 키: 시간대 오프셋을 먼저 더한 뒤 UTC 필드로 읽는다(UTC 날짜 자르기 금지 규칙과 같은 방식).
function kstKey(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
// KST 정오 = 테스트 머신 시간대가 어디든 getMonth()/getDate()로 같은 날짜가 읽힌다.
function kstNoon(offsetDays: number): Date {
  const [y, m, d] = kstKey(Date.now() + offsetDays * DAY_MS).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3));
}

// ── 시트 모양(실제 연동 탭 순서를 따름) ─────────────────────────────────────
// A 업로드일 B 게시물URL C 채널명 D 채널분류 E 소재명 F 상품명 G 비용 H 누적 조회수 I 증분값 J CPV
// K 기획자 L 제작자 M 캡션 N 업체명 O 상태 P~Y 날짜열(오늘 기준 -70 ~ +1일) Z 등록상태
const FIXED_HEADERS = ["업로드일", "게시물URL", "채널명", "채널분류", "소재명", "상품명", "비용", "누적 조회수",
  "증분값", "CPV", "기획자", "제작자", "캡션", "업체명", "상태"];
const DATE_OFFSETS = [-70, -65, -60, -59, -30, -3, -2, -1, 0, 1];
const DATE_COL = (offset: number) => FIXED_HEADERS.length + 1 + DATE_OFFSETS.indexOf(offset);
const COL = { upload: 1, url: 2, asset: 5, product: 6, cost: 7, cum: 8, planner: 11, status: 15 };

function makeGrid(): unknown[][] {
  const header: unknown[] = [...FIXED_HEADERS, ...DATE_OFFSETS.map((o) => kstNoon(o)), "등록상태"];
  const blankDates = () => DATE_OFFSETS.map(() => "" as unknown);
  const row2: unknown[] = [kstNoon(-10), "https://www.instagram.com/p/AAA111/", "채널A", "협찬", "소재A", "ABC바", 100000,
    5000, "", 20, "김바다", "박채현", "캡션A", "업체A", "진행중", ...blankDates(), "2026-11-01"];
  const row3: unknown[] = [kstNoon(-100), "https://www.instagram.com/p/BBB222/", "채널B", "협찬", "소재B", "XYZ바", 50000,
    9000, "", 10, "모현진", "", "캡션B", "업체B", "진행중", ...blankDates(), "2026-08-01"];
  const row4: unknown[] = [kstNoon(-5), "https://www.youtube.com/watch?v=CCC333", "채널C", "온드", "소재C", "ABC바", 0,
    "", "", "", "", "", "", "", "", ...blankDates(), ""];
  // 업로드일 이후 날짜칸만 값이 있다.
  row3[DATE_COL(-70) - 1] = 7000;
  row3[DATE_COL(-30) - 1] = 9000;
  row2[DATE_COL(-3) - 1] = 3000;
  row2[DATE_COL(-2) - 1] = 4000;
  return [header, row2, row3, row4];
}

type Effect = Record<string, unknown>;
const norm = (v: unknown): unknown => (v instanceof Date ? `date:${kstKey(v.getTime())}` : v);

function makeHarness(opts: { memoOff?: boolean; autoWriteActive?: boolean } = {}) {
  const grid = makeGrid();
  const effects: Effect[] = [];
  const logs: string[] = [];
  const stats = { headerReads: 0, lastColCalls: 0, sheetIdCalls: 0 };
  const a1 = (row: number, col: number, nr: number, nc: number) => {
    const letter = (c: number) => { let s = ""; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
    const tl = letter(col) + row;
    return nr === 1 && nc === 1 ? tl : `${tl}:${letter(col + nc - 1)}${row + nr - 1}`;
  };
  const cell = (r: number, c: number) => (grid[r - 1] ?? [])[c - 1] ?? "";
  const put = (r: number, c: number, v: unknown) => {
    while (grid.length < r) grid.push([]);
    grid[r - 1][c - 1] = v;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheet: any = {
    getSheetId: () => { stats.sheetIdCalls++; return GID; },
    getLastColumn: () => { stats.lastColCalls++; return grid[0].length; },
    getLastRow: () => grid.length,
    getMaxRows: () => grid.length + 5,
    getRange: (row: number, col: number, nr = 1, nc = 1) => makeRange(row, col, nr, nc),
  };
  function makeRange(row: number, col: number, nr: number, nc: number) {
    const block = (fn: (r: number, c: number) => unknown) =>
      Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(row + i, col + j)));
    const where = a1(row, col, nr, nc);
    return {
      getSheet: () => sheet,
      getRow: () => row,
      getColumn: () => col,
      getLastRow: () => row + nr - 1,
      getLastColumn: () => col + nc - 1,
      getNumRows: () => nr,
      getNumColumns: () => nc,
      getA1Notation: () => where,
      getValues: () => { if (row === 1) stats.headerReads++; return block(cell); },
      getDisplayValues: () => block((r, c) => String(cell(r, c))),
      getFormulas: () => block(() => ""),
      getValue: () => cell(row, col),
      setValues: (vals: unknown[][]) => {
        effects.push({ op: "setValues", where, vals: vals.map((r) => r.map(norm)) });
        vals.forEach((r, i) => r.forEach((v, j) => put(row + i, col + j, v)));
      },
      setValue: (v: unknown) => { effects.push({ op: "setValue", where, v: norm(v) }); put(row, col, v); },
      setDataValidation: (rule: unknown) => effects.push({ op: "setDataValidation", where, rule }),
      clearDataValidations: () => effects.push({ op: "clearDataValidations", where }),
    };
  }
  const props: Record<string, string> = {
    SHEET_AUTO_WRITE_ACTIVE_UNTIL: opts.autoWriteActive ? String(Date.now() + 60_000) : "0",
    CRON_SECRET: "test-only-secret",
  };
  const SpreadsheetApp = {
    getActive: () => ({ toast: (msg: string, title: string, sec: number) => effects.push({ op: "toast", msg, title, sec }) }),
    getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }),
    flush: () => effects.push({ op: "flush" }),
    newDataValidation: () => {
      const rule: Record<string, unknown> = {};
      const builder = {
        requireFormulaSatisfied: (f: string) => { rule.formula = f; return builder; },
        requireDate: () => { rule.requireDate = true; return builder; },
        setAllowInvalid: (b: boolean) => { rule.allowInvalid = b; return builder; },
        setHelpText: (t: string) => { rule.help = t; return builder; },
        build: () => ({ ...rule }),
      };
      return builder;
    },
  };
  const PropertiesService = {
    getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null, setProperty: (k: string, v: string) => { props[k] = v; } }),
  };
  const UrlFetchApp = {
    fetch: (url: string, o: { payload?: string }) => {
      effects.push({ op: "fetch", url, payload: o.payload });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ updated: 1, missing: [] }) };
    },
  };
  const Utilities = {
    formatDate: (date: Date, tz: string, pattern: string) => {
      assert.equal(pattern, "yyyy-MM-dd");
      const d = new Date(date.getTime() + (tz === "Asia/Seoul" ? KST_OFFSET_MS : 0));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    },
    parseDate: (text: string, tz: string) => {
      const [y, m, d] = text.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d) - (tz === "Asia/Seoul" ? KST_OFFSET_MS : 0));
    },
  };
  const Logger = { log: (m: unknown) => logs.push(String(m)) };

  // Apps Script는 프로젝트의 모든 .gs가 한 전역을 공유한다 → 두 파일을 한 범위에 이어 붙인다.
  // memoOff=true 는 기억 범위를 '그냥 실행'으로 바꿔 예전처럼 검사마다 제목 줄을 새로 읽게 만든다.
  const body = `${SOURCES.join("\n;\n")}
    if (memoOff) withLinkedHeaderMemo_ = function(sheet, sheetId, fn) { return fn({ reads: 0, hits: 0 }); };
    return { onStatusEdit_, findHeaderCol_, getStatusCol_, buildFieldCols_, linkedDateColumns_,
      withLinkedHeaderMemo_, linkedHeaderRow_, currentMemo: function() { return LINKED_HEADER_MEMO_; } };`;
  const gs = new Function("SpreadsheetApp", "PropertiesService", "UrlFetchApp", "Utilities", "Logger", "memoOff", body)(
    SpreadsheetApp, PropertiesService, UrlFetchApp, Utilities, Logger, !!opts.memoOff,
  );

  // onEdit 의미: 값은 이미 바뀐 뒤 트리거가 뜬다.
  function edit(row: number, col: number, values: unknown[][]) {
    values.forEach((r, i) => r.forEach((v, j) => put(row + i, col + j, v)));
    const nr = values.length;
    const nc = values[0].length;
    const e: Record<string, unknown> = { range: makeRange(row, col, nr, nc), source: {} };
    if (nr === 1 && nc === 1) e.value = values[0][0];
    stats.headerReads = 0;
    stats.lastColCalls = 0;
    gs.onStatusEdit_(e);
  }
  const timingLog = () => {
    const line = logs.find((l) => l.startsWith("on_status_edit_timing "));
    return line ? JSON.parse(line.slice("on_status_edit_timing ".length)) as Record<string, unknown> : null;
  };
  return { gs, sheet, grid, effects, logs, stats, edit, timingLog };
}

type Scenario = { name: string; row: number; col: number; values: unknown[][]; expect?: (h: ReturnType<typeof makeHarness>) => void };

const SCENARIOS: Scenario[] = [
  {
    name: "최근 날짜칸에 숫자 1칸(가장 흔한 편집)",
    row: 2, col: DATE_COL(-1), values: [[4500]],
    expect: (h) => {
      const rule = h.effects.find((x) => x.op === "setDataValidation") as { where: string; rule: { formula: string } } | undefined;
      assert.ok(rule, "편집한 날짜칸의 입력 규칙은 계속 다시 씌운다");
      assert.equal(rule.where, `${String.fromCharCode(64 + DATE_COL(-1))}2`);
      assert.match(rule.rule.formula, /TODAY\(\)/);
      assert.equal(h.effects.filter((x) => x.op === "toast").length, 0);
    },
  },
  {
    name: "오늘 날짜칸 입력 → 오늘 열 안내",
    row: 2, col: DATE_COL(0), values: [[5000]],
    expect: (h) => assert.ok(h.effects.some((x) => x.op === "toast" && String(x.title) === "날짜열 안내")),
  },
  {
    name: "60일 창 밖 옛 날짜칸 입력 → 그 칸 규칙만 해제(값은 그대로)",
    row: 3, col: DATE_COL(-65), values: [[8000]],
    expect: (h) => {
      assert.ok(h.effects.some((x) => x.op === "clearDataValidations"));
      assert.equal(h.grid[2][DATE_COL(-65) - 1], 8000);
    },
  },
  {
    name: "상태칸 '종료' → 추적 종료 DB 반영",
    row: 2, col: COL.status, values: [["종료"]],
    expect: (h) => {
      const call = h.effects.find((x) => x.op === "fetch") as { url: string; payload: string } | undefined;
      assert.ok(call, "tracking-by-url 호출");
      assert.match(call.url, /tracking-by-url/);
      assert.equal(JSON.parse(call.payload).rows[0].url, "https://www.instagram.com/p/AAA111/");
      assert.ok(h.effects.some((x) => x.op === "toast" && /상태 DB 반영: 1건/.test(String(x.msg))));
    },
  },
  {
    name: "A:G 2행 붙여넣기(글자 업로드일·잘못된 URL·소재명 파일목록 포함)",
    row: 3, col: 1,
    values: [
      ["2026. 11. 14.", "not-a-url", "채널B", "협찬", "소재B 1. 표지.png", "XYZ바", 50000],
      [kstNoon(-5), "https://www.youtube.com/watch?v=CCC333", "채널C", "온드", "소재C", "abc", "비쌈"],
    ],
    expect: (h) => {
      assert.ok(h.logs.some((l) => l.startsWith("linked_upload_date_edit_normalized ")), "글자 업로드일은 실제 날짜로 정규화");
      assert.ok(h.effects.some((x) => x.op === "toast" && String(x.title) === "⚠️ 입력 규칙 위반"));
      assert.ok(h.effects.some((x) => x.op === "toast" && String(x.title) === "소재명 정리"));
    },
  },
  {
    name: "기획자칸에 영문 → 입력 규칙 경고",
    row: 2, col: COL.planner, values: [["kim"]],
    expect: (h) => assert.ok(h.effects.some((x) => x.op === "toast" && String(x.title) === "⚠️ 입력 규칙 위반")),
  },
];

for (const s of SCENARIOS) {
  test(`편집 동작 동등성 + 제목 줄 1회: ${s.name}`, () => {
    const fast = makeHarness();
    const old = makeHarness({ memoOff: true });
    fast.edit(s.row, s.col, s.values);
    old.edit(s.row, s.col, s.values);

    // ① 제목 줄은 이 편집 처리 동안 1번만 읽는다(예전엔 검사마다 다시 읽음).
    assert.equal(fast.stats.headerReads, 1, "제목 줄 읽기 1회");
    assert.equal(fast.stats.lastColCalls, 1, "getLastColumn 1회");
    assert.ok(old.stats.headerReads > 1, `예전 동작은 여러 번 읽는다(실제 ${old.stats.headerReads}회)`);

    // ② 쓰기·규칙·알림·DB 호출·로그·최종 시트 값이 예전과 완전히 같다.
    assert.deepEqual(fast.effects, old.effects, "부수효과 동일");
    const plainLogs = (h: typeof fast) => h.logs.filter((l) => !l.startsWith("on_status_edit_timing "));
    assert.deepEqual(plainLogs(fast), plainLogs(old), "로그 동일");
    assert.deepEqual(fast.grid.map((r) => r.map(norm)), old.grid.map((r) => r.map(norm)), "시트 값 동일");
    s.expect?.(fast);

    // ③ 단계별 시간 로그(어느 검사가 큰지 실측용).
    const t = fast.timingLog();
    assert.ok(t, "on_status_edit_timing 로그");
    for (const k of ["normalize_ms", "repair_ms", "validate_ms", "sanitize_ms", "heal_ms", "warn_ms", "total_ms"]) {
      assert.equal(typeof t[k], "number", k);
    }
    assert.equal(t.header_reads, 1);
    assert.equal(typeof t.range, "string");
    assert.equal(fast.gs.currentMemo(), null, "편집 처리가 끝나면 기억을 지운다");
  });
}

test("가장 흔한 편집(날짜칸 1칸)은 예전에 제목 줄을 15번 읽었다 → 1번(11-16 진단 근거 고정)", () => {
  const old = makeHarness({ memoOff: true });
  old.edit(2, DATE_COL(-1), [[4500]]);
  assert.equal(old.stats.headerReads, 15);
  const fast = makeHarness();
  fast.edit(2, DATE_COL(-1), [[4500]]);
  assert.equal(fast.stats.headerReads, 1);
  assert.equal(fast.timingLog()?.header_reuses, 14);
});

test("다른 탭 편집·자동쓰기 중 편집은 제목 줄을 읽지 않고 시간 로그도 남기지 않는다", () => {
  const other = makeHarness();
  other.sheet.getSheetId = () => 12345;
  other.edit(2, DATE_COL(-1), [[1]]);
  assert.equal(other.stats.headerReads, 0);
  assert.equal(other.timingLog(), null);
  assert.deepEqual(other.effects, []);

  const guarded = makeHarness({ autoWriteActive: true });
  guarded.edit(2, DATE_COL(-1), [[1]]);
  assert.equal(guarded.stats.headerReads, 0);
  assert.equal(guarded.timingLog(), null);
  assert.ok(guarded.logs.some((l) => l.startsWith("edit_trigger_skipped ")));
});

test("기억은 편집 처리 범위 밖으로 새지 않는다 — 배치 작업은 매번 새로 읽는다", () => {
  const h = makeHarness();
  h.stats.headerReads = 0;
  h.gs.findHeaderCol_(h.sheet, ["상태"]);
  h.gs.buildFieldCols_(h.sheet);
  h.gs.linkedDateColumns_(h.sheet);
  assert.equal(h.stats.headerReads, 3, "범위 밖에서는 기억하지 않음");
  assert.equal(h.gs.currentMemo(), null);

  // 범위 안에서 예외가 나도 기억은 원래대로 돌아간다.
  assert.throws(() => h.gs.withLinkedHeaderMemo_(h.sheet, GID, () => { h.gs.findHeaderCol_(h.sheet, ["상태"]); throw new Error("boom"); }), /boom/);
  assert.equal(h.gs.currentMemo(), null);
});

test("같은 시트 ID의 다른 시트 객체(getSheet_ 경로)도 기억을 재사용하고, 다른 탭은 새로 읽는다", () => {
  const h = makeHarness();
  const sameTabOtherObject = { ...h.sheet };
  const otherTab = { ...h.sheet, getSheetId: () => 999 };
  h.stats.headerReads = 0;
  h.gs.withLinkedHeaderMemo_(h.sheet, GID, () => {
    h.gs.findHeaderCol_(h.sheet, ["상태"]);
    h.gs.findHeaderCol_(sameTabOtherObject, ["상태"]);
    h.gs.findHeaderCol_(otherTab, ["상태"]);
    h.gs.findHeaderCol_(otherTab, ["상태"]);
  });
  assert.equal(h.stats.headerReads, 3, "연동 탭 1번 + 다른 탭은 호출마다 새로");
});

test("제목 줄에 쓰면(등록상태 열 생성) 기억을 지우고 다시 읽는다", () => {
  const h = makeHarness();
  h.grid[0].pop(); // '등록상태' 제목 없음 → getStatusCol_가 새로 만든다
  const result = h.gs.withLinkedHeaderMemo_(h.sheet, GID, () => {
    const before = h.gs.findHeaderCol_(h.sheet, ["등록상태"]);
    const created = h.gs.getStatusCol_(h.sheet);
    const after = h.gs.findHeaderCol_(h.sheet, ["등록상태"]);
    return { before, created, after };
  });
  assert.equal(result.before, null);
  assert.equal(result.after, result.created, "새 제목을 바로 찾는다(낡은 기억 사용 금지)");
});

test("기억한 제목 줄은 복사본으로 돌려준다(호출부가 바꿔도 다음 검사에 영향 없음)", () => {
  const h = makeHarness();
  h.gs.withLinkedHeaderMemo_(h.sheet, GID, () => {
    const first = h.gs.linkedHeaderRow_(h.sheet).headers as unknown[];  // 실제로 읽음
    const reused = h.gs.linkedHeaderRow_(h.sheet).headers as unknown[]; // 기억에서 꺼냄
    first[COL.status - 1] = "망가뜨림1";
    reused[COL.status - 1] = "망가뜨림2";
    assert.equal(h.gs.findHeaderCol_(h.sheet, ["상태"]), COL.status);
  });
  assert.equal(h.stats.headerReads, 1);
});

test("편집 경로의 제목 줄 읽기는 모두 linkedHeaderRow_ 하나로 모인다(소스 계약)", () => {
  const fn = (name: string) => {
    const start = MAIN.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    const next = MAIN.indexOf("\nfunction ", start + 10);
    return MAIN.slice(start, next);
  };
  for (const name of ["buildFieldCols_", "getStatusCol_", "getIncrementCol_", "findHeaderCol_", "linkedDateColumns_", "warnDateColumnEdit_"]) {
    const body = fn(name);
    assert.match(body, /linkedHeaderRow_\(sheet\)/, `${name}는 linkedHeaderRow_로 읽는다`);
    assert.doesNotMatch(body, /getRange\(CONFIG\.HEADER_ROW, 1, 1, lastCol\)/, `${name}가 제목 줄을 직접 다시 읽으면 안 된다`);
  }
  for (const name of ["getStatusCol_", "getTrackingStatusCol_"]) {
    assert.match(fn(name), /setValue\([^)]*\);\s*\n\s*invalidateLinkedHeaderMemo_\(\);/, `${name}: 제목 쓰기 직후 기억 삭제`);
  }
  const edit = fn("onStatusEdit_");
  assert.match(edit, /withLinkedHeaderMemo_\(sheet, sheetId, function\(memo\)/);
  assert.match(edit, /on_status_edit_timing/);
});
