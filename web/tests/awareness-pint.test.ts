import { test } from "node:test";
import assert from "node:assert/strict";
import { readPintDay, type Cell } from "../lib/awareness-pint.ts";

// 실제 파인트 인지광고 대시보드 탭(2026-10-27 브라우저 실물)의 헤더 구조를 축약해 옮긴 표.
// 열: 0 월 | 1 날짜 | 2 요일 | 3 총조회수 | 4 전환 조회수 | 5 인지조회수 |
//     6~8 인지영상_Meta(광고비·조회수·조회당비용) | 9~11 인지영상_YouTube | 12~14 인지영상_TikTok | 15~17 먹스타
const W = (cells: Record<number, Cell>, n = 18): Cell[] => Array.from({ length: n }, (_, i) => cells[i] ?? "");

function sheet(daily: Cell[][]): Cell[][] {
  return [
    W({ 0: "[월별 현황]" }),
    W({ 0: "구분", 6: "인지영상", 15: "먹스타" }),           // 월별 블록: 접미사 없는 '인지영상' → 탐지에 안 걸려야 함
    W({ 0: "월", 1: "날짜", 4: "전환 조회수", 6: "광고비", 7: "조회수" }),
    W({ 0: "26.10", 1: "월계", 4: 999999, 7: 888888 }),
    W({ 0: "[일자별 현황]" }),
    W({ 0: "구분", 6: "인지영상_Meta", 9: "인지영상_YouTube", 12: "인지영상_TikTok", 15: "먹스타" }),
    W({ 0: "월", 1: "날짜", 2: "요일", 3: "총 조회수 (전환+인지)", 4: "전환 조회수", 5: "인지 조회수",
        6: "광고비", 7: "조회수", 8: "조회당비용", 9: "광고비", 10: "조회수", 11: "조회당비용",
        12: "광고비", 13: "조회수", 14: "조회당비용", 15: "광고비", 16: "조회수", 17: "조회당비용" }),
    ...daily,
  ];
}

test("10/26 실물 값: 유튜브 인지영상·전환 조회수를 읽고, 먹스타 등 DB 채널 열은 안 읽는다", () => {
  const rows = sheet([
    W({ 0: "26.10", 1: "10.25", 2: "일", 4: 572408, 9: 1702874, 10: 117502 }),
    W({ 0: "26.10", 1: "10.26", 2: "월", 3: 342507, 4: 97539, 5: 244968, 9: 4684763, 10: 193586, 16: 10251 }),
  ]);
  const r = readPintDay(rows, "2026-10-26");
  assert.equal(r.found, true);
  if (!r.found) return;
  assert.deepEqual(r.youtube, { views: 193586, cost: 4684763 });
  assert.deepEqual(r.meta, { views: null, cost: null });     // 빈칸은 null(0 아님)
  assert.deepEqual(r.tiktok, { views: null, cost: null });
  assert.deepEqual(r.conversion, { views: 97539 });
  assert.equal(r.warn, undefined);
});

test("전환 칸이 비면 null → 리포트 '미입력'(0으로 읽지 않음)", () => {
  const r = readPintDay(sheet([W({ 0: "26.10", 1: "10.27", 2: "화", 9: 458696 })]), "2026-10-27");
  assert.equal(r.found, true);
  if (r.found) assert.equal(r.conversion.views, null);
});

test("월 칸으로 연도를 가른다 — 다음 해 같은 날짜 행을 잡지 않는다", () => {
  const rows = sheet([
    W({ 0: "26.10", 1: "10.26", 4: 97539 }),
    W({ 0: "27.10", 1: "10.26", 4: 1 }),
  ]);
  const r = readPintDay(rows, "2026-10-26");
  assert.equal(r.found, true);
  if (r.found) assert.equal(r.conversion.views, 97539);
});

test("날짜가 숫자로 들어와도 10.1(=10.10)과 10.01을 구분하고, 같은 날짜 두 행이면 warn", () => {
  const ok = readPintDay(sheet([W({ 0: 26.1, 1: 10.01, 4: 5 }), W({ 0: 26.1, 1: 10.1, 4: 7 })]), "2026-10-10");
  assert.equal(ok.found, true);
  if (ok.found) assert.equal(ok.conversion.views, 7);
  const dup = readPintDay(sheet([W({ 0: "26.10", 1: "10.10", 4: 1 }), W({ 0: "26.10", 1: 10.1, 4: 2 })]), "2026-10-10");
  assert.equal(dup.found, true);
  assert.ok(dup.warn?.some((w) => w.includes("행이 2개")));
});

test("조회수 칸에 ₩이 잡히면(열 밀림) 값 대신 warn", () => {
  const r = readPintDay(sheet([W({ 0: "26.10", 1: "10.26", 9: 100, 10: "₩4,684,763" })]), "2026-10-26");
  assert.equal(r.found, true);
  if (!r.found) return;
  assert.equal(r.youtube.views, null);
  assert.ok(r.warn?.some((w) => w.includes("유튜브")));
});

test("헤더를 못 찾으면 found:false + warn(발송 전 검수가 차단)", () => {
  const broken = sheet([W({ 0: "26.10", 1: "10.26" })]).map((r) => r.map((c) => (c === "인지영상_Meta" ? "Meta" : c)));
  const r = readPintDay(broken, "2026-10-26");
  assert.equal(r.found, false);
  assert.ok(r.warn && r.warn.length > 0);
});

test("행이 없으면 found:false(warn 없음)", () => {
  const r = readPintDay(sheet([W({ 0: "26.10", 1: "10.26" })]), "2026-11-01");
  assert.deepEqual(r, { date: "2026-11-01", found: false });
});
