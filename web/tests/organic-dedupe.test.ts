import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalMentionUrl, splitDuplicateMentions } from "../lib/url-utils.ts";

// 요구(2026-08-04): 무상노출 탭에서 같은 링크는 추가되지 않게, utm 등 파라미터가 붙어도 중복 처리.

test("utm 등 추적 파라미터는 무시하고 같은 링크로 본다", () => {
  const base = "https://www.instagram.com/p/ABC123/";
  for (const variant of [
    "https://www.instagram.com/p/ABC123/?utm_source=ig_web_copy_link",
    "https://www.instagram.com/p/ABC123/?igsh=MWZ4dTk2&utm_medium=share",
    "https://instagram.com/p/ABC123?fbclid=xyz",
  ]) {
    assert.equal(canonicalMentionUrl(variant), base, variant);
  }
});

test("인스타 /reel/·/tv/ 와 /p/ 는 같은 글", () => {
  assert.equal(canonicalMentionUrl("https://www.instagram.com/reel/ABC123/?utm_source=x"), "https://www.instagram.com/p/ABC123/");
  assert.equal(canonicalMentionUrl("https://www.instagram.com/tv/ABC123/"), "https://www.instagram.com/p/ABC123/");
});

test("유튜브는 ID가 쿼리에 있어 보존된다(다른 영상이 한 행으로 합쳐지면 안 됨)", () => {
  assert.equal(canonicalMentionUrl("https://www.youtube.com/watch?v=1zjrfvQQJXw&t=10s"), "https://www.youtube.com/watch?v=1zjrfvQQJXw");
  assert.notEqual(
    canonicalMentionUrl("https://www.youtube.com/watch?v=AAAAAAAAAAA"),
    canonicalMentionUrl("https://www.youtube.com/watch?v=BBBBBBBBBBB"),
  );
  assert.equal(canonicalMentionUrl("https://youtu.be/1zjrfvQQJXw?si=abc"), "https://www.youtube.com/watch?v=1zjrfvQQJXw");
});

test("이미 저장된 링크는 utm이 달라도 중복으로 걸러진다", () => {
  const existing = ["https://www.instagram.com/p/ABC123/"];
  const r = splitDuplicateMentions([{ url: "https://www.instagram.com/reel/ABC123/?utm_source=ig_web" }], existing);
  assert.equal(r.unique.length, 0);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].reason, "existing");
});

test("저장된 쪽에 파라미터가 남아 있어도 비교된다(과거 데이터 보호)", () => {
  const existing = ["https://www.instagram.com/p/ABC123/?igsh=old"];
  const r = splitDuplicateMentions([{ url: "https://www.instagram.com/p/ABC123/" }], existing);
  assert.equal(r.unique.length, 0);
  assert.equal(r.duplicates.length, 1);
});

test("같은 요청 안에서 겹친 것도 한 번만 저장한다", () => {
  const r = splitDuplicateMentions(
    [
      { url: "https://www.instagram.com/p/ABC123/?utm_source=a" },
      { url: "https://www.instagram.com/reel/ABC123/" },
      { url: "https://www.instagram.com/p/ZZZ999/" },
    ],
    [],
  );
  assert.equal(r.unique.length, 2);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].reason, "in_batch");
});

test("저장되는 url은 정규화된 표준형이다", () => {
  const r = splitDuplicateMentions([{ url: "https://instagram.com/reel/ABC123?utm_source=x", account_name: "a" }], []);
  assert.equal(r.unique[0].url, "https://www.instagram.com/p/ABC123/");
  assert.equal(r.unique[0].account_name, "a", "다른 필드는 보존");
});

test("빈 링크·잘못된 값은 invalid 로 분리(중복으로 오판하지 않음)", () => {
  const r = splitDuplicateMentions([{ url: "" }, { url: null }, {}], []);
  assert.equal(r.invalid.length, 3);
  assert.equal(r.unique.length, 0);
  assert.equal(r.duplicates.length, 0);
});

test("서로 다른 글은 그대로 통과", () => {
  const r = splitDuplicateMentions(
    [{ url: "https://www.instagram.com/p/AAA/" }, { url: "https://www.tiktok.com/@u/video/123/" }],
    ["https://www.instagram.com/p/BBB/"],
  );
  assert.equal(r.unique.length, 2);
  assert.equal(r.duplicates.length, 0);
});

