import { test } from "node:test";
import assert from "node:assert/strict";
import { productsFromCaption, pickViewCount, pickUploadedAt, pickCaption, enrichSupported, GENERIC_PRODUCT_WORDS } from "../lib/organic-enrich.ts";

// 무상노출 수동 추가 자동 보강(2026-08-06 사용자 요청).
// 가장 위험한 건 제품명 오탐이다 — 일상어와 겹치는 이름이 아무 캡션에나 붙으면 통계가 오염된다.

const KNOWN = [
  "초코바", "바닐라초코바", "말차초코바", "파인트", "생우유파인트", "밀크티파인트",
  "모나카", "생우유모나카", "우유", "케이크", "라떼", "소금빵", "생크림롤", "단팥바", "밤티라미수",
];

test("캡션에서 기존 제품명을 찾는다", () => {
  assert.deepEqual(productsFromCaption("라라스윗 생우유파인트 먹었어요", KNOWN), ["생우유파인트"]);
  assert.deepEqual(productsFromCaption("밀크티파인트랑 단팥바 같이 먹음", KNOWN), ["단팥바", "밀크티파인트"]);
});

test("공백·대소문자를 무시한다", () => {
  assert.deepEqual(productsFromCaption("생 우유 파인트 최고", KNOWN), ["생우유파인트"]);
});

test("더 구체적인 이름이 잡히면 상위 이름은 버린다", () => {
  // '바닐라초코바'가 잡히면 '초코바'는 중복이다(상위 칩은 그룹 선택으로 이미 함께 잡힌다).
  assert.deepEqual(productsFromCaption("바닐라초코바 존맛", KNOWN), ["바닐라초코바"]);
  assert.deepEqual(productsFromCaption("생우유모나카 먹음", KNOWN), ["생우유모나카"]);
});

test("🔴 일상어와 겹치는 이름은 절대 매칭하지 않는다(오탐 방지)", () => {
  // 이게 깨지면 "우유 마시면서 라라스윗" 같은 평범한 캡션에 엉뚱한 제품이 붙는다.
  assert.deepEqual(productsFromCaption("우유 마시면서 라라스윗 생각남", KNOWN), []);
  assert.deepEqual(productsFromCaption("생일 케이크 사왔어요", KNOWN), []);
  assert.deepEqual(productsFromCaption("라떼 한 잔", KNOWN), []);
  for (const w of ["우유", "케이크", "라떼"]) assert.ok(GENERIC_PRODUCT_WORDS.includes(w), `${w}는 제외어여야 한다`);
});

test("계열 대표 이름(파인트·모나카·초코바)만으로는 매칭하지 않는다", () => {
  // 계열명은 흔해서 오탐이 크다 → 사람이 직접 고르게 둔다.
  assert.deepEqual(productsFromCaption("라라스윗 파인트 먹었어요", KNOWN), []);
  assert.deepEqual(productsFromCaption("모나카 맛있다", KNOWN), []);
});

test("빈 캡션·목록에 없는 제품은 빈 배열", () => {
  assert.deepEqual(productsFromCaption("", KNOWN), []);
  assert.deepEqual(productsFromCaption("   ", KNOWN), []);
  assert.deepEqual(productsFromCaption("처음보는신제품바 먹음", KNOWN), []);
});

test("조회수는 플랫폼마다 다른 필드에서 뽑고, 없으면 null", () => {
  assert.equal(pickViewCount({ viewCount: 12345 }), 12345);
  assert.equal(pickViewCount({ playCount: 987 }), 987);
  assert.equal(pickViewCount({ statistics: { viewCount: "1,234" } }), 1234);
  assert.equal(pickViewCount({ viewCount: "56789" }), 56789);
  assert.equal(pickViewCount({}), null, "없으면 0이 아니라 null(공백≠0)");
  assert.equal(pickViewCount({ viewCount: null }), null);
});

test("게시일은 범위 밖 쓰레기값을 버린다", () => {
  const today = "2026-08-06";
  assert.equal(pickUploadedAt({ uploadDate: "2024-05-11" }, today), "2024-05-11");
  assert.equal(pickUploadedAt({ createdAt: "2024-11-24T10:00:00.000Z" }, today), "2024-11-24");
  assert.equal(pickUploadedAt({ timestamp: 1716000000 }, today), "2024-05-18", "초 단위 유닉스타임");
  assert.equal(pickUploadedAt({ date: "1970-01-01" }, today), null, "1970은 버린다");
  assert.equal(pickUploadedAt({ date: "2099-01-01" }, today), null, "미래는 버린다");
  assert.equal(pickUploadedAt({}, today), null);
});

test("캡션 후보를 합쳐서 본다(해시태그 포함)", () => {
  const blob = pickCaption({ text: "라라스윗", title: "리뷰", hashtags: ["단팥바", { name: "밤티라미수" }] });
  assert.ok(blob.includes("라라스윗") && blob.includes("단팥바") && blob.includes("밤티라미수"));
});

test("조회수 개념이 없는 플랫폼은 보강 대상이 아니다", () => {
  assert.equal(enrichSupported("유튜브"), true);
  assert.equal(enrichSupported("트위터"), true);
  assert.equal(enrichSupported("인스타그램"), true);
  assert.equal(enrichSupported("틱톡"), true);
  assert.equal(enrichSupported("블로그"), false);
  assert.equal(enrichSupported(""), false);
  assert.equal(enrichSupported(null), false);
});
