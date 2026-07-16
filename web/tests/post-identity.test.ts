import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, postIdentityKey } from "../lib/url-utils.ts";

test("postIdentityKey: Instagram URL variants map to one post key", () => {
  assert.equal(postIdentityKey("https://www.instagram.com/reel/DZ1L0iLzahp/?igsh=x"), "ig:DZ1L0iLzahp");
  assert.equal(postIdentityKey("https://www.instagram.com/p/DZ1L0iLzahp/"), "ig:DZ1L0iLzahp");
  assert.equal(postIdentityKey("https://instagram.com/user/tv/DZ1L0iLzahp/?hl=ko"), "ig:DZ1L0iLzahp");
});

test("postIdentityKey: TikTok and YouTube URL variants map to one post key", () => {
  assert.equal(
    normalizeUrl("https://tiktok.com/@ryuraikj/video/7652295124399000839/?is_from_webapp=1"),
    "https://www.tiktok.com/@ryuraikj/video/7652295124399000839/"
  );
  assert.equal(
    postIdentityKey("https://www.tiktok.com/@ryuraikj/video/7652295124399000839/?is_from_webapp=1"),
    "tt:7652295124399000839"
  );
  assert.equal(
    postIdentityKey("https://tiktok.com/@ryuraikj/video/7652295124399000839/"),
    "tt:7652295124399000839"
  );
  assert.equal(postIdentityKey("https://youtu.be/14NN3A0vRDE?si=x"), "yt:14NN3A0vRDE");
  assert.equal(postIdentityKey("https://www.youtube.com/watch?v=14NN3A0vRDE"), "yt:14NN3A0vRDE");
  assert.equal(postIdentityKey("https://www.youtube.com/shorts/14NN3A0vRDE"), "yt:14NN3A0vRDE");
});
