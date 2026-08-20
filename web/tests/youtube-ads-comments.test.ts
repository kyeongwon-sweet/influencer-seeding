import test from "node:test";
import assert from "node:assert/strict";
import { dispatchYouTubeAdCommentHideForSlackMessage } from "../lib/youtube-ads-comments.ts";

function supabaseWithAlert(alert: unknown, error: { message?: string } | null = null) {
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: alert, error }; },
  };
  return { from() { return query; } };
}

test("YouTube 숨김은 댓글 ID 대신 검증된 Slack DB 식별키만 workflow_dispatch", async () => {
  const old = process.env.GH_DISPATCH_TOKEN;
  process.env.GH_DISPATCH_TOKEN = "dispatch-token";
  let request: { input?: string; init?: RequestInit } = {};
  try {
    const result = await dispatchYouTubeAdCommentHideForSlackMessage(
      supabaseWithAlert({ source: "youtube_ads", platform: "youtube", comment_id: "secret-comment-id" }),
      { channelId: "C1", messageTs: "1.2" },
      async (input, init) => {
        request = { input: String(input), init };
        return new Response(null, { status: 204 });
      },
    );
    assert.deepEqual(result, { handled: true, ok: true, pending: true });
    assert.match(request.input || "", /negative-comment-monitor\/actions\/workflows\/youtube-owner-comment-hide\.yml\/dispatches$/);
    assert.equal((request.init?.headers as Record<string, string>).Authorization, "Bearer dispatch-token");
    const body = JSON.parse(String(request.init?.body));
    assert.deepEqual(body, { ref: "master", inputs: { slack_channel_id: "C1", slack_ts: "1.2", alert_scope: "youtube_ads" } });
    assert.equal(String(request.init?.body).includes("secret-comment-id"), false);
  } finally {
    if (old === undefined) delete process.env.GH_DISPATCH_TOKEN;
    else process.env.GH_DISPATCH_TOKEN = old;
  }
});

test("서명 검증 라우트가 승인한 오가닉 위성 YouTube도 organic scope로 dispatch", async () => {
  const old = process.env.GH_DISPATCH_TOKEN;
  process.env.GH_DISPATCH_TOKEN = "dispatch-token";
  let body: Record<string, unknown> = {};
  try {
    const result = await dispatchYouTubeAdCommentHideForSlackMessage(
      supabaseWithAlert({ source: null, platform: "youtube", comment_id: "secret-organic-id" }),
      { channelId: "C1", messageTs: "2.3", organicSatellite: true },
      async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      },
    );
    assert.deepEqual(result, { handled: true, ok: true, pending: true });
    assert.deepEqual(body, {
      ref: "master",
      inputs: { slack_channel_id: "C1", slack_ts: "2.3", alert_scope: "organic_satellite" },
    });
  } finally {
    if (old === undefined) delete process.env.GH_DISPATCH_TOKEN;
    else process.env.GH_DISPATCH_TOKEN = old;
  }
});

test("오가닉 일반/협찬은 organicSatellite 승인 없이는 dispatch하지 않는다", async () => {
  let called = false;
  const result = await dispatchYouTubeAdCommentHideForSlackMessage(
    supabaseWithAlert({ source: null, platform: "youtube", comment_id: "c1" }),
    { channelId: "C1", messageTs: "2.4" },
    async () => { called = true; throw new Error("must not call"); },
  );
  assert.deepEqual(result, { handled: false, ok: true });
  assert.equal(called, false);
});

test("비 YouTube 알림은 dispatch하지 않고, GitHub 거절은 재시도 가능한 실패", async () => {
  let called = false;
  assert.deepEqual(await dispatchYouTubeAdCommentHideForSlackMessage(
    supabaseWithAlert({ source: "meta_ads", comment_id: "c1" }),
    { channelId: "C1", messageTs: "1.2" },
    async () => { called = true; throw new Error("must not call"); },
  ), { handled: false, ok: true });
  assert.equal(called, false);

  const old = process.env.GH_DISPATCH_TOKEN;
  process.env.GH_DISPATCH_TOKEN = "dispatch-token";
  try {
    const failed = await dispatchYouTubeAdCommentHideForSlackMessage(
      supabaseWithAlert({ source: "youtube_ads", comment_id: "c1" }),
      { channelId: "C1", messageTs: "1.2" },
      async () => new Response(null, { status: 403 }),
    );
    assert.deepEqual(failed, { handled: true, ok: false, error: "GitHub workflow dispatch failed (403)" });
  } finally {
    if (old === undefined) delete process.env.GH_DISPATCH_TOKEN;
    else process.env.GH_DISPATCH_TOKEN = old;
  }
});
