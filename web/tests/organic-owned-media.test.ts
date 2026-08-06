import { test } from "node:test";
import assert from "node:assert/strict";
import { organicOwnedMediaHit, organicExcludeHit, OWNED_MEDIA_HANDLES } from "../lib/organic-filter.ts";

// 2026-08-06 사용자 지시 "온드미디어는 제외해".
// 무상노출은 '남이 우리를 언급한 것'이므로 우리 계정이 쓴 글은 수집하지 않는다.
// 핵심 위험은 **오탐**이다 — 팬이 @lalasweet_twt를 태그한 글은 진짜 언급이라 남아야 한다.

test("우리 계정이 쓴 글을 작성자 필드로 잡는다", () => {
  assert.equal(organicOwnedMediaHit({ username: "lalasweet_twt" }), "lalasweet_twt");
  assert.equal(organicOwnedMediaHit({ author: { userName: "lalasweet_twt" } }), "lalasweet_twt");
  assert.equal(organicOwnedMediaHit({ ownerUsername: "lalasweet.official" }), "lalasweet.official");
  assert.equal(organicOwnedMediaHit({ authorMeta: { name: "LalaSweet_TWT" } }), "lalasweet_twt", "대소문자 무시");
});

test("작성자 필드가 없고 URL만 있어도 잡는다", () => {
  // 실측 사례: x.com/lalasweet_twt/status/1947569754597953644 (고객 문의 답글, 조회수 78)
  assert.equal(organicOwnedMediaHit({ url: "https://x.com/lalasweet_twt/status/1947569754597953644" }), "lalasweet_twt");
  assert.equal(organicOwnedMediaHit({ url: "https://www.instagram.com/lalasweet.official/" }), "lalasweet.official");
});

test("🔴 팬이 우리 계정을 태그한 글은 제외하지 않는다(오탐 방지)", () => {
  // 이게 깨지면 무상노출 탭의 존재 이유가 사라진다.
  assert.equal(organicOwnedMediaHit({
    username: "some_fan",
    caption: "@lalasweet_twt 이거 진짜 맛있어요 라라스윗 최고",
    url: "https://x.com/some_fan/status/123",
  }), null);
  assert.equal(organicOwnedMediaHit({
    ownerUsername: "diet_girl",
    text: "라라스윗(@lalasweet_official) 신상 먹어봤어요",
  }), null);
});

test("이름이 비슷한 팬 계정을 우리 계정으로 오판하지 않는다", () => {
  assert.equal(organicOwnedMediaHit({ username: "lalasweet_twt_fan" }), null);
  assert.equal(organicOwnedMediaHit({ username: "not_lalasweet_official" }), null);
  assert.equal(organicOwnedMediaHit({ url: "https://x.com/lalasweet_twtfan/status/1" }), null);
});

test("빈 입력·무관 게시물은 null", () => {
  assert.equal(organicOwnedMediaHit({}), null);
  assert.equal(organicOwnedMediaHit({ username: "miseo", caption: "라라스윗 초코바 리뷰" }), null);
});

test("핸들은 제외어 목록에 들어가 있으면 안 된다(캡션까지 검사되므로)", () => {
  // 회귀 방지: 누군가 편의상 ORGANIC_EXCLUDE_KEYWORDS에 핸들을 추가하면
  // 팬이 태그한 글이 통째로 사라진다. 그 경로가 막혀 있는지 확인한다.
  for (const h of OWNED_MEDIA_HANDLES) {
    assert.equal(
      organicExcludeHit({ caption: `@${h} 이거 맛있어요` }),
      null,
      `제외어 목록에 ${h}가 들어가 캡션 언급글이 걸러진다`,
    );
  }
});
