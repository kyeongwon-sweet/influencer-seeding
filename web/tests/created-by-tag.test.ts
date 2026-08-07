import { test } from "node:test";
import assert from "node:assert/strict";
import { tagCreatedBy } from "../lib/created-by.ts";

// 게시물 출처 추적(2026-08-07). 1,870행 중 created_by가 1건만 채워져 있어
// "연동 시트 맨 아래 새 행은 어디서 오나"에 코드를 읽어야 답할 수 있었다.
//
// 지켜야 할 두 가지:
//  1. 기존 값을 절대 덮지 않는다 — 대시보드 추가분(사람 이메일)이 동기화에 지워지면 안 된다.
//  2. 실패해도 throw하지 않는다 — 시트 동기화는 끊기면 안 되는 경로다.

function fakeSupabase(calls: Array<Record<string, unknown>>, opts: { throwOn?: boolean } = {}) {
  return {
    from(table: string) {
      const ctx: Record<string, unknown> = { table };
      const chain = {
        update(patch: Record<string, unknown>) { ctx.patch = patch; return chain; },
        in(col: string, vals: string[]) { ctx.inCol = col; ctx.inVals = vals; return chain; },
        is(col: string, val: unknown) {
          ctx.isCol = col; ctx.isVal = val;
          calls.push(ctx);
          if (opts.throwOn) return Promise.reject(new Error("column created_by does not exist"));
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  } as never;
}

test("빈 칸만 채운다 — is(created_by, null) 조건이 반드시 붙는다", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await tagCreatedBy(fakeSupabase(calls), ["a", "b"], "marketing-sync");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].patch, { created_by: "marketing-sync" });
  assert.equal(calls[0].isCol, "created_by");
  assert.equal(calls[0].isVal, null, "기존 값이 있는 행은 건드리면 안 된다");
  assert.deepEqual(calls[0].inVals, ["a", "b"]);
});

test("id가 없으면 아무 쿼리도 보내지 않는다", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await tagCreatedBy(fakeSupabase(calls), [], "marketing-sync");
  assert.equal(calls.length, 0);
});

test("출처 라벨이 비면 기록하지 않는다(빈 문자열 오염 방지)", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await tagCreatedBy(fakeSupabase(calls), ["a"], "");
  assert.equal(calls.length, 0);
});

test("🔴 실패해도 throw하지 않는다 — 시트 동기화를 끊으면 안 된다", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await assert.doesNotReject(() => tagCreatedBy(fakeSupabase(calls, { throwOn: true }), ["a"], "sheet-bulk"));
});
