// 협찬 모니터링 제작자·기획자 필터 — 한 칸에 여러 명이면 사람별로 나눈다.
// 2026-10-26 사용자: "제작자가 2명이상 한번에 들어가있는 건 각각 분리해줘 — 박현지,김해솔,이선민 각각".
// 아래 PLANNERS 는 그날 sponsored_posts 5,082행의 기획자 칸 값 전부(실측, 33종 중 묶음 4종).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { matchesPersonFilter, personNameOptions, personNames } from "../lib/personNames.ts";

const PLANNERS = [
  "고가영", "권설호", "김민우", "김바다", "김어진", "김유진", "김해솔", "김현빈", "노현경", "문선정", "박지원", "박현지",
  "박현지, 김해솔", "박현지, 이선민", "손유곤", "오형선", "오혜정", "이도경", "이서영", "이선민", "이선민, 권설호",
  "이선민, 박현지", "이세진", "이수현", "이재원", "이채윤", "정요한", "최재헌", "최진환", "함주현", "허재희", "홍정민", "황경원",
];

test("🚨 기획자 옵션에 '박현지, 김해솔' 같은 묶음이 없고 사람별로 한 번씩만 나온다", () => {
  const opts = personNameOptions(PLANNERS);
  assert.ok(opts.every(o => !o.includes(",")), opts.join("|"));
  for (const n of ["박현지", "김해솔", "이선민", "권설호"]) assert.equal(opts.filter(o => o === n).length, 1, n);
  assert.equal(opts.length, 29); // 33종 − 묶음 4종(구성원은 모두 단독으로도 존재)
});

test("박현지를 고르면 단독·묶음 게시물 모두 걸리고, 관계없는 사람은 안 걸린다", () => {
  for (const v of ["박현지", "박현지, 김해솔", "박현지, 이선민", "이선민, 박현지"]) assert.equal(matchesPersonFilter(v, ["박현지"]), true, v);
  for (const v of ["이선민", "이선민, 권설호", "김해솔", null, ""]) assert.equal(matchesPersonFilter(v, ["박현지"]), false, String(v));
});

test("아무도 안 고르면 전부 통과(빈 칸 포함)", () => {
  assert.equal(matchesPersonFilter(null, []), true);
  assert.equal(matchesPersonFilter("박현지, 김해솔", []), true);
});

test("구분자·공백 변형도 같은 사람으로 본다", () => {
  assert.deepEqual(personNames("박현지,김해솔"), ["박현지", "김해솔"]);
  assert.deepEqual(personNames(" 박현지 / 이선민 "), ["박현지", "이선민"]);
  assert.deepEqual(personNames("박현지, 박현지"), ["박현지"]);
  assert.deepEqual(personNames(undefined), []);
});

test("협찬 모니터링 화면이 이 헬퍼로 옵션·필터를 만든다(소스 계약)", () => {
  const src = readFileSync(join(import.meta.dirname, "../app/monitoring/page.tsx"), "utf8");
  assert.match(src, /personNameOptions\(posts\.map\(p => p\.planner\)\)/);
  assert.match(src, /personNameOptions\(posts\.map\(p => p\.creator\)\)/);
  assert.match(src, /matchesPersonFilter\(post\.planner, filters\.plannerNames\)/);
  assert.match(src, /matchesPersonFilter\(post\.creator, filters\.creatorNames\)/);
});
