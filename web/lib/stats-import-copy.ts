// 시트 → DB 조회수 입력(stats-import)의 '복사 의심' 판정.
//
// 판정: 시트 값이 '다른 게시물의 같은 날짜 값'과 같은 비-라운드 값으로 2일 이상 겹치면 복사로 본다.
//   (2026-07 라밍 카카오 행에 몽글 값이 수동 오입력된 사례 재발 방지. 영상 조회수 ↔ 배너 도달수 교차 복사 포함.)
//
// 🚨 2026-11-20 실측(읽기 전용 재현): 예전 조회는 `.in(날짜들).in(값 100개)`를 정렬·페이지 없이 한 번에 읽었다.
//   PostgREST 서버는 한 응답을 1,000행에서 **에러 없이** 자른다. 시트 묶음 19개 중 18개, 조회 556번 중
//   202번이 잘렸고, 지금 실행 계획은 (measured_at, id) 인덱스 순서라 **가장 최근 날짜가 먼저 잘렸다**.
//   그래서 잡혀야 할 884행 중 638행만 잡았고, 놓친 행의 71%가 최근 한 달 치였다(새 복사값이 들어오는 곳).
//   또 영상↔배너 교차 복사는 원본 게시물이 같은 300개 묶음에 있을 때만 잡혀, 시트 행 순서에 따라 결과가 달랐다.
//
// 그래서 이 모듈은
//   ① 판정에 쓰일 수 있는 값(1,000 이상·100 단위 아님)만, 그 값이 나온 날짜만 조회하고,
//   ② 모든 값을 조회수·도달수 두 칸에서 모두 찾고(교차 복사가 묶음 구성과 무관하게 잡힘),
//   ③ 유일 정렬 키(measured_at, id)로 끝까지 페이지를 넘긴다(중간 실패 시 일부 결과로 판정하지 않음).
//   판정 규칙(최소값·반올림·2일) 자체는 바꾸지 않았다.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "./fetch-all-pages.ts";

export type CopyMetric = "play_count" | "reach_count";

export type CopyCandidate = {
  post_id: string;
  measured_at: string;
  value: number;
  metric: CopyMetric;
};

// ⚠️ 2026-08-13 실측: 최소값 기준이 없을 때 493행이 경고돼 알림이 사실상 무의미해졌다.
//    내용이 `썰박스(틱톡) 06-15=1`, `06-28=14`처럼 한 자리·두 자리였다. 조회수가 그 수준인 게시물끼리
//    같은 숫자를 갖는 건 우연이 아니라 당연하다. scripts/manual_entry_guards.py 에서 실측 튜닝한 기준(112→10건).
export const COPY_MIN_VALUE = 1000;      // 이하는 서로 다른 게시물이 같은 값을 지나가는 게 정상
export const COPY_ROUNDING_EXCLUDE = 100; // 89,000·267,000 같은 반올림 수기값끼리의 우연 일치 배제
export const COPY_MIN_SHARED_DATES = 2;   // 단일 우연 일치는 통과, 같은 타 게시물과 2일 이상 일치만 복사

// 한 요청 URL 크기 상한(값 100개·날짜 150개 ≈ 2.6KB). 결과 행 수와는 무관 — 행은 페이지로 끝까지 받는다.
export const COPY_LOOKUP_VALUE_CHUNK = 100;
export const COPY_LOOKUP_DATE_CHUNK = 150;

// 조회수 값을 배너 도달수에 복사한 사고(2026-08-03 anavocado←박홍)도 잡도록 두 칸 모두에서 찾는다.
export const COPY_LOOKUP_COLUMNS: readonly CopyMetric[] = ["play_count", "reach_count"];

export function isCopyEligibleValue(value: number): boolean {
  return Number.isFinite(value) && value >= COPY_MIN_VALUE && value % COPY_ROUNDING_EXCLUDE !== 0;
}

export type CopyLookup = { column: CopyMetric; dates: string[]; values: number[] };

/**
 * 판정에 실제로 쓰이는 (날짜, 값)만 덮는 조회 계획.
 * 값 묶음마다 그 값들이 나온 날짜만 넣는다 — 후보 (D, V)는 V가 든 묶음의 날짜 목록에 D가 반드시 있으므로
 * 빠지는 조합이 없다(교차 metric 포함). 묶음 순서는 후보 순서를 따른다(결정적).
 */
export function planCopyLookups(candidates: CopyCandidate[]): CopyLookup[] {
  const datesByValue = new Map<number, Set<string>>();
  for (const c of candidates) {
    if (!isCopyEligibleValue(c.value)) continue;
    const date = String(c.measured_at).slice(0, 10);
    let dates = datesByValue.get(c.value);
    if (!dates) { dates = new Set(); datesByValue.set(c.value, dates); }
    dates.add(date);
  }
  const values = [...datesByValue.keys()];
  const lookups: CopyLookup[] = [];
  for (let i = 0; i < values.length; i += COPY_LOOKUP_VALUE_CHUNK) {
    const valueChunk = values.slice(i, i + COPY_LOOKUP_VALUE_CHUNK);
    const dates = [...new Set(valueChunk.flatMap((v) => [...(datesByValue.get(v) ?? [])]))];
    for (let j = 0; j < dates.length; j += COPY_LOOKUP_DATE_CHUNK) {
      const dateChunk = dates.slice(j, j + COPY_LOOKUP_DATE_CHUNK);
      for (const column of COPY_LOOKUP_COLUMNS) lookups.push({ column, dates: dateChunk, values: valueChunk });
    }
  }
  return lookups;
}

