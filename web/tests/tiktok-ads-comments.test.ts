import test from "node:test";
import assert from "node:assert/strict";
import { hideTiktokAdCommentForSlackMessage } from "../lib/tiktok-ads-comments.ts";

function supabaseWithAlert(alert: unknown, error: { message?: string } | null = null) {
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: alert, error }; },
  };
  return { from() { return query; } };
}

test("TikTok 광고 댓글 숨김은 라이브 검증값 HIDDEN/BIDDING을 기본 사용", async () => {
  const old = {
    advertiser: process.env.TIKTOK_ADVERTISER_ID,
    token: process.env.TIKTOK_ACCESS_TOKEN,
    operation: process.env.TIKTOK_HIDE_OPERATION,
    adType: process.env.TIKTOK_HIDE_AD_TYPE,
  };
  process.env.TIKTOK_ADVERTISER_ID = "advertiser";
  process.env.TIKTOK_ACCESS_TOKEN = "token";
  delete process.env.TIKTOK_HIDE_OPERATION;
  delete process.env.TIKTOK_HIDE_AD_TYPE;
  let request: { input?: string; init?: RequestInit } = {};
  try {
    const result = await hideTiktokAdCommentForSlackMessage(
      supabaseWithAlert({ source: "tiktok_ads", comment_id: "comment-1" }),
      { channelId: "C1", messageTs: "1.2" },
      async (input, init) => {
        request = { input: String(input), init };
        return new Response(JSON.stringify({ code: 0, message: "OK" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    );
    assert.deepEqual(result, { handled: true, ok: true });
    assert.match(request.input || "", /comment\/status\/update\/$/);
    assert.equal((request.init?.headers as Record<string, string>)["Access-Token"], "token");
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      advertiser_id: "advertiser",
      comment_ids: ["comment-1"],
      operation: "HIDDEN",
      ad_type: "BIDDING",
    });
  } finally {
    if (old.advertiser === undefined) delete process.env.TIKTOK_ADVERTISER_ID;
    else process.env.TIKTOK_ADVERTISER_ID = old.advertiser;
    if (old.token === undefined) delete process.env.TIKTOK_ACCESS_TOKEN;
    else process.env.TIKTOK_ACCESS_TOKEN = old.token;
    if (old.operation === undefined) delete process.env.TIKTOK_HIDE_OPERATION;
    else process.env.TIKTOK_HIDE_OPERATION = old.operation;
    if (old.adType === undefined) delete process.env.TIKTOK_HIDE_AD_TYPE;
    else process.env.TIKTOK_HIDE_AD_TYPE = old.adType;
  }
});

test("TikTok가 숨김을 거절하면 카드 삭제 대신 재시도 가능한 실패를 반환", async () => {
  const oldAdvertiser = process.env.TIKTOK_ADVERTISER_ID;
  const oldToken = process.env.TIKTOK_ACCESS_TOKEN;
  process.env.TIKTOK_ADVERTISER_ID = "advertiser";
  process.env.TIKTOK_ACCESS_TOKEN = "token";
  try {
    const result = await hideTiktokAdCommentForSlackMessage(
      supabaseWithAlert({ source: "tiktok_ads", comment_id: "comment-1" }),
      { channelId: "C1", messageTs: "1.2" },
      async () => new Response(JSON.stringify({ code: 40002, message: "invalid operation" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    assert.deepEqual(result, { handled: true, ok: false, error: "invalid operation" });
  } finally {
    if (oldAdvertiser === undefined) delete process.env.TIKTOK_ADVERTISER_ID;
    else process.env.TIKTOK_ADVERTISER_ID = oldAdvertiser;
    if (oldToken === undefined) delete process.env.TIKTOK_ACCESS_TOKEN;
    else process.env.TIKTOK_ACCESS_TOKEN = oldToken;
  }
});

test("비 TikTok 알림은 플랫폼 API를 호출하지 않음", async () => {
  let called = false;
  const result = await hideTiktokAdCommentForSlackMessage(
    supabaseWithAlert({ source: "meta_ads", comment_id: "comment-1" }),
    { channelId: "C1", messageTs: "1.2" },
    async () => { called = true; throw new Error("must not call"); },
  );
  assert.deepEqual(result, { handled: false, ok: true });
  assert.equal(called, false);
});
