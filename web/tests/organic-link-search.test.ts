import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMentionUrl,
  duplicateMentionMessage,
  mentionLinkQuery,
  mentionUrlHandle,
  splitDuplicateMentions,
} from "../lib/url-utils.ts";
import { matchesSearch } from "../lib/search-filter.ts";

// 2026-10-26 실사례: X 링크를 추가하려니 '이미 등록됨'인데 목록에서 못 찾았다.
// 행은 있었고 계정명이 '원어스 건희'였다 — 검색이 계정명만 봐서 링크·아이디로는 안 걸렸다.
const 저장된_행 = {
  id: "d31d24c6-ed91-41ca-81bb-cf98f53d92f7",
  url: "https://x.com/P_kh627/status/2104202774653399065/",
  account_name: "원어스 건희",
  uploaded_at: "2026-09-27",
};
const 붙여넣은_링크 = "https://x.com/P_kh627/status/2104202774653399065";

test("링크 검색은 중복 판정과 같은 표준형으로 비교한다(등록됐다는 행이 반드시 걸린다)", () => {
  const q = mentionLinkQuery(붙여넣은_링크);
  assert.ok(q);
  assert.equal(q, canonicalMentionUrl(저장된_행.url));
  // 중복 판정이 막는 링크 = 링크 검색이 찾는 행. 둘이 어긋나면 이 사고가 재발한다.
  const { duplicates } = splitDuplicateMentions([{ url: 붙여넣은_링크 }], [저장된_행]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].url, q);
});

test("링크 변형(www·추적 파라미터·스킴 없음·인스타 /reel/)도 같은 행으로 찾는다", () => {
  const key = canonicalMentionUrl(저장된_행.url);
  for (const v of [
    "https://www.x.com/P_kh627/status/2104202774653399065?s=20",
    "x.com/P_kh627/status/2104202774653399065",
  ]) assert.equal(mentionLinkQuery(v), key, v);
  assert.equal(
    mentionLinkQuery("https://www.instagram.com/reel/ABC123/?igsh=xyz"),
    canonicalMentionUrl("https://www.instagram.com/p/ABC123/"),
  );
});

test("일반 검색어는 링크로 보지 않는다(기존 AND/OR/제외 문법 그대로)", () => {
  for (const q of ["", "원어스", "원어스 건희", "에스파, 아이브", "-광고", "P_kh627", "@P_kh627", "a.b"]) {
    assert.equal(mentionLinkQuery(q), null, q);
  }
});

test("URL에서 계정 아이디를 뽑는다(플랫폼별)", () => {
  assert.equal(mentionUrlHandle(저장된_행.url), "p_kh627");
  assert.equal(mentionUrlHandle("https://twitter.com/Someone/status/1"), "someone");
  assert.equal(mentionUrlHandle("https://www.tiktok.com/@tok.user/video/7300000000000000000/"), "tok.user");
  assert.equal(mentionUrlHandle("https://www.youtube.com/@chan/shorts"), "chan");
  assert.equal(mentionUrlHandle("https://www.threads.net/@th_user/post/ABC"), "th_user");
  assert.equal(mentionUrlHandle("https://www.instagram.com/insta_user/"), "insta_user");
  assert.equal(mentionUrlHandle("https://www.instagram.com/stories/insta_user/123/"), "insta_user");
  // 아이디가 주소에 없는 경우
  assert.equal(mentionUrlHandle("https://www.instagram.com/p/ABC123/"), null);
  assert.equal(mentionUrlHandle("https://www.youtube.com/watch?v=1zjrfvQQJXw"), null);
  assert.equal(mentionUrlHandle("https://x.com/i/status/1"), null);
  assert.equal(mentionUrlHandle(null), null);
  assert.equal(mentionUrlHandle("not a url %%"), null);
});

test("계정명+아이디를 합친 대상으로 검색하면 아이디로도 찾는다(계정명 검색은 그대로)", () => {
  const hay = `${저장된_행.account_name} @${mentionUrlHandle(저장된_행.url)}`;
  assert.ok(matchesSearch(hay, "@P_kh627"));
  assert.ok(matchesSearch(hay, "P_kh627"));
  assert.ok(matchesSearch(hay, "건희"));
  assert.ok(!matchesSearch(hay, "-P_kh627"));
  assert.ok(!matchesSearch(hay, "다른계정"));
});

test("중복이면 겹친 기존 행을 돌려준다(어느 행인지 안내하려고)", () => {
  const { duplicates } = splitDuplicateMentions([{ url: 붙여넣은_링크 }], [저장된_행]);
  assert.equal(duplicates[0].reason, "existing");
  assert.equal(duplicates[0].existing?.id, 저장된_행.id);
  assert.equal(duplicateMentionMessage(duplicates[0].existing), "이미 '원어스 건희'(2026-09-27) 행으로 등록돼 있습니다.");
});

test("프로필 URL: 날짜가 같은 행을 짚고, 날짜 미상 기존 행도 짚는다", () => {
  const prof = "https://www.instagram.com/jungyun_diet/";
  const rows = [
    { id: "a", url: prof, uploaded_at: "2023-02-12", account_name: "운동하는 쩡" },
    { id: "b", url: prof, uploaded_at: "2023-11-30", account_name: "운동하는 쩡2" },
  ];
  const hit = splitDuplicateMentions([{ url: prof, uploaded_at: "2023-11-30" }], rows);
  assert.equal(hit.duplicates[0].existing?.id, "b");
  // 다른 날짜는 새 노출 — 중복 아님(기존 규칙 유지)
  assert.equal(splitDuplicateMentions([{ url: prof, uploaded_at: "2024-01-01" }], rows).unique.length, 1);
  // 날짜 미상 기존 행은 모든 날짜를 덮는다 → 그 행을 짚는다
  const undated = splitDuplicateMentions([{ url: prof, uploaded_at: "2024-01-01" }], [{ id: "c", url: prof, uploaded_at: null, account_name: null }]);
  assert.equal(undated.duplicates[0].existing?.id, "c");
  assert.equal(duplicateMentionMessage(undated.duplicates[0].existing), "이미 등록돼 있습니다(계정명 비어 있음).");
});

test("같은 요청 안에서 겹친 건 기존 행이 없다 / 문자열 목록이면 기존 행 정보 없음(종전 호출 호환)", () => {
  const batch = splitDuplicateMentions([{ url: 붙여넣은_링크 }, { url: 붙여넣은_링크 + "?s=1" }], []);
  assert.equal(batch.duplicates[0].reason, "in_batch");
  assert.equal(batch.duplicates[0].existing, undefined);
  const plain = splitDuplicateMentions([{ url: 붙여넣은_링크 }], [저장된_행.url]);
  assert.equal(plain.duplicates[0].existing, undefined);
  assert.equal(duplicateMentionMessage(undefined), "이미 등록돼 있습니다(계정명 비어 있음).");
});
