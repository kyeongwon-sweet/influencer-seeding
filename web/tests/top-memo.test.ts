import assert from "node:assert/strict";
import test from "node:test";
import { buildTopMemo, stripCommonAssetPrefix, type TopPost } from "../app/monitoring/top-memo.ts";

// 라이브(2026-09-03 /monitoring 월요일 메모박스)에서 그대로 가져온 실제 소재명.
// 전부 같은 캠페인 보일러플레이트로 시작해 메모박스에서 5줄이 동일하게 잘려 보였다.
const LIVE_ASSETS = [
  "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초딩유행템_var12.렉카_포켓몬.가정 불화 주범이라는 충격적인 요즘 유행 ㄷㄷ.디자인1.X_파인트P_김유진_260814_빙과_김도희",
  "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초등생유행_var6.렉카_원진운.현시각 아이브 보다 더 난리라는 이것.디자인2.X_2P_김바다_260805_빙과_최재헌",
  "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초등생유행_var7.렉카_원진운.충격적인 아이들 급식에 나왔다는 이것.디자인2.X_2P_김바다_260805_빙과_최재헌",
  "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초딩유행템_var2.렉카_세대차이.격세지감.라떼는 진짜 이랬음 정말임 .디자인1.X_파인트P_김유진_260814_빙과_최재헌",
  "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초딩유행템_var13.렉카_포켓몬.가정 불화 주범이라는 충격적인 요즘 유행 ㄷㄷ.디자인2.X_파인트P_김유진_260814_빙과_김도희",
];

test("strips the shared campaign prefix so rows differ from the first character", () => {
  const out = stripCommonAssetPrefix(LIVE_ASSETS);
  // 공통 접두사는 `…바이럴형_초`까지지만 토큰 중간(초)에서 자르지 않고 `_`까지만 걷어낸다.
  assert.equal(out[0].startsWith("초딩유행템_var12."), true);
  assert.equal(out[1].startsWith("초등생유행_var6."), true);
  assert.equal(new Set(out.map((a) => a.slice(0, 16))).size, 5, "5줄이 서로 구분돼야 한다");
  for (const a of out) assert.equal(a.includes("[26.08]F_V_JD멜"), false);
});

test("leaves names alone when there is nothing meaningful in common", () => {
  const assets = ["쫀득바 1차 캠페인 - 패션", "듬뿍바 2차 캠페인 - 뷰티"];
  assert.deepEqual(stripCommonAssetPrefix(assets), assets);
});

test("cuts only at a token boundary, never mid-token", () => {
  // 공통 부분은 "…_바이럴"까지지만 토큰 중간에서 자르면 말이 깨지므로 마지막 구분자(_)까지만 걷어낸다.
  const out = stripCommonAssetPrefix([
    "[26.08]캠페인_공통머리말_바이럴형_A",
    "[26.08]캠페인_공통머리말_바이럴견본_B",
  ]);
  assert.deepEqual(out, ["바이럴형_A", "바이럴견본_B"]);
});

test("skips stripping when the shared part is too short to be worth it", () => {
  // 토큰 경계까지 7자뿐 → 이름을 훼손할 위험만 있고 얻는 게 없어 그대로 둔다(보수적 하한 8자).
  const assets = ["쫀득바_출시_바이럴형_A", "쫀득바_출시_바이럴견본_B"];
  assert.deepEqual(stripCommonAssetPrefix(assets), assets);
});

test("single or empty asset names are untouched", () => {
  assert.deepEqual(stripCommonAssetPrefix(["오직 하나"]), ["오직 하나"]);
  assert.deepEqual(stripCommonAssetPrefix([]), []);
  assert.deepEqual(stripCommonAssetPrefix(["", ""]), ["", ""]);
  // 값 없는 소재명이 섞여도 나머지는 정상 처리되고 빈 값은 빈 값으로 남는다.
  const mixed = stripCommonAssetPrefix(["", "쫀득바_출시_바이럴형_A", "쫀득바_출시_바이럴형_B"]);
  assert.deepEqual(mixed, ["", "A", "B"]);
});

const row = (account: string, asset: string, value: number, unitCost: number | null): TopPost =>
  ({ account, asset, value, unitCost });

test("ranks by value desc, counts the remainder, and reports the cheapest unit cost", () => {
  const memo = buildTopMemo([
    row("a", "x", 100, 5),
    row("b", "y", 300, 9),
    row("c", "z", 200, 0.7),   // 조회수 상위는 아니지만 최저 단가
    row("d", "w", 50, null),
    row("e", "v", 10, 3),
    row("f", "u", 5, 3),
  ]);
  assert.deepEqual(memo.items.map((i) => i.account), ["b", "c", "a", "d", "e"]);
  assert.equal(memo.more, 1);
  assert.equal(memo.best?.account, "c");
});

test("returns an empty memo for an empty bucket and never reports a cost without one", () => {
  assert.deepEqual(buildTopMemo([]), { items: [], more: 0, best: null });
  assert.equal(buildTopMemo([row("a", "x", 10, null)]).best, null);
});

test("prefix stripping applies to the rendered top-N only", () => {
  const rows = [
    row("a", "캠페인_공통_머리말_하나", 3, 1),
    row("b", "캠페인_공통_머리말_둘", 2, 1),
    row("c", "전혀 다른 이름", 1, 1),   // n=2 라 표시되지 않음 → 접두사 계산에서 제외
  ];
  const memo = buildTopMemo(rows, 2);
  assert.deepEqual(memo.items.map((i) => i.asset), ["하나", "둘"]);
  assert.equal(memo.more, 1);
});
