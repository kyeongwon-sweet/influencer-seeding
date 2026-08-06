import { test } from "node:test";
import assert from "node:assert/strict";
import { platformFromUrl } from "../lib/platform.ts";

// 무상노출 추가 모달이 "링크를 붙이면 채널 유형 자동 판정"에 이걸 쓴다.
// 예전엔 platform 기본값이 "인스타그램"이라 유튜브·X 링크도 인스타그램으로 저장됐다(조용한 오분류).

test("주요 플랫폼을 URL 호스트로 판정한다", () => {
  assert.equal(platformFromUrl("https://x.com/musinsa_fit/status/2055477714170343725"), "트위터");
  assert.equal(platformFromUrl("https://twitter.com/foo/status/123"), "트위터");
  assert.equal(platformFromUrl("https://www.youtube.com/shorts/UTaT8NFBKUY"), "유튜브");
  assert.equal(platformFromUrl("https://www.youtube.com/watch?v=abc123"), "유튜브");
  assert.equal(platformFromUrl("https://youtu.be/abc123"), "유튜브");
  assert.equal(platformFromUrl("https://www.instagram.com/p/DABC123/"), "인스타그램");
  assert.equal(platformFromUrl("https://www.instagram.com/reel/DABC123/"), "인스타그램");
  assert.equal(platformFromUrl("https://www.tiktok.com/@user/video/7500000000000000000"), "틱톡");
  assert.equal(platformFromUrl("https://www.threads.net/@user/post/ABC"), "스레드");
  assert.equal(platformFromUrl("https://blog.naver.com/someone/223456789"), "블로그");
});

test("프로토콜이 없어도 판정한다(붙여넣기 습관)", () => {
  assert.equal(platformFromUrl("youtube.com/shorts/abc"), "유튜브");
  assert.equal(platformFromUrl("www.instagram.com/p/DABC123/"), "인스타그램");
});

test("판정 불가면 null — 억지로 채우지 않는다", () => {
  // 사용자 규칙(2026-08-05): 분류가 어려운 건 채널 유형을 아예 선택하지 않는다.
  assert.equal(platformFromUrl(""), null);
  assert.equal(platformFromUrl(null), null);
  assert.equal(platformFromUrl("   "), null);
  assert.equal(platformFromUrl("https://dcinside.com/board/12345"), null);
  assert.equal(platformFromUrl("오프라인 행사"), null);
});

test("호스트 접미사를 통째로 비교한다(유사 도메인 오판 방지)", () => {
  // notx.com·myyoutube.com 같은 걸 x/youtube로 오판하면 안 된다.
  assert.equal(platformFromUrl("https://notx.com/a"), null);
  assert.equal(platformFromUrl("https://myyoutube.com/a"), null);
  // 서브도메인은 정상 판정된다.
  assert.equal(platformFromUrl("https://m.youtube.com/watch?v=a"), "유튜브");
  assert.equal(platformFromUrl("https://mobile.twitter.com/a/status/1"), "트위터");
});
