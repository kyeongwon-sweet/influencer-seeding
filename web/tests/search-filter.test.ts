import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch } from "../lib/search-filter.ts";

test("빈 검색어는 항상 통과", () => {
  assert.equal(matchesSearch("아무거나", ""), true);
  assert.equal(matchesSearch("아무거나", "   "), true);
  assert.equal(matchesSearch(null, "딸기"), false); // 대상이 비면 포함어 불충족
});

test("단일 포함어 — 부분일치(기존 동작 호환)", () => {
  assert.equal(matchesSearch("딸기 바이럴 영상", "딸기"), true);
  assert.equal(matchesSearch("딸기 바이럴 영상", "사과"), false);
});

test("대소문자 무시", () => {
  assert.equal(matchesSearch("UFO Skyblue", "ufo"), true);
  assert.equal(matchesSearch("ufo skyblue", "SKYBLUE"), true);
});

test("여러 포함어는 AND(모두 포함해야 통과)", () => {
  assert.equal(matchesSearch("딸기 바이럴 영상", "딸기 영상"), true);
  assert.equal(matchesSearch("딸기 바이럴 영상", "딸기 배너"), false); // '배너' 없음
});

test("제외어(-단어) — 포함하면 탈락", () => {
  assert.equal(matchesSearch("딸기 광고 영상", "-광고"), false);
  assert.equal(matchesSearch("딸기 영상", "-광고"), true);
});

test("포함 + 제외 조합", () => {
  assert.equal(matchesSearch("딸기 영상", "딸기 -광고"), true);   // 딸기 포함 & 광고 없음
  assert.equal(matchesSearch("딸기 광고 영상", "딸기 -광고"), false); // 광고 있어 탈락
  assert.equal(matchesSearch("사과 영상", "딸기 -광고"), false);   // 딸기 없어 탈락
});

test("단독 '-'와 빈 토큰은 무시", () => {
  assert.equal(matchesSearch("딸기 영상", "- 딸기"), true);
  assert.equal(matchesSearch("딸기 영상", "딸기  영상"), true); // 다중 공백
});
