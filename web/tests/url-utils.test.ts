import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instagramRequestUrl,
  normalizeUrl,
  ALLOWED_POST_URL_RE,
  isInstagramNonPostUrl,
  isInvalidTikTokPostUrl,
  isValidTikTokSnowflake,
  normalizeInstagramUrl,
  normalizeYouTubeUrl,
} from "../lib/url-utils.ts";

test("normalizeUrl: 프로토콜·trailing slash 통일 + 쿼리 제거", () => {
  // IG 게시물 표준형은 shortcode 기준 www.instagram.com/p/<code>/ (64234f3 정준화 — DB 저장형과 동일)
  assert.equal(
    normalizeUrl("http://instagram.com/p/ABC?utm_source=x"),
    "https://www.instagram.com/p/ABC/"
  );
  assert.equal(normalizeUrl("instagram.com/p/ABC/"), "https://www.instagram.com/p/ABC/");
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("not a url"), null);
});

test("isInstagramNonPostUrl: 프로필·목록은 차단하고 게시물 shortcode는 허용", () => {
  for (const u of [
    "https://www.instagram.com/kimbbuingg/",
    "https://www.instagram.com/kimbbuingg/reels/",
    "https://instagram.com/explore/",
  ]) {
    assert.equal(isInstagramNonPostUrl(u), true, `차단해야 함: ${u}`);
  }
  for (const u of [
    "https://www.instagram.com/p/ABC_123/",
    "https://www.instagram.com/reel/ABC_123/",
    "https://www.instagram.com/user/reels/ABC_123/",
    "https://www.youtube.com/shorts/ABC_123/",
  ]) {
    assert.equal(isInstagramNonPostUrl(u), false, `허용해야 함: ${u}`);
  }
});

test("TikTok snowflake: uint64 범위만 허용하고 잘못 붙인 20자리 ID를 차단", () => {
  assert.equal(isValidTikTokSnowflake("7667204307820760338"), true);
  assert.equal(isValidTikTokSnowflake("18446744073709551615"), true);
  assert.equal(isValidTikTokSnowflake("18446744073709551616"), false);
  assert.equal(
    isInvalidTikTokPostUrl("https://www.tiktok.com/@issuebox_/photo/76672043078207603388/"),
    true,
  );
  assert.equal(
    isInvalidTikTokPostUrl("https://www.tiktok.com/@issuebox_/photo/7667204307820760338/"),
    false,
  );
  assert.equal(
    isInvalidTikTokPostUrl("https://www.tiktok.com/@ssulbox_1/video/76543907066471252699/"),
    true,
  );
});

test("normalizeUrl: 같은 게시물의 다른 표기는 동일 URL로 정규화(중복 제거 기반)", () => {
  const a = normalizeUrl("https://www.instagram.com/reel/XYZ/?igsh=1");
  const b = normalizeUrl("https://www.instagram.com/reel/XYZ?hl=ko");
  assert.equal(a, b);
  assert.equal(normalizeUrl("https://www.instagram.com/reel/DZ1L0iLzahp/"), "https://www.instagram.com/p/DZ1L0iLzahp/");
  assert.equal(normalizeUrl("https://www.instagram.com/p/DZ1L0iLzahp/"), "https://www.instagram.com/p/DZ1L0iLzahp/");
});

test("ALLOWED_POST_URL_RE: 허용 플랫폼만 통과", () => {
  for (const u of [
    "https://www.instagram.com/p/ABC/",
    "https://youtube.com/shorts/X/",
    "https://youtu.be/X/",
    "https://www.tiktok.com/@a/video/1/",
    "https://www.threads.net/@a/post/1/",
    "https://shortform.kakao.com/contents/ABC/",
    "https://m.blog.naver.com/aeirmeki/clip/15032187/", // 네이버 클립(2단계 서브도메인)
  ]) {
    assert.ok(ALLOWED_POST_URL_RE.test(u), `통과해야 함: ${u}`);
  }
  for (const u of [
    "https://example.com/x/",
    "http://instagram.com/p/ABC/", // http는 불허(정규화 후 https만)
    "https://evil-naver.com/x/", // 도메인 위장 차단(naver.com 허용이 오용되지 않음)
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

// 🚨 2026-08-19: `/p/`로 요청하면 apify/instagram-scraper가 videoPlayCount를 반환하지 않아
//   릴스 조회수가 통째로 결측됐다. 같은 게시물·같은 액터로 `/reel/` 요청 시 5건 전부 회수
//   (1,739 / 2,190 / 141 / 1,137 / 2,203 — 브라우저 릴스 탭 값과 일치).
//   사진·캐러셀에 `/reel/`로 요청해도 오류·오값 없음(4건 실측).
test("instagramRequestUrl: /p/ → /reel/ (요청 시점에만 변환)", () => {
  assert.equal(instagramRequestUrl("https://www.instagram.com/p/DcGchu3Sm3Z/"),
    "https://www.instagram.com/reel/DcGchu3Sm3Z/");
  for (const u of ["https://www.instagram.com/reel/ABC123/",
                   "https://www.instagram.com/reels/ABC123/",
                   "https://www.instagram.com/tv/ABC123/"]) {
    assert.equal(instagramRequestUrl(u), "https://www.instagram.com/reel/ABC123/");
  }
});

test("instagramRequestUrl: 프로필·타플랫폼 URL은 건드리지 않는다", () => {
  // 🚨 프로필 URL을 변환하면 계정 게시물을 통째로 긁어 Apify 비용이 폭증한다.
  for (const u of ["https://instagram.com/xeoj.ng/",
                   "https://www.instagram.com/one_star_video/reels/",
                   "https://www.tiktok.com/@a/video/123",
                   "https://www.youtube.com/shorts/abc"]) {
    assert.equal(instagramRequestUrl(u), u);
  }
});
