// 게시물 목록 조회의 '재시도 없음' 비대칭 방지 — 행동 계약.
//
// 배경(2026-09-11 실측): 대시보드 배너가 `누락 0페이지 · 게시물 목록도 일부 누락` 으로 떴다.
// 일별 이력은 `fetchPagesWithRetry` 가 실패 페이지를 1회 재시도해 전부 복구했는데(0페이지),
// **게시물 목록만 재시도가 없어** 같은 성격의 일시 오류(타임아웃·순간 5xx)에 바로 잘렸다.
// 그리고 배너 문구는 '증분이 크게 보인다'로 고정돼 있었는데, 게시물이 빠진 경우는 반대로
// 합계가 **작게** 보인다 — 원인과 반대 방향으로 읽히는 안내였다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fetchPageWithRetry, type PageResult } from "../lib/stats-pages.ts";

type Row = { id: string };

const ROUTE = readFileSync(
  join(import.meta.dirname, "../app/api/sponsored-posts/route.ts"), "utf8");
const PAGE_TSX = readFileSync(
  join(import.meta.dirname, "../app/monitoring/page.tsx"), "utf8");

test("일시 오류는 재시도로 복구된다 — 한 번 실패했다고 목록을 자르지 않는다", async () => {
  const calls: number[] = [];
  const fetchPage = async (offset: number): Promise<PageResult<Row>> => {
    calls.push(offset);
    if (calls.length === 1) return { data: null, error: { message: "timeout" } };
    return { data: [{ id: "a" }], error: null };
  };
  const res = await fetchPageWithRetry<Row>(0, fetchPage);
  assert.equal(res.error, null);
  assert.deepEqual(res.data, [{ id: "a" }]);
  assert.equal(calls.length, 2, "재시도가 한 번 있어야 한다");
});

test("재시도까지 실패하면 그때만 잘린 것으로 본다 — 무한 재시도 금지", async () => {
  const calls: number[] = [];
  const fetchPage = async (offset: number): Promise<PageResult<Row>> => {
    calls.push(offset);
    return { data: null, error: { message: "down" } };
  };
  const res = await fetchPageWithRetry<Row>(0, fetchPage);
  assert.ok(res.error, "계속 실패하면 에러를 그대로 돌려줘야 한다");
  assert.equal(calls.length, 2, "재시도는 1회뿐");
});

test("라우트가 게시물 조회에도 재시도 헬퍼를 쓴다", () => {
  assert.match(ROUTE, /fetchPageWithRetry<SponsoredPostRow>/,
    "게시물 페이지네이션이 재시도 없이 바로 break 하면 배너가 다시 뜬다");
  assert.ok(!/error: postsError \} = await supabase/.test(ROUTE),
    "supabase 호출 결과를 재시도 없이 직접 받는 경로가 남아 있다");
});

test("배너 문구가 원인별로 갈린다 — 방향이 반대라 한 문구로 뭉치면 안 된다", () => {
  assert.match(PAGE_TSX, /합계·건수가 실제보다 작게 보일 수 있습니다/,
    "게시물만 누락된 경우의 문구(작게)가 없다");
  assert.match(PAGE_TSX, /증분이 실제보다 크게 보일 수 있습니다/,
    "이력이 누락된 경우의 문구(크게)가 없다");
  assert.match(PAGE_TSX, /증분과 합계가 모두 실제와 다를 수 있습니다/,
    "둘 다 누락된 경우의 문구가 없다");
});

test("게시물만 누락일 때 '증분이 크게'라고 말하지 않는다", () => {
  // 세 갈래 중 '게시물만' 갈래의 본문에 '크게'가 섞이면 원인과 반대로 읽힌다.
  // ⚠️ 표식이 없으면 split 결과가 빈 문자열이 되어 **무조건 통과하는 공허한 검사**가 된다.
  //    (2026-09-15: 실제로 그렇게 짰다가 수정 전 코드가 통과해서 잡았다.) 먼저 존재를 못박는다.
  const MARK = "게시물 목록을 일부 불러오지 못했습니다";
  assert.ok(PAGE_TSX.includes(MARK), "'게시물만 누락' 갈래 자체가 없다");
  const branch = PAGE_TSX.split(MARK)[1].split("새로고침해")[0];
  assert.ok(branch.length > 0, "갈래 본문을 잘라내지 못했다 — 검사가 성립하지 않는다");
  assert.ok(!branch.includes("크게 보일 수 있습니다"),
    "게시물만 빠진 경우는 합계가 작아진다 — '크게'는 틀린 안내다");
});
