import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedFieldDrift, formatLockedDrift } from "../lib/locked-field-drift.ts";

// 2026-08-03 사고 회귀: `이나 (인스타)`의 manual_fields에 posted_at이 있어 시트 정정이 DB에
// 영영 반영되지 않았고(DB 6/07 ↔ 실제 6/09), 그 2일 차이로 수집기 게시일 가드가 매일
// 실측 2,181,673을 버렸다. 잠금은 유지하되 '무시했다'는 사실은 반드시 드러나야 한다.

test("사고 재현: 잠긴 필드에서 시트와 DB가 다르면 드리프트", () => {
  assert.equal(lockedFieldDrift("2026-06-09", "2026-06-07"), true);
});

test("같은 값이면 드리프트 아님(정상 잠금 상태)", () => {
  assert.equal(lockedFieldDrift("2026-07-15", "2026-07-15"), false);
});

test("시트가 비어 있으면 드리프트 아님 — 원래 무시하는 게 정책(빈칸이 DB를 지우지 않음)", () => {
  for (const empty of [null, undefined, ""]) {
    assert.equal(lockedFieldDrift(empty, "2026-06-07"), false);
  }
});

test("DB가 비어 있고 시트에 값이 있으면 드리프트(잠금 탓에 영영 못 채움)", () => {
  assert.equal(lockedFieldDrift("2026-06-09", null), true);
});

test("공백·타입 차이는 드리프트로 보지 않는다(숫자 비용 등 오탐 방지)", () => {
  assert.equal(lockedFieldDrift(" 2026-06-09 ", "2026-06-09"), false);
  assert.equal(lockedFieldDrift(100000, "100000"), false);
});

test("드리프트 0건이면 알림 문구를 만들지 않는다(조용함)", () => {
  assert.equal(formatLockedDrift([]), null);
});

test("알림 문구에 필드·양쪽 값·URL이 들어가고, 초과분은 개수로 요약", () => {
  const many = Array.from({ length: 11 }, (_, i) => ({
    url: `https://www.instagram.com/p/X${i}/`, field: "posted_at", sheet: "2026-06-09", db: "2026-06-07",
  }));
  const msg = formatLockedDrift(many)!;
  assert.match(msg, /11건/);
  assert.match(msg, /posted_at: 시트=2026-06-09 \/ DB=2026-06-07/);
  assert.match(msg, /\.\.\.외 3건/);
});
