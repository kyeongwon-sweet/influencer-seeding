import { test } from "node:test";
import assert from "node:assert/strict";
import { pickThumbnail } from "../lib/organic-enrich.ts";

// 썸네일 저장 규칙(2026-08-06 실측 근거):
// DB에 있던 인스타 썸네일 6건이 **전부 403**이었다(적재 6주 후 만료). scontent*.cdninstagram.com은
// 서명 붙은 임시 URL이다. 반면 pbs.twimg.com·i.ytimg.com은 서명이 없어 계속 살아있다(HEAD 200 확인).
// → 만료되는 호스트는 저장하지 않는다. 깨진 이미지를 DB에 남기는 게 빈 값보다 나쁘다.

test("안 만료되는 호스트는 저장한다", () => {
  assert.equal(pickThumbnail({ thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg" }), "https://i.ytimg.com/vi/abc/hqdefault.jpg");
  assert.equal(pickThumbnail({ media: [{ media_url_https: "https://pbs.twimg.com/media/AAA.jpg" }] }), "https://pbs.twimg.com/media/AAA.jpg");
  assert.equal(pickThumbnail({ thumbnails: [{ url: "https://i.ytimg.com/vi/x/default.jpg" }] }), "https://i.ytimg.com/vi/x/default.jpg");
});

test("🔴 만료되는 호스트는 저장하지 않는다", () => {
  assert.equal(pickThumbnail({ displayUrl: "https://scontent-cph2-1.cdninstagram.com/v/t51.jpg?_nc_ht=x&oh=sig" }), null);
  assert.equal(pickThumbnail({ displayUrl: "https://scontent.xx.fbcdn.net/v/t51.jpg" }), null);
  assert.equal(pickThumbnail({ videoMeta: { coverUrl: "https://p16-sign.tiktokcdn-us.com/obj/xxx" } }), null);
});

test("만료 호스트와 안전 호스트가 같이 오면 안전한 쪽을 고른다", () => {
  assert.equal(
    pickThumbnail({ displayUrl: "https://scontent-arn2-1.cdninstagram.com/v/a.jpg", thumbnails: [{ url: "https://i.ytimg.com/vi/y/hq.jpg" }] }),
    "https://i.ytimg.com/vi/y/hq.jpg",
  );
});

test("🔴 X 액터는 media를 '문자열 배열'로 준다(실측) — 이걸 놓쳐 275건이 빈 채로 남았다", () => {
  // apidojo/twitter-scraper-lite 실제 응답(2026-08-06 탐침):
  //   media: ["https://pbs.twimg.com/media/HIxnql8aYAABGo5.jpg", ...]
  assert.equal(
    pickThumbnail({ media: ["https://pbs.twimg.com/media/HIxnql8aYAABGo5.jpg", "https://pbs.twimg.com/media/HIxnqrUakAA7GHa.jpg"] }),
    "https://pbs.twimg.com/media/HIxnql8aYAABGo5.jpg",
  );
  // extendedEntities 경로도 같은 값을 준다(보조)
  assert.equal(
    pickThumbnail({ extendedEntities: { media: [{ media_url_https: "https://pbs.twimg.com/media/AAA.jpg" }] } }),
    "https://pbs.twimg.com/media/AAA.jpg",
  );
});

test("🔴 프로필 사진을 게시물 이미지로 쓰지 않는다", () => {
  // author.profilePicture도 pbs.twimg 도메인이라 잘못 잡으면 모든 행이 프로필 사진이 된다.
  assert.equal(pickThumbnail({ author: { profilePicture: "https://pbs.twimg.com/profile_images/1/x_normal.jpg" } }), null);
});

test("이미지가 없거나 URL이 아니면 null", () => {
  assert.equal(pickThumbnail({}), null);
  assert.equal(pickThumbnail({ thumbnailUrl: "" }), null);
  assert.equal(pickThumbnail({ thumbnailUrl: "not-a-url" }), null);
  assert.equal(pickThumbnail({ image: 12345 }), null);
});
