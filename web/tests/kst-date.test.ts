import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysToDate, daysAgoKST, isIsoDateString, kstDateOf, todayKST, utcDateOf } from "../lib/dateRule.ts";

// 2026-10-19: UTC 타임스탬프를 `toISOString().slice(0, 10)`으로 날짜화해 KST 00~09시 기록이 하루 일찍
// 읽혔다(파이썬 쪽 수집 사각 오탐·게시일 추출과 같은 계열). 업무 날짜는 kstDateOf/todayKST로만 만든다.

test("kstDateOf: UTC 시각을 KST 날짜로", () => {
  assert.equal(kstDateOf("2026-10-18T23:33:25.123Z"), "2026-10-19"); // 사고 재현(KST 08:33)
  assert.equal(kstDateOf("2026-10-18T14:59:59Z"), "2026-10-18");
  assert.equal(kstDateOf("2026-10-18T15:00:00+00:00"), "2026-10-19");
  assert.equal(kstDateOf("2026-10-18T23:33:25"), "2026-10-19"); // 오프셋 없음 = UTC
  assert.equal(kstDateOf("2026-10-19T08:33:25+09:00"), "2026-10-19");
  assert.equal(kstDateOf("2026-10-17"), "2026-10-17"); // 날짜만 = 그대로
  assert.equal(kstDateOf(1760716800), "2025-10-18"); // 유닉스 초 2025-10-17T16:00Z
  assert.equal(kstDateOf(1760716800000), "2025-10-18"); // 밀리초
  assert.equal(kstDateOf(new Date("2026-10-18T23:00:00Z")), "2026-10-19");
  assert.equal(kstDateOf(null), null);
  assert.equal(kstDateOf(""), null);
  assert.equal(kstDateOf("not a date"), null);
});

// 코드 전체 검사(웹·파이썬·Apps Script·워크플로)는 tests/kst-date-guard.test.ts 로 옮겼다(pre-push 훅에서도 돈다).

test("addDaysToDate: 날짜만 더하므로 시간대·월말·윤년과 무관", () => {
  assert.equal(addDaysToDate("2026-10-19", -1), "2026-10-18");
  assert.equal(addDaysToDate("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysToDate("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysToDate("2026-01-01", -1), "2025-12-31");
  assert.equal(addDaysToDate("2026-10-19T23:59:00Z", 0), "2026-10-19"); // 앞 10자리 날짜만 본다
});

test("isIsoDateString: 형식+달력 검증", () => {
  assert.equal(isIsoDateString("2026-10-19"), true);
  assert.equal(isIsoDateString("2026-02-30"), false);
  assert.equal(isIsoDateString("2026-1-9"), false);
});

test("daysAgoKST: KST 오늘 기준", () => {
  assert.equal(daysAgoKST(0), todayKST());
  assert.equal(daysAgoKST(1), addDaysToDate(todayKST(), -1));
});

test("utcDateOf: 의도적 UTC(일 버킷)만 — 사건 시각엔 kstDateOf와 다를 수 있음을 고정", () => {
  assert.equal(utcDateOf(Date.parse("2026-10-19T00:00:00Z")), "2026-10-19"); // Trends 일 버킷
  assert.equal(utcDateOf(Date.parse("2026-10-18T23:33:00Z")), "2026-10-18");
  assert.equal(kstDateOf("2026-10-18T23:33:00Z"), "2026-10-19");             // 같은 시각, 업무 날짜는 KST
  assert.equal(utcDateOf(NaN), null);
});
