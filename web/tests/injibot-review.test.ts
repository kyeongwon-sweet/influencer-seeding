import assert from "node:assert/strict";
import test from "node:test";

import { recordFalsePositiveReview } from "../lib/injibot-review.ts";

function mockSupabase(result: unknown, calls: unknown[]) {
  return {
    from(table: string) {
      calls.push(["from", table]);
      return {
        update(values: Record<string, unknown>) {
          calls.push(["update", values]);
          return {
            eq(columnA: string, valueA: string) {
              calls.push(["eq", columnA, valueA]);
              return {
                eq(columnB: string, valueB: string) {
                  calls.push(["eq", columnB, valueB]);
                  return {
                    async select(columns: string) {
                      calls.push(["select", columns]);
                      return result;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("recordFalsePositiveReview updates by Slack channel and ts only", async () => {
  const calls: unknown[] = [];
  const result = await recordFalsePositiveReview(mockSupabase({ data: [{ id: "alert-1" }], error: null }, calls), {
    channelId: "C123",
    messageTs: "1720000000.000100",
    userId: "U456",
    reviewedAt: "2026-07-24T01:00:00.000Z",
  });

  assert.deepEqual(result, { ok: true, matchedRows: 1 });
  assert.deepEqual(calls, [
    ["from", "negative_comment_alerts"],
    [
      "update",
      {
        review_decision: "false_positive",
        reviewed_by: "U456",
        reviewed_at: "2026-07-24T01:00:00.000Z",
      },
    ],
    ["eq", "slack_channel_id", "C123"],
    ["eq", "slack_ts", "1720000000.000100"],
    ["select", "id"],
  ]);
});

test("recordFalsePositiveReview reports no matching alert row", async () => {
  const calls: unknown[] = [];
  const result = await recordFalsePositiveReview(mockSupabase({ data: [], error: null }, calls), {
    channelId: "C123",
    messageTs: "1720000000.000100",
    userId: "U456",
  });

  assert.equal(result.ok, false);
  assert.equal(result.matchedRows, 0);
  assert.equal(result.error, "no matching alert row");
});

test("recordFalsePositiveReview reports Supabase update errors", async () => {
  const calls: unknown[] = [];
  const result = await recordFalsePositiveReview(
    mockSupabase({ data: null, error: { message: "missing review_decision column" } }, calls),
    {
      channelId: "C123",
      messageTs: "1720000000.000100",
      userId: "U456",
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "missing review_decision column");
});
