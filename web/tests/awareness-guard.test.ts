import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewCellProblem } from "../lib/awareness-guard.ts";
import { readPintDay, type Cell } from "../lib/awareness-pint.ts";

test("조회수 칸: 정수·빈칸은 정상, 소수(조회당비용)·₩(광고비)는 열 밀림", () => {
  assert.equal(viewCellProblem(696, 696), null);
  assert.equal(viewCellProblem(0, 0), null);
  assert.equal(viewCellProblem("", null), null);
  // 2026-11-14 실사고 값: 메타 조회당비용 3.382… 이 조회수로 읽혔다.
  assert.match(viewCellProblem(3.382183908, 3.382183908) ?? "", /소수/);
  assert.match(viewCellProblem("₩2,354", 2354) ?? "", /₩/);
});

test("쫀득바 라우트도 같은 검사를 쓴다(₩만 보던 옛 검사로 되돌리지 말 것)", () => {
  const src = readFileSync(new URL("../app/api/awareness-ads/route.ts", import.meta.url), "utf8");
  assert.match(src, /viewCellProblem\(row\[i\], n\)/);
  assert.doesNotMatch(src, /function rawHasWon/);
});

const W = (cells: Record<number, Cell>, n = 18): Cell[] => Array.from({ length: n }, (_, i) => cells[i] ?? "");
test("파인트 탭: 조회수 칸이 소수면 값 대신 warn(발송 전 검수가 차단)", () => {
  const rows = [
    W({ 0: "[일자별 현황]" }),
    W({ 0: "구분", 6: "인지영상_Meta", 9: "인지영상_YouTube", 12: "인지영상_TikTok" }),
    W({ 0: "월", 1: "날짜", 2: "요일", 4: "전환 조회수", 6: "광고비", 7: "조회수", 8: "조회당비용",
        9: "광고비", 10: "조회수", 11: "조회당비용", 12: "광고비", 13: "조회수", 14: "조회당비용" }),
    W({ 0: "26.11", 1: "11.14", 2: "토", 4: 143447.5, 9: 68039, 10: 17.26002029 }),
  ];
  const r = readPintDay(rows, "2026-11-14");
  assert.equal(r.found, true);
  if (!r.found) return;
  assert.equal(r.youtube.views, null);
  assert.equal(r.youtube.cost, 68039);
  assert.ok(r.warn?.some((w) => w.includes("유튜브") && w.includes("소수")));
  assert.equal(r.conversion.views, 143447.5);   // 전환 조회수는 계산식이라 소수 정상 → 검사 안 함
});
