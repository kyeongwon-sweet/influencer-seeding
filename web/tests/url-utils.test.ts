import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUrl,
  ALLOWED_POST_URL_RE,
  normalizeInstagramUrl,
  normalizeYouTubeUrl,
} from "../lib/url-utils.ts";

test("normalizeUrl: 프로토콜·trailing slash 통일 + 쿼리 제거", () => {
  assert.equal(
    normalizeUrl("http://instagram.com/p/ABC?utm_source=x"),
    "https://instagram.com/p/ABC/"
  );
  assert.equal(normalizeUrl("instagram.com/p/ABC/"), "https://instagram.com/p/ABC/");
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("not a url"), null);
});

test("normalizeUrl: 같은 게시물의 다른 표기는 동일 URL로 정규화(중복 제거 기반)", () => {
  const a = normalizeUrl("https://www.instagram.com/reel/XYZ/?igsh=1");
  const b = normalizeUrl("https://www.instagram.com/reel/XYZ?hl=ko");
  assert.equal(a, b);
});

test("ALLOWED_POST_URL_RE: 허용 플랫폼만 통과", () => {
  for (const u of [
    "https://www.instagram.com/p/ABC/",
    "https://youtube.com/shorts/X/",
    "https://youtu.be/X/",
    "https://www.tiktok.com/@a/video/1/",
    "https://www.threads.net/@a/post/1/",
  ]) {
    assert.ok(ALLOWED_POST_URL_RE.test(u), `통과해야 함: ${u}`);
  }
  for (const u of [
    "https://example.com/x/",
    "http://instagram.com/p/ABC/", // http는 불허(정규화 후 https만)
    "https://naver.com/",
  ]) {
    assert.ok(!ALLOWED_POST_URL_RE.test(u), `막아야 함: ${u}`);
  }
});

test("normalizeInstagramUrl: 프로필만 반환, 포스트/릴스는 null", () => {
  assert.equal(normalizeInstagramUrl("https://instagram.com/someuser"), "https://www.instagram.com/someuser/");
  assert.equal(normalizeInstagramUrl("https://instagram.com/p/ABC/"), null);
  assert.equal(normalizeInstagramUrl("https://instagram.com/reel/ABC/"), null);
  assert.equal(normalizeInstagramUrl("https://youtube.com/x"), null);
});

test("normalizeYouTubeUrl: 채널 부가경로 제거", () => {
  assert.equal(normalizeYouTubeUrl("https://youtube.com/@chan/videos"), "https://www.youtube.com/@chan/");
  assert.equal(normalizeYouTubeUrl("https://instagram.com/x"), null);
});
