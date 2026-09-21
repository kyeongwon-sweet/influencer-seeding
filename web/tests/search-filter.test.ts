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

// ── 쉼표 = OR (2026-09-21) ─────────────────────────────────────────────
// 요구: "검색을 여러 개 동시에 하고 싶다". 기존 공백 AND 만으로는 `에스파 아이브` 가
// '둘 다 포함'이라 결과가 0이 됐다. 쉼표로 나눈 덩어리끼리 OR 로 본다.

test("쉼표로 나눈 덩어리는 OR — 여러 개 동시 검색", () => {
  const h = "에스파 챌린지 영상";
  assert.equal(matchesSearch(h, "에스파, 아이브"), true);   // 앞쪽 일치
  assert.equal(matchesSearch(h, "아이브, 에스파"), true);   // 뒤쪽 일치
  assert.equal(matchesSearch(h, "아이브, 뉴진스"), false);  // 둘 다 없음
});

test("덩어리 안의 공백은 여전히 AND", () => {
  assert.equal(matchesSearch("에스파 챌린지", "에스파 챌린지, 아이브"), true);
  assert.equal(matchesSearch("에스파 광고", "에스파 챌린지, 아이브"), false); // 챌린지 없음
});

test("제외어는 어느 덩어리에 적어도 질의 전체에 적용된다", () => {
  // "(에스파 or 아이브) 이고 광고 아님"이 사람이 기대하는 뜻이다.
  assert.equal(matchesSearch("에스파 챌린지", "에스파, 아이브 -광고"), true);
  assert.equal(matchesSearch("에스파 광고", "에스파, 아이브 -광고"), false);
  assert.equal(matchesSearch("아이브 광고", "에스파, 아이브 -광고"), false);
  assert.equal(matchesSearch("아이브 챌린지", "-광고, 에스파, 아이브"), true); // 앞에 적어도 동일
});

test("🚨 쉼표가 없으면 기존 동작과 완전히 같다(회귀 방지)", () => {
  const cases: Array<[string, string]> = [
    ["딸기 바이럴 영상", "딸기"],
    ["딸기 바이럴 영상", "사과"],
    ["딸기 바이럴 영상", "딸기 영상"],
    ["딸기 바이럴 영상", "딸기 배너"],
    ["딸기 광고", "딸기 -광고"],
    ["딸기 영상", "딸기 -광고"],
    ["샘플 영상", "-샘플"],
    ["일반 영상", "-샘플"],
    ["UFO Skyblue", "ufo"],
  ];
  // 옛 구현(공백 AND + 전역 제외)을 그대로 두고 결과를 대조한다.
  const legacy = (hay: string, q: string) => {
    const h = hay.toLowerCase();
    let ok = true;
    for (const raw of q.trim().split(/\s+/)) {
      if (!raw || raw === "-") continue;
      if (raw.startsWith("-")) { if (h.includes(raw.slice(1).toLowerCase())) return false; }
      else if (!h.includes(raw.toLowerCase())) ok = false;
    }
    return ok;
  };
  for (const [hay, q] of cases) {
    assert.equal(matchesSearch(hay, q), legacy(hay, q), `"${q}" on "${hay}"`);
  }
});

test("쉼표 주변 공백·빈 덩어리·꼬리 쉼표를 견딘다", () => {
  assert.equal(matchesSearch("에스파", "  에스파 ,  , 아이브 ,"), true);
  assert.equal(matchesSearch("뉴진스", "  에스파 ,  , 아이브 ,"), false);
  assert.equal(matchesSearch("아무거나", ",,,"), true); // 포함어 0개 → 필터 없음
});

test("데이터에 쉼표가 있어도 그 행은 여전히 잡힌다", () => {
  // 실측: organic_mentions.mentioned_product 에 "말차파인트, 생요거트파인트" 같은 값이 있다.
  // 그 값을 그대로 붙여넣으면 두 조각이 OR 가 되어 해당 행은 계속 매칭된다.
  const h = "말차파인트, 생요거트파인트";
  assert.equal(matchesSearch(h, "말차파인트, 생요거트파인트"), true);
  assert.equal(matchesSearch("말차파인트", "말차파인트, 생요거트파인트"), true);
});

test("UI 안내와 실제 동작이 같은 출처를 쓴다(계약)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "../app/monitoring/components/FiltersBar.tsx"), "utf8");
  assert.match(src, /SEARCH_RULES/, "안내 표가 사라졌다");
  assert.match(src, /쉼표 = 또는/, "쉼표 OR 설명이 안내에 없다 — 사용자가 알 방법이 없다");
  // 안내에 적힌 예시는 실제로 그 뜻대로 동작해야 한다.
  assert.equal(matchesSearch("에스파 무대", "에스파, 아이브"), true);
  assert.equal(matchesSearch("에스파 챌린지", "에스파 챌린지"), true);
  assert.equal(matchesSearch("딸기 영상", "딸기 -광고"), true);
});