/** `${YYYY-MM-DD}|${value}` → 그 날짜에 그 값을 가진 게시물들(두 칸 합산). */
export type CopyValueOwners = Map<string, Set<string>>;

type PageRow = Record<string, unknown>;
type PageResult = { data: PageRow[] | null; error: { message: string } | null };

/**
 * DB에서 후보와 같은 (날짜, 값)을 가진 게시물을 **빠짐없이** 모은다.
 * 조회 하나라도 실패하면 error를 돌려준다 — 잘린 결과로 '복사 없음'을 판정하는 것이 이 버그 자체였다.
 */
export async function loadCopyValueOwners(
  supabase: SupabaseClient,
  candidates: CopyCandidate[],
): Promise<{ owners: CopyValueOwners; error: string | null; lookups: number; rows: number }> {
  const owners: CopyValueOwners = new Map();
  const lookups = planCopyLookups(candidates);
  let rows = 0;
  for (const lookup of lookups) {
    const { data, error } = await fetchAllPages<PageRow>((from, to) => supabase
      .from("post_daily_stats")
      .select(`id, post_id, measured_at, ${lookup.column}`)
      .in("measured_at", lookup.dates)
      .in(lookup.column, lookup.values)
      .order("measured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PageResult>);
    if (error) return { owners: new Map(), error, lookups: lookups.length, rows };
    rows += data.length;
    for (const row of data) {
      const value = Number(row[lookup.column]);
      if (!Number.isFinite(value) || value <= 0) continue;
      const key = `${String(row.measured_at).slice(0, 10)}|${value}`;
      let postIds = owners.get(key);
      if (!postIds) { postIds = new Set(); owners.set(key, postIds); }
      postIds.add(String(row.post_id));
    }
  }
  return { owners, error: null, lookups: lookups.length, rows };
}

export type CopySuspectOptions = {
  /**
   * 같은 게시물·날짜·칸에 DB가 **이미 같은 값**을 갖고 있으면 true(시트↔DB 왕복값).
   * 그런 값은 '2일 이상' 근거로는 세지만 경고·격리하지 않는다 — 저장해도 DB가 바뀌지 않으므로
   * 막을 것이 없고, 매일 같은 경고만 반복해 importStats 지문 정산까지 막았다(2026-11-20 실측:
   * 잡힌 884행 전부가 왕복값, 그 때문에 매일 5,601개 중 약 4,500개를 다시 보냄).
   * 이미 DB에 든 교차복사는 주간 교차복사 스캔(scripts/scan_cross_post_copies.py)이 같은 기준으로 보고한다.
   */
  alreadyStored?: (candidate: CopyCandidate) => boolean;
};

/**
 * 같은 타 게시물과 같은 비-라운드 값이 2일 이상 겹치는 후보를 고른다.
 * 미러 채널도 URL별 독립 측정이므로 예외를 두지 않고, 배너 reach에도 같은 기준을 적용한다.
 * copyKeys: `${metric}|${post_id}|${YYYY-MM-DD}` · copySource: `${metric}|${post_id}` → 처음 찾은 원본 게시물.
 * alreadyStoredMatches: 규칙엔 걸렸지만 DB에 이미 같은 값이라 경고·격리에서 뺀 행 수.
 */
export function findCopySuspects(
  candidates: CopyCandidate[],
  owners: CopyValueOwners,
  options: CopySuspectOptions = {},
): { copyKeys: Set<string>; copySource: Map<string, string>; alreadyStoredMatches: number } {
  const matchDates = new Map<string, Set<string>>(); // `${metric}|${pid}|${other}` → 날짜들
  const storedKeys = new Set<string>(); // DB에 이미 같은 값인 후보 `${metric}|${pid}|${date}`
  for (const r of candidates) {
    if (!isCopyEligibleValue(r.value)) continue;
    const date = String(r.measured_at).slice(0, 10);
    const others = owners.get(`${date}|${r.value}`);
    if (!others) continue;
    if (options.alreadyStored?.(r)) storedKeys.add(`${r.metric}|${r.post_id}|${date}`);
    for (const other of others) {
      if (other === r.post_id) continue;
      const matchKey = `${r.metric}|${r.post_id}|${other}`;
      let dates = matchDates.get(matchKey);
      if (!dates) { dates = new Set(); matchDates.set(matchKey, dates); }
      dates.add(date);
    }
  }

  const copyKeys = new Set<string>();
  const copySource = new Map<string, string>();
  const storedMatchKeys = new Set<string>();
  for (const [matchKey, dates] of matchDates) {
    if (dates.size < COPY_MIN_SHARED_DATES) continue;
    const [metric, pid, other] = matchKey.split("|");
    let flagged = false;
    for (const date of dates) {
      const key = `${metric}|${pid}|${date}`;
      if (storedKeys.has(key)) { storedMatchKeys.add(key); continue; } // 근거로만 쓴다
      copyKeys.add(key);
      flagged = true;
    }
    if (flagged && !copySource.has(`${metric}|${pid}`)) copySource.set(`${metric}|${pid}`, other);
  }
  return { copyKeys, copySource, alreadyStoredMatches: storedMatchKeys.size };
}
