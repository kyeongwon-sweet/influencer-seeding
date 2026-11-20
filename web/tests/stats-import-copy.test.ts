// stats-import '복사 의심' 조회가 1,000행 상한에서 조용히 잘리지 않는지 — 행동 계약.
//
// 사고(2026-11-18 발견, 11-20 읽기 전용 재현): 복사 판정용 조회가 `.in(날짜들).in(값 100개)`를 정렬·페이지 없이
// 한 번에 읽었다. PostgREST 서버는 한 응답을 1,000행에서 **에러 없이** 자른다. 시트 묶음 19개 중 18개,
// 조회 556번 중 202번이 잘렸고, 실행 계획이 (measured_at, id) 인덱스 순서라 **가장 최근 날짜가 먼저 잘렸다**.
// 잡혀야 할 884행 중 638행만 잡았고, 놓친 행의 71%가 최근 한 달 치(새 복사값이 들어오는 바로 그 날짜)였다.
//
// 아래 가짜 서버는 실제 서버처럼 굴러간다: 한 응답 최대 1,000행, 정렬 없으면 (measured_at, id) 순서로 자름.

import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDate } from "../lib/dateRule.ts";
import {
  COPY_LOOKUP_DATE_CHUNK,
  COPY_LOOKUP_VALUE_CHUNK,
  findCopySuspects,
  isCopyEligibleValue,
  loadCopyValueOwners,
  planCopyLookups,
  type CopyCandidate,
} from "../lib/stats-import-copy.ts";

type StatRow = {
  id: string;
  post_id: string;
  measured_at: string;
  play_count: number | null;
  reach_count: number | null;
};

type RecordedCall = {
  table: string;
  select: string[];
  filters: Array<[string, unknown[]]>;
  orders: string[];
  range: [number, number] | null;
};

const SERVER_MAX_ROWS = 1000;

