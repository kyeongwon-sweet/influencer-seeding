// 무상노출 제품 칩 계열 묶음 — 상위 칩을 누르면 같은 계열 하위 제품이 전부 같이 켜져야 한다.
//
// 🚨 2026-10-22 사용자: "무상노출에서 '쫀득바' 눌렀는데 '그릭복숭아쫀득바'가 같이 클릭이 안 돼. 이런 오류를 전수 검사해줘"
//    원인 = 묶음이 명시 목록(멜론·망고)이라 새 제품이 빠짐. 아래 DB_PRODUCTS 는 그날 organic_mentions
//    1,158행의 언급제품 이름 전부(실측)다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PRODUCT_FAMILY_ORDER, familyMembers, familyOf, toggleProductSelection } from "../lib/organicProductFamily.ts";

const DB_PRODUCTS = [
  "감귤제로바", "골드키위듬뿍바", "골드파인제로바", "그릭복숭아쫀득바", "꿀고구마모나카", "꿀고구마파인트", "넛티초코바",
  "다크문 아이스크림 케이크", "단팥바", "듬뿍바", "딸기듬뿍바", "딸기생요거트바", "딸기파인트", "라떼", "라라스윗",
  "라즈베리오렌지파인트", "말차초코바", "말차파인트", "망고요거트파인트", "망고쫀득", "망고쫀득바", "멜론바", "멜론쫀득",
  "멜론쫀득바", "모나카", "민트초코파인트", "밀크티파인트", "바나나콘", "바닐라빈파인트", "바닐라초코바",
  "바스크치즈케이크파인트", "밤티라미수", "복숭아생요거트바", "복숭아요거트파인트", "블랙트러플하몽칩", "블루베리생요거트바",
  "빵샌드", "생요거트파인트", "생우유모나카", "생우유파인트", "생크림롤", "생크림빵", "샤베트", "소금빵", "소보로빵",
  "솔티초코볼선데", "쉐이크", "아몬드스윗", "아이스크림", "애플망고생요거트바", "애플민트파인트", "오렌지제로바",
  "옥수수듬뿍바", "옥수수모나카", "옥수수파인트", "요거트바", "우유", "웨하스", "자두제로바", "저당딸기초코", "저당멜론바",
  "제로바", "쫀득바", "초코롤", "초코모나카", "초코바", "초코소라빵", "초코파인트", "초코퐁당", "치즈케이크",
  "치즈케이크파인트", "케이크", "쿠앤크모나카", "쿠앤크파인트", "쿠키앤크림초코바", "쿨소다 쭈쭈바", "토피넛콘", "파베콘",
  "파인트", "팝콘", "포도제로바", "피치망고듬뿍바", "호빵", "황치즈롤",
];

test("🚨 쫀득바를 누르면 그릭복숭아쫀득바도 같이 켜진다", () => {
  assert.deepEqual(familyMembers("쫀득바", DB_PRODUCTS).sort(), ["그릭복숭아쫀득바", "망고쫀득바", "멜론쫀득바"].sort());
});

test("전수: 계열명으로 끝나는 제품은 사용자 지정 제외 3개만 빼고 전부 그 계열에 묶인다", () => {
  const excluded = new Set(["넛티초코바", "초콜릿초코바", "옥수수듬뿍바"]);
  for (const p of DB_PRODUCTS) {
    const fam = PRODUCT_FAMILY_ORDER.find(f => p !== f && p.endsWith(f));
    if (!fam) continue;
    assert.equal(familyOf(p), excluded.has(p) ? null : fam, p);
  }
});

test("위→아래(상위 클릭)와 아래→위(하위 클릭) 판정이 같다 — 짝짝이 금지", () => {
  for (const fam of PRODUCT_FAMILY_ORDER) {
    for (const m of familyMembers(fam, DB_PRODUCTS)) assert.equal(familyOf(m), fam, m);
  }
});

test("사용자 지정 제외: 초코바 ← 넛티초코바·초콜릿초코바 / 듬뿍바 ← 옥수수듬뿍바", () => {
  assert.equal(familyOf("넛티초코바"), null);
  assert.equal(familyOf("초콜릿초코바"), null);
  assert.equal(familyOf("옥수수듬뿍바"), null);
  assert.ok(familyMembers("초코바", DB_PRODUCTS).includes("말차초코바"));
});

test("이름에 요거트가 있어도 …파인트는 파인트다(요거트바 아님)", () => {
  assert.equal(familyOf("망고요거트파인트"), "파인트");
  assert.equal(familyOf("딸기생요거트바"), "요거트바");
});

test("계열 자신·계열 없는 제품은 상위가 없다", () => {
  for (const p of ["쫀득바", "파인트", "라라스윗", "멜론바", "팝콘"]) assert.equal(familyOf(p), null, p);
});

test("무상노출 화면은 하위 제품 목록을 다시 손으로 들고 있지 않다(소스 계약)", () => {
  const src = readFileSync(join(import.meta.dirname, "../app/organic/page.tsx"), "utf8");
  assert.doesNotMatch(src, /PRODUCT_GROUPS|PRODUCT_PARENTS/);
  assert.doesNotMatch(src, /"쫀득바":\s*\[/);
  assert.match(src, /from "@\/lib\/organicProductFamily"/);
});

test("칩 클릭: 쫀득바 켜기 → 그릭복숭아쫀득바 포함 4개, 다시 누르면 전부 꺼짐", () => {
  const on = toggleProductSelection([], "쫀득바", DB_PRODUCTS);
  assert.deepEqual([...on].sort(), ["그릭복숭아쫀득바", "망고쫀득바", "멜론쫀득바", "쫀득바"].sort());
  assert.deepEqual(toggleProductSelection(on, "쫀득바", DB_PRODUCTS), []);
});

test("칩 클릭: 하위를 켜면 상위도 켜지고, 마지막 하위를 끄면 상위도 꺼진다(다른 선택은 유지)", () => {
  let sel = toggleProductSelection(["팝콘"], "그릭복숭아쫀득바", DB_PRODUCTS);
  assert.deepEqual(sel, ["팝콘", "그릭복숭아쫀득바", "쫀득바"]);
  sel = toggleProductSelection(sel, "그릭복숭아쫀득바", DB_PRODUCTS);
  assert.deepEqual(sel, ["팝콘"]);
});

test("칩 클릭: 모든 계열에서 상위를 켜면 접미사가 같은 제품이 (제외분 빼고) 전부 켜진다", () => {
  for (const fam of PRODUCT_FAMILY_ORDER) {
    const on = new Set(toggleProductSelection([], fam, DB_PRODUCTS));
    for (const p of DB_PRODUCTS) {
      if (p === fam || !p.endsWith(fam)) continue;
      const excluded = ["넛티초코바", "초콜릿초코바", "옥수수듬뿍바"].includes(p);
      assert.equal(on.has(p), !excluded, `${fam} → ${p}`);
    }
  }
});

test("칩 클릭: 제외 제품(옥수수듬뿍바)은 눌러도 듬뿍바를 끌고 오지 않는다", () => {
  assert.deepEqual(toggleProductSelection([], "옥수수듬뿍바", DB_PRODUCTS), ["옥수수듬뿍바"]);
});
