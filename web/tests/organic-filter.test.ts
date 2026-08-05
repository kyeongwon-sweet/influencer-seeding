import { test } from "node:test";
import assert from "node:assert/strict";
import { organicExcludeHit, organicTradePostHit, ORGANIC_EXCLUDE_KEYWORDS } from "../lib/organic-filter.ts";

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

// ── 밴드 곡명 제외어 (2026-08-05 사용자 지시로 추가) ─────────────────────────
// '랄라스윗' 한글 표기 없이 영문 lalasweet만 쓴 밴드 게시물을 잡기 위한 것.

test("제외어에 공백이 들어가면 절대 매칭되지 않는다", () => {
  // 판정은 대상 텍스트의 공백을 지우고 비교한다. 제외어 자체에 공백이 있으면 영원히 안 걸린다.
  for (const kw of ORGANIC_EXCLUDE_KEYWORDS) {
    assert.equal(kw, kw.replace(/\s+/g, ""), `제외어에 공백 있음: "${kw}"`);
  }
});

test("밴드 곡명이 있으면 제외된다 (공백 표기 무관)", () => {
  assert.equal(organicExcludeHit({ caption: "오월 - lalasweet 커버" }), "오월");
  assert.equal(organicExcludeHit({ title: "나의 낡은 오렌지나무 (lalasweet)" }), "나의낡은오렌지나무");
  assert.equal(organicExcludeHit({ title: "나의낡은오렌지나무" }), "나의낡은오렌지나무");
  assert.equal(organicExcludeHit({ caption: "'불꽃놀이' Official MV" }), "불꽃놀이");
  assert.equal(organicExcludeHit({ caption: "파란달이 뜨는 날에" }), "파란달이뜨는날에");
});

test("한글 '랄라스윗' 없이 영문 lalasweet만 쓴 밴드 글도 곡명으로 잡힌다", () => {
  // 실제 DB에 남아 있던 사례(TWICE 다현 생일 커버 모음, 조회수 5,741)의 구조.
  assert.ok(organicExcludeHit({ caption: 'DAHYUN birthday covers 2020: vocal cover "오월" by lalasweet' }));
});

test("⚠️ 곡명이 일상어와 겹치면 정상 게시물도 제외된다(의도된 트레이드오프)", () => {
  // 사용자가 곡명 추가를 지시했고, 실측(672행) 오탐은 0건이었다.
  // 다만 원리상 이런 문장은 제외된다 — 이 동작이 문제가 되면 곡명을 조건부로 바꿔야 한다.
  assert.equal(organicExcludeHit({ caption: "불꽃놀이 보면서 라라스윗 먹기" }), "불꽃놀이");
  // 곡명이 없는 정상 게시물은 그대로 통과한다.
  assert.equal(organicExcludeHit({ caption: "여름밤에 라라스윗 딸기듬뿍바" }), null);
});

// ── 아이돌 특전 포카 양도글 제외 (2026-08-05 사용자 지시로 추가) ─────────────────
// 실측: 668행 중 58건이 다크문 콜라보 특전 포카 거래글이었고 전부 삭제했다.
// 아래 캡션은 **실제로 삭제된 글**과 **실제로 보존한 글**을 그대로 옮긴 것이다.

test("실제 양도·거래글은 제외된다", () => {
  const 거래글 = [
    "엔하이픈 다크문 라라스윗 특전 포카 양도 ✅️미개봉 7장 일괄 양도 4.0 배송비 0.18 디엠 해주세요",
    "라라스윗 다크문 케이크 포카 포토카드 양도 Enhypen Dark Moon have: Shion want: Jino wtt 엔하이픈",
    "엔하이픈 다크문 라라스윗 포토카드 양도 판매 each price enhypen darkmoon wts",
    "엔하이픈 라라스윗 다크문 포카 교환 나 : 솔론/성훈 님 : 자카/정원 enhypen darkmoon lalasweet",
    "wts / พร้อมส่ง เฮลลี่ darkmoon lalasweet 200.-รวมส่ง #ตลาดนัดenhypen",
    "ดีลเกาหลี🇰🇷 DARK MOON | Lalasweet Ice Cream Cake เจค นิกิ - ใบละ 450 - รับมัดจำ",
    "꒰ พร้อมส่ง♡̷ ꒱ ♡ lucky draw : ktown , weverse shop / dark moon x lalasweet ice cream cake",
    "#ensell jaan jakah darkmoon lalasweet, rate 12.2 ada yg mau",
  ];
  for (const caption of 거래글) {
    assert.ok(organicTradePostHit({ caption }), `제외 실패: ${caption.slice(0, 40)}`);
  }
});

test("진짜 다크문 콜라보 노출글은 통과한다 (실제 보존 데이터)", () => {
  const 노출글 = [
    "Lalasweet, the leading low-sugar ice cream brand, has released a collaboration product and limited-edition ice cream cake in partnership with HYBE's original story Dark Moon with ENHYPEN.",
    "다크문 | 라라스윗 아이스크림 케이크🎂 곧 카카오톡 선물하기에서 만나요!💔 #다크문 #다크문X라라스윗 #워너바이트",
    "SUNOO got the Dark Moon x Lalasweet Ice Cream cake! ❤️❤️❤️",
    "shion & jakah photocard from darkmoon x lalasweet was so cuteeeeeeee 🥹🤍",
    "dark moon x lalasweet ice cream cake collab i tried getting the mini jaan on the cake topper",
    "Lalasweet x dark moon ice cream cake LO AMO LO AMO",
    "darkmoon x lalasweet, a korean dessert brand!! sunoo recommended their icecream before",
  ];
  for (const caption of 노출글) {
    assert.equal(organicTradePostHit({ caption }), null, `오탐: ${caption.slice(0, 40)}`);
  }
});

test("아이돌 문맥 없는 일반 판매글은 이 필터가 건드리지 않는다", () => {
  // '판매' 같은 단어만으로 막으면 브랜드 게시물이 날아간다 → 아이돌 문맥이 함께 있어야 한다.
  assert.equal(organicTradePostHit({ caption: "라라스윗 신제품 판매 시작! 딸기듬뿍바" }), null);
  assert.equal(organicTradePostHit({ caption: "편의점에서 라라스윗 양도받았어요" }), null);
  // 반대로 아이돌 문맥만 있고 거래 신호가 없으면 통과
  assert.equal(organicTradePostHit({ caption: "엔하이픈 다크문 라라스윗 케이크 먹었다" }), null);
});
