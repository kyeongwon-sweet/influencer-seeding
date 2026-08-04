import { test } from "node:test";
import assert from "node:assert/strict";
import { organicExcludeHit, ORGANIC_EXCLUDE_KEYWORDS } from "../lib/organic-filter.ts";

// 실제로 무상노출에 잘못 수집됐던 캡션들(2026-08-04 DB 실측 16건 중 발췌).
// 인디 듀오 '랄라스윗(lalasweet)'이 영문 표기를 우리 브랜드와 똑같이 써서 검색에 걸렸다.
const 실제_오수집_캡션 = [
  "green - 랄라스윗 (lalasweet) - 들어보세요. https://t.co/2q5Nnvxs1b",
  "#GzzClip #강지 랄라스윗 (lalasweet) - 나의 낡은 오렌지나무 [추석 싱크룸]",
  "랄라스윗(lalasweet) - '불꽃놀이' Official MV",
  'TWICE DAHYUN "오월 (랄라스윗/lalasweet)" Cover #HappyDAHYUNday',
  '"오월" (May) by the South Korean indie duo Lalasweet (랄라스윗) is a reflective ballad',
];

test("실제 오수집 캡션은 전부 제외된다", () => {
  for (const caption of 실제_오수집_캡션) {
    assert.equal(organicExcludeHit({ caption }), "랄라스윗", `제외 실패: ${caption.slice(0, 40)}`);
  }
});

test("플랫폼별 텍스트 필드를 모두 본다", () => {
  assert.equal(organicExcludeHit({ text: "랄라스윗 신곡" }), "랄라스윗");          // 틱톡
  assert.equal(organicExcludeHit({ fullText: "랄라스윗 커버" }), "랄라스윗");       // X
  assert.equal(organicExcludeHit({ title: "랄라스윗 - 오월" }), "랄라스윗");        // 유튜브·블로그
  assert.equal(organicExcludeHit({ description: "랄라스윗 라이브" }), "랄라스윗");
  assert.equal(organicExcludeHit({ channelName: "랄라스윗 공식" }), "랄라스윗");
  assert.equal(organicExcludeHit({ authorMeta: { name: "랄라스윗" } }), "랄라스윗"); // 틱톡 중첩 객체
  assert.equal(organicExcludeHit({ hashtags: ["랄라스윗"] }), "랄라스윗");           // 문자열 해시태그
  assert.equal(organicExcludeHit({ hashtags: [{ name: "랄라스윗" }] }), "랄라스윗"); // 객체 해시태그
});

test("공백 끼운 표기도 잡는다", () => {
  assert.equal(organicExcludeHit({ caption: "랄라 스윗 콘서트" }), "랄라스윗");
  assert.equal(organicExcludeHit({ caption: "랄라\n스윗" }), "랄라스윗");
});

test("우리 브랜드(라라스윗) 게시물은 통과한다", () => {
  assert.equal(organicExcludeHit({ caption: "라라스윗 딸기듬뿍바 존맛" }), null);
  assert.equal(organicExcludeHit({ caption: "lalasweet 저당 아이스크림 내돈내산" }), null);
  assert.equal(organicExcludeHit({ title: "라라스윗 쫀득바 먹어봤어요" }), null);
});

test("필드 경계를 넘어 붙는 오탐이 없다", () => {
  // 앞 필드가 '랄라'로 끝나고 뒤 필드가 '스윗'으로 시작해도 합쳐서 판정하지 않는다.
  assert.equal(organicExcludeHit({ caption: "가랄라", title: "스윗한 하루" }), null);
  assert.equal(organicExcludeHit({ hashtags: ["랄라", "스윗"] }), null);
});

test("텍스트가 없거나 이상한 타입이어도 죽지 않는다", () => {
  assert.equal(organicExcludeHit({}), null);
  assert.equal(organicExcludeHit({ caption: null, hashtags: null, author: 123 }), null);
  assert.equal(organicExcludeHit({ hashtags: [null, 7, { nope: "랄라스윗" }] }), null);
});

test("제외어 목록은 비어 있지 않다", () => {
  assert.ok(ORGANIC_EXCLUDE_KEYWORDS.includes("랄라스윗"));
});
