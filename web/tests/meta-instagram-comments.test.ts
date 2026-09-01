import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  extractMetaAdCommentEvents,
  hideMetaAdCommentForSlackMessage,
  resolveMetaAdlessCommentEvents,
  summarizeMetaWebhookPayload,
  verifyMetaWebhookSignature,
} from "../lib/meta-instagram-comments.ts";

test("verifyMetaWebhookSignature accepts only the matching HMAC", () => {
  const raw = JSON.stringify({ object: "instagram" });
  const secret = "app-secret";
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMetaWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyMetaWebhookSignature(raw, signature, "wrong"), false);
});

test("Meta Webhook route bypasses Clerk only because it verifies its own HMAC", () => {
  const middleware = fs.readFileSync(path.resolve(process.cwd(), "middleware.ts"), "utf8");
  assert.match(middleware, /\/api\/meta\/instagram-comments/);
});

test("extractMetaAdCommentEvents keeps ad comments and ignores organic comments", () => {
  const events = extractMetaAdCommentEvents({
    object: "instagram",
    entry: [{
      id: "ig-user-1",
      time: 1785800000,
      changes: [
        { field: "comments", value: { comment_id: "c1", text: "광고 별로", from: { username: "u1" }, media: { id: "m1", ad_id: "a1", ad_title: "쫀득바" } } },
        { field: "comments", value: { comment_id: "c2", text: "일반 댓글", from: { username: "u2" }, media: { id: "m2" } } },
      ],
    }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].comment_id, "c1");
  assert.equal(events[0].ad_id, "a1");
  assert.equal(events[0].ig_user_id, "ig-user-1");
});

test("summarizeMetaWebhookPayload reports shape without sensitive values", () => {
  const summary = summarizeMetaWebhookPayload({
    object: "instagram",
    entry: [{
      id: "sensitive-account-id",
      changes: [{
        field: "comments",
        value: {
          id: "sensitive-comment-id",
          text: "sensitive comment text",
          from: { username: "sensitive-user" },
          media: { id: "sensitive-media-id", ad_id: "sensitive-ad-id" },
        },
      }],
    }],
  });

  assert.deepEqual(summary, {
    object: "instagram",
    entryCount: 1,
    changeCount: 1,
    fields: ["comments"],
    valueKeys: ["from", "id", "media", "text"],
    mediaKeys: ["ad_id", "id"],
    commentLikeChanges: 1,
    adTaggedChanges: 1,
  });
  assert.equal(JSON.stringify(summary).includes("sensitive"), false);
});

test("ad-id 없는 dynamic ad 댓글은 creative media 매칭 때만 복원한다", async () => {
  const payload = {
    object: "instagram",
    entry: [{
      id: "ig-user-1",
      time: 1785800000,
      changes: [
        { field: "comments", value: { id: "c-dynamic", text: "별로", media: { id: "m-ad" } } },
        { field: "comments", value: { id: "c-organic", text: "일반", media: { id: "m-organic" } } },
      ],
    }],
  };
  const supabase = mockHideSupabase(
    { data: null, error: null },
    { data: { token: "TOKEN", expires_at: "2099-01-01T00:00:00Z" }, error: null },
  );
  let requestedUrl = "";
  const events = await resolveMetaAdlessCommentEvents(
    supabase,
    payload,
    { adAccountId: "act_1", graphBase: "https://graph.test/v26.0" },
    async (url) => {
      requestedUrl = String(url);
      return ({
      ok: true,
      json: async () => ({
        data: [{ id: "ad-1", name: "인지_소재", creative: { effective_instagram_media_id: "m-ad" } }],
      }),
      }) as Response;
    },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].comment_id, "c-dynamic");
  assert.equal(events[0].ad_id, "ad-1");
  assert.equal(events[0].ad_title, "인지_소재");
  assert.match(requestedUrl, /limit=100/);
  assert.doesNotMatch(requestedUrl, /limit=500/);
});

function mockHideSupabase(alert: unknown, token: unknown) {
  return {
    from(table: string) {
      const result = table === "negative_comment_alerts" ? alert : token;
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { async maybeSingle() { return result; } };
                },
                async maybeSingle() { return result; },
              };
            },
          };
        },
      };
    },
  };
}

test("hideMetaAdCommentForSlackMessage hides only DB-backed Meta alerts", async () => {
  let called = "";
  const supabase = mockHideSupabase(
    { data: { source: "meta_ads", comment_id: "comment-1" }, error: null },
    { data: { token: "TOKEN", expires_at: "2099-01-01T00:00:00Z" }, error: null },
  );
  const fetchImpl = async (url: string | URL | Request) => {
    called = String(url);
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
  };
  const result = await hideMetaAdCommentForSlackMessage(
    supabase,
    { channelId: "C1", messageTs: "1.2" },
    fetchImpl,
  );
  assert.deepEqual(result, { handled: true, ok: true });
  assert.match(called, /comment-1\?hide=true$/);
  assert.equal(called.includes("TOKEN"), false);
});

test("hideMetaAdCommentForSlackMessage does not call Meta for non-Meta alerts", async () => {
  const supabase = mockHideSupabase(
    { data: { source: null, comment_id: "comment-1" }, error: null },
    { data: null, error: null },
  );
  const result = await hideMetaAdCommentForSlackMessage(
    supabase,
    { channelId: "C1", messageTs: "1.2" },
    async () => { throw new Error("must not fetch"); },
  );
  assert.deepEqual(result, { handled: false, ok: true });
});