/** PostgREST처럼 굴러가는 가짜 supabase 클라이언트. 호출 체인을 기록한다. */
function fakePostgrest(table: StatRow[], opts: { failOnCall?: number } = {}) {
  const calls: RecordedCall[] = [];
  const client = {
    from(tableName: string) {
      const call: RecordedCall = { table: tableName, select: [], filters: [], orders: [], range: null };
      const builder = {
        select(columns: string) { call.select = columns.split(",").map((c) => c.trim()); return builder; },
        in(column: string, values: unknown[]) { call.filters.push([column, values]); return builder; },
        order(column: string) { call.orders.push(column); return builder; },
        range(from: number, to: number) { call.range = [from, to]; return builder; },
        then<A, B>(onFulfilled?: (v: unknown) => A, onRejected?: (e: unknown) => B) {
          calls.push(call);
          if (opts.failOnCall === calls.length) {
            return Promise.resolve({ data: null, error: { message: "statement timeout" } }).then(onFulfilled, onRejected);
          }
          const matched = table.filter((row) => call.filters.every(([column, values]) =>
            values.some((v) => String((row as Record<string, unknown>)[column]) === String(v))));
          // ORDER BY가 없으면 서버는 실행 계획 순서로 돌려준다. 운영 계획은 (measured_at, id) 인덱스를 타서
          // 최신 날짜가 맨 뒤 → 1,000행에서 잘릴 때 먼저 사라진다(2026-11-20 실측과 같은 순서).
          const keys = call.orders.length > 0 ? call.orders : ["measured_at", "id"];
          const sorted = [...matched].sort((a, b) => {
            for (const key of keys) {
              const x = String((a as Record<string, unknown>)[key]);
              const y = String((b as Record<string, unknown>)[key]);
              if (x !== y) return x < y ? -1 : 1;
            }
            return 0;
          });
          const [from, to] = call.range ?? [0, Number.MAX_SAFE_INTEGER];
          const page = sorted.slice(from, Math.min(to + 1, from + SERVER_MAX_ROWS)); // 서버 상한은 범위와 무관하게 적용
          const data = page.map((row) => Object.fromEntries(call.select.map((c) => [c, (row as Record<string, unknown>)[c]])));
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

let seq = 0;
function stat(post_id: string, measured_at: string, play_count: number | null, reach_count: number | null = null): StatRow {
  seq += 1;
  return { id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`, post_id, measured_at, play_count, reach_count };
}

function day(n: number): string {
  return `2026-11-${String(n).padStart(2, "0")}`;
}

/**
 * 실제 사고 모양: 대상 게시물의 첫날 값이 다른 게시물 1,200개와 같은 날 겹친다(각자 1일뿐이라 무죄).
 * 진짜 복사 원본은 최근 이틀(11-09·11-10)만 같은 값 → (measured_at, id) 순 앞 1,000행에 못 든다.
 */
function incidentFixture(opts: { newDays?: number[] } = {}) {
  const target = "post-target";
  const source = "post-source";
  const candidates: CopyCandidate[] = [];
  const db: StatRow[] = [];
  for (let d = 1; d <= 10; d += 1) {
    const value = 1_050 + d * 7; // 1,000 이상·100 단위 아님 → 판정 대상
    candidates.push({ post_id: target, measured_at: day(d), value, metric: "play_count" });
    // 대상 자신의 기존 행(왕복 값). newDays 날짜는 시트에 새로 들어와 아직 DB에 없는 값이다.
    if (!opts.newDays?.includes(d)) db.push(stat(target, day(d), value));
  }
  for (let i = 0; i < 1_200; i += 1) db.push(stat(`post-filler-${i}`, day(1), 1_057)); // 첫날 값 우연 일치(1일)
  db.push(stat(source, day(9), 1_050 + 9 * 7));
  db.push(stat(source, day(10), 1_050 + 10 * 7));
  return { target, source, candidates, db };
}

test("사고 재현: 예전 조회(정렬·페이지 없음)는 1,000행에서 잘려 최신 날짜의 복사를 놓친다", async () => {
  const { candidates, db } = incidentFixture();
  const { client } = fakePostgrest(db);
  // 2026-10-13~11-20 운영 코드와 같은 조회 모양. 이 가짜 서버가 실제처럼 자른다는 것을 먼저 고정한다.
  const values = [...new Set(candidates.map((c) => c.value))];
  const dates = [...new Set(candidates.map((c) => c.measured_at))];
  const { data } = await (client
    .from("post_daily_stats")
    .select("post_id, measured_at, play_count")
    .in("measured_at", dates)
    .in("play_count", values) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> }>);
  assert.equal(data.length, SERVER_MAX_ROWS, "서버는 에러 없이 1,000행만 준다");
  const owners = new Map<string, Set<string>>();
  for (const row of data) {
    const key = `${row.measured_at}|${row.play_count}`;
    owners.set(key, (owners.get(key) ?? new Set()).add(String(row.post_id)));
  }
  assert.equal(findCopySuspects(candidates, owners).copyKeys.size, 0, "잘린 결과로는 '복사 없음'으로 보인다 — 이것이 버그");
});

test("1,000행을 넘어도 끝까지 읽어 최신 날짜의 복사를 잡는다", async () => {
  const { target, source, candidates, db } = incidentFixture();
  const { client, calls } = fakePostgrest(db);
  const { owners, error } = await loadCopyValueOwners(client, candidates);
  assert.equal(error, null);
  const { copyKeys, copySource } = findCopySuspects(candidates, owners);
  assert.deepEqual(
    [...copyKeys].sort(),
    [`play_count|${target}|${day(10)}`, `play_count|${target}|${day(9)}`].sort(),
    "원본과 이틀 겹친 최신 두 날짜만 복사 의심이어야 한다(첫날 1일 우연 일치 1,200건은 통과)",
  );
  assert.equal(copySource.get(`play_count|${target}`), source);
  assert.ok(calls.some((c) => c.range && c.range[0] >= SERVER_MAX_ROWS), "1,000행 다음 페이지를 실제로 요청해야 한다");
});

test("모든 조회는 범위를 지정하고 유일 정렬 키(id)로 끝난다 — 페이지 경계 누락·중복 방지", async () => {
  const { candidates, db } = incidentFixture();
  const { client, calls } = fakePostgrest(db);
  await loadCopyValueOwners(client, candidates);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.table, "post_daily_stats");
    assert.ok(call.range, "range 없는 조회는 1,000행에서 조용히 잘린다");
    assert.equal(call.orders.at(-1), "id", `마지막 정렬 키가 유일해야 한다: [${call.orders.join(", ")}]`);
  }
});

test("교차 복사: 배너 도달수가 다른 묶음에 있는 영상 조회수와 이틀 겹치면 잡는다", async () => {
  const banner = "post-banner";
  const video = "post-video-not-in-batch"; // 이번 요청 후보에 없는 게시물(다른 300개 묶음)
  const candidates: CopyCandidate[] = [
    { post_id: banner, measured_at: day(3), value: 48_123, metric: "reach_count" },
    { post_id: banner, measured_at: day(4), value: 49_011, metric: "reach_count" },
  ];
  const db = [
    stat(banner, day(3), null, 48_123),
    stat(banner, day(4), null, 49_011),
    stat(video, day(3), 48_123),
    stat(video, day(4), 49_011),
  ];
  const { client } = fakePostgrest(db);
  const { owners, error } = await loadCopyValueOwners(client, candidates);
  assert.equal(error, null);
  const { copyKeys, copySource } = findCopySuspects(candidates, owners);
  assert.deepEqual([...copyKeys].sort(), [`reach_count|${banner}|${day(3)}`, `reach_count|${banner}|${day(4)}`]);
  assert.equal(copySource.get(`reach_count|${banner}`), video, "원본이 같은 묶음에 없어도 조회수 칸에서 찾아야 한다");
});

test("작은 값·100 단위 값은 조회도 판정도 하지 않는다(2026-08-13 기준 유지)", async () => {
  assert.equal(isCopyEligibleValue(999), false);
  assert.equal(isCopyEligibleValue(1_000), false);
  assert.equal(isCopyEligibleValue(89_000), false);
  assert.equal(isCopyEligibleValue(1_200), false);
  assert.equal(isCopyEligibleValue(1_234), true);
  assert.equal(isCopyEligibleValue(Number.NaN), false);

  const candidates: CopyCandidate[] = [
    { post_id: "a", measured_at: day(1), value: 14, metric: "play_count" },
    { post_id: "a", measured_at: day(2), value: 15, metric: "play_count" },
    { post_id: "a", measured_at: day(3), value: 89_000, metric: "play_count" },
    { post_id: "a", measured_at: day(4), value: 267_000, metric: "play_count" },
  ];
  assert.deepEqual(planCopyLookups(candidates), [], "판정에 못 쓰는 값으로 쿼리 행 수를 불리지 않는다");
  const owners = new Map([
    [`${day(1)}|14`, new Set(["b"])], [`${day(2)}|15`, new Set(["b"])],
    [`${day(3)}|89000`, new Set(["b"])], [`${day(4)}|267000`, new Set(["b"])],
  ]);
  assert.equal(findCopySuspects(candidates, owners).copyKeys.size, 0);
});

/** 라우트와 같은 판단: 같은 게시물·날짜·칸에 DB가 이미 같은 값을 갖고 있으면 왕복값. */
function storedIn(db: StatRow[]) {
  const byKey = new Map(db.map((r) => [`${r.post_id}|${r.measured_at}`, r]));
  return (c: CopyCandidate) => {
    const stored = byKey.get(`${c.post_id}|${c.measured_at}`)?.[c.metric];
    return stored != null && Number(stored) === c.value;
  };
}

test("DB에 이미 같은 값인 일치는 근거로만 쓰고 경고·격리하지 않는다(11/18 위성 왕복값 모양)", () => {
  // 11/18 실제 표본: 이슈뜨기·이슈박스(틱톡) 두 위성 게시물이 같은 수집 회차에서 같은 값을 받았고,
  // 시트는 그 DB 값을 그대로 되돌려 보낸다. 저장해도 DB가 안 바뀌므로 막을 것이 없다.
  const p = "post-issuetteugi";
  const o = "post-issuebox";
  const db = [stat(p, "2026-10-22", 1_056), stat(p, "2026-10-27", 1_097), stat(o, "2026-10-22", 1_056), stat(o, "2026-10-27", 1_097)];
  const candidates: CopyCandidate[] = [
    { post_id: p, measured_at: "2026-10-22", value: 1_056, metric: "play_count" },
    { post_id: p, measured_at: "2026-10-27", value: 1_097, metric: "play_count" },
  ];
  const owners = new Map([["2026-10-22|1056", new Set([p, o])], ["2026-10-27|1097", new Set([p, o])]]);
  const result = findCopySuspects(candidates, owners, { alreadyStored: storedIn(db) });
  assert.equal(result.copyKeys.size, 0, "왕복값만으로는 경고·격리하지 않는다");
  assert.equal(result.alreadyStoredMatches, 2, "근거로는 셌다는 기록이 남아야 한다");
  // 대조: 옵션이 없으면(배포 전 동작) 둘 다 잡혔다 — 옵션이 실제로 결과를 바꾼다는 증거.
  assert.equal(findCopySuspects(candidates, owners).copyKeys.size, 2);
});

test("새로 들어온 복사값은 과거 왕복 일치를 근거로 삼아 잡는다", () => {
  const p = "post-p";
  const o = "post-o";
  const db = [stat(p, "2026-10-22", 1_056), stat(o, "2026-10-22", 1_056), stat(o, "2026-11-19", 2_341)];
  const candidates: CopyCandidate[] = [
    { post_id: p, measured_at: "2026-10-22", value: 1_056, metric: "play_count" }, // 왕복값(근거)
    { post_id: p, measured_at: "2026-11-19", value: 2_341, metric: "play_count" }, // 새 값 — o 의 같은 날 값과 같다
  ];
  const owners = new Map([["2026-10-22|1056", new Set([p, o])], ["2026-11-19|2341", new Set([o])]]);
  const { copyKeys, copySource, alreadyStoredMatches } = findCopySuspects(candidates, owners, { alreadyStored: storedIn(db) });
  assert.deepEqual([...copyKeys], [`play_count|${p}|2026-11-19`], "새 값만 경고·격리 대상");
  assert.equal(copySource.get(`play_count|${p}`), o);
  assert.equal(alreadyStoredMatches, 1);
});

test("새 값이 하루만 겹치고 근거가 없으면 통과한다(1일 우연 일치 규칙 유지)", () => {
  const p = "post-p";
  const o = "post-o";
  const db = [stat(o, "2026-11-19", 2_341)];
  const candidates: CopyCandidate[] = [{ post_id: p, measured_at: "2026-11-19", value: 2_341, metric: "play_count" }];
  const owners = new Map([["2026-11-19|2341", new Set([o])]]);
  assert.equal(findCopySuspects(candidates, owners, { alreadyStored: storedIn(db) }).copyKeys.size, 0);
});

test("1,000행 뒤에 숨은 최신 '새' 복사값을 왕복값 제외와 함께 잡는다", async () => {
  const { target, source, candidates, db } = incidentFixture({ newDays: [9, 10] });
  const { client } = fakePostgrest(db);
  const { owners, error } = await loadCopyValueOwners(client, candidates);
  assert.equal(error, null);
  const { copyKeys, copySource } = findCopySuspects(candidates, owners, { alreadyStored: storedIn(db) });
  assert.deepEqual([...copyKeys].sort(), [`play_count|${target}|${day(10)}`, `play_count|${target}|${day(9)}`].sort());
  assert.equal(copySource.get(`play_count|${target}`), source);
});

test("조회가 중간에 실패하면 일부 결과로 판정하지 않고 에러를 돌려준다", async () => {
  const { candidates, db } = incidentFixture();
  const { client } = fakePostgrest(db, { failOnCall: 2 });
  const { owners, error } = await loadCopyValueOwners(client, candidates);
  assert.equal(error, "statement timeout");
  assert.equal(owners.size, 0, "잘린 결과로 '복사 없음'을 판정하는 것이 이 버그 자체였다");
});

test("조회 계획은 값·날짜 묶음 크기 상한을 지키고, 모든 후보 (날짜, 값)을 두 칸에서 덮는다", () => {
  const candidates: CopyCandidate[] = [];
  for (let i = 0; i < 350; i += 1) {
    const date = `2026-${String(5 + Math.floor(i / 60)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
    candidates.push({ post_id: `p${i % 7}`, measured_at: date, value: 10_001 + i * 3, metric: i % 5 === 0 ? "reach_count" : "play_count" });
  }
  // 한 값이 여러 날짜에 나오는 경우(값 묶음의 날짜 수가 상한을 넘는 경우)도 덮어야 한다.
  for (let d = 1; d <= 200; d += 1) {
    candidates.push({ post_id: "p-wide", measured_at: addDaysToDate("2026-05-01", d), value: 10_001, metric: "play_count" });
  }
  const lookups = planCopyLookups(candidates);
  // URL 길이 상한(값 100개·날짜 150개 ≈ 2.6KB) — 상수를 키워도 이 테스트가 잡도록 숫자로 고정한다.
  assert.equal(COPY_LOOKUP_VALUE_CHUNK, 100);
  assert.equal(COPY_LOOKUP_DATE_CHUNK, 150);
  for (const q of lookups) {
    assert.ok(q.values.length <= 100, `값 ${q.values.length}개 — URL이 너무 길어진다`);
    assert.ok(q.dates.length <= 150, `날짜 ${q.dates.length}개 — URL이 너무 길어진다`);
  }
  const wide = lookups.filter((q) => q.column === "play_count" && q.values.includes(10_001));
  assert.ok(wide.length >= 2, "200개 날짜에 나온 값은 날짜 묶음을 나눠 조회해야 한다");
  for (const c of candidates) {
    if (!isCopyEligibleValue(c.value)) continue; // 예: 10,100은 100 단위라 원래 조회 대상이 아니다
    for (const column of ["play_count", "reach_count"]) {
      assert.ok(
        lookups.some((q) => q.column === column && q.values.includes(c.value) && q.dates.includes(c.measured_at)),
        `${c.measured_at}|${c.value} 를 ${column} 칸에서 찾는 조회가 없다`,
      );
    }
  }
});
