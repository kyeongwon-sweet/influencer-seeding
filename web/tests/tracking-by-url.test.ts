import assert from "node:assert/strict";
import test from "node:test";
import { buildTrackingUpdatePlan, mergeTrackingManualFields } from "../lib/tracking-by-url.ts";

test("수동 재개는 ended_at 잠금을 추가하고 종료는 그 잠금만 제거한다", () => {
  assert.deepEqual(mergeTrackingManualFields(["cost"], true), ["cost", "ended_at"]);
  assert.deepEqual(mergeTrackingManualFields(["cost", "ended_at"], false), ["cost"]);
});

test("normalized_key 매칭이 URL fallback보다 우선한다", () => {
  const plan = buildTrackingUpdatePlan(
    [{ url: "https://instagram.com/p/A", key: "ig:A", ended_at: "2026-08-18" }],
    [
      { id: "key-match", url: "https://old.example/A", normalized_key: "ig:A", manual_fields: [] },
      { id: "url-only", url: "https://instagram.com/p/A", normalized_key: "ig:OTHER", manual_fields: [] },
    ],
  );
  assert.deepEqual(plan.groups.flatMap(group => group.ids), ["key-match"]);
  assert.deepEqual(plan.missing, []);
});

test("키가 없거나 매칭되지 않으면 정확한 URL로 fallback한다", () => {
  const plan = buildTrackingUpdatePlan(
    [{ url: "https://example.com/post/1", key: null, ended_at: null }],
    [{ id: "url-match", url: "https://example.com/post/1", manual_fields: ["cost"] }],
  );
  assert.deepEqual(plan.groups, [{
    ended_at: null,
    manual_fields: ["cost", "ended_at"],
    ids: ["url-match"],
  }]);
});

test("같은 게시물이 여러 번 요청되면 마지막 상태가 이긴다", () => {
  const plan = buildTrackingUpdatePlan(
    [
      { url: "https://instagram.com/p/A", key: "ig:A", ended_at: "2026-08-17" },
      { url: "https://instagram.com/reel/A", key: "ig:A", ended_at: null },
    ],
    [{ id: "post-1", url: "https://instagram.com/p/A", normalized_key: "ig:A", manual_fields: ["cost"] }],
  );
  assert.deepEqual(plan.groups, [{
    ended_at: null,
    manual_fields: ["cost", "ended_at"],
    ids: ["post-1"],
  }]);
});

test("manual_fields가 다른 행은 같은 bulk UPDATE로 합치지 않고 미매칭 URL을 보고한다", () => {
  const plan = buildTrackingUpdatePlan(
    [
      { url: "https://example.com/1", key: null, ended_at: "2026-08-18" },
      { url: "https://example.com/2", key: null, ended_at: "2026-08-18" },
      { url: "https://example.com/missing", key: null, ended_at: null },
    ],
    [
      { id: "one", url: "https://example.com/1", manual_fields: ["cost", "ended_at"] },
      { id: "two", url: "https://example.com/2", manual_fields: ["creator", "ended_at"] },
    ],
  );
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.groups.map(group => group.manual_fields), [["cost"], ["creator"]]);
  assert.deepEqual(plan.missing, ["https://example.com/missing"]);
});
