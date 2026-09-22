// IG↔Facebook 교차게시 합산의 행동 계약 (2026-09-22)
//
// 배경(실측): 인스타 앱이 보여주는 조회수는 IG+FB 합계인데 우리는 IG 전용값만 저장해
// 퐁패밀리 https://www.instagram.com/p/DdeIMT0ynk2/ 가 대시보드 414,066 vs 실제 1,125,552 였다.
// 사용자 지시로 교차게시 글의 play_count 에 **합계**를 저장한다.
//
// 증분 규칙(사용자 결정 2026-09-22): 첫 FB 측정분은 **그날 증분에 전액 포함**한다.
// 처음엔 '어느 날에도 얹지 않는' 쪽이었으나 그러면 그만큼이 일일 리포트 총합에서 영구히
// 빠진다(리포트 대상 기준 718,363). 총량이 사라지는 것보다 낫다는 판단이다.
// ⚠️ 그래서 전환일 하루가 크게 튄다 — 실제 급상승이 아니라 합산 전환이다.
// ⚠️ Σ증분 == 최종 누적 불변식은 이 규칙에서 유지된다.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeStatsV2, fbAt, fbIncrement, safeIncrement, type DailyStats } from "../app/monitoring/lib.ts";

const day = (
  measured_at: string,
  play_count: number | null,
  fb_play_count: number | null = null,
): DailyStats => ({ measured_at, play_count, likes_count: null, comments_count: null, fb_play_count });

test("교차게시가 아니면 동작이 완전히 같다(회귀 방지)", () => {
  const stats = [day("2026-09-20", 1000), day("2026-09-21", 1500), day("2026-09-22", 1800)];
  assert.equal(safeIncrement(stats, stats[2], false, "2026-09-01"), 300);
  assert.equal(fbAt(stats, stats[2]), 0);
  assert.equal(fbIncrement(stats, stats[2]), 0);
});

test("합산 전환일: IG 증가분 + FB 전액이 그날 증분에 들어간다", () => {
  // 퐁패밀리 실측 형태: IG 로만 쌓이다가 전환일에 +FB 711,486.
  const stats = [
    day("2026-09-20", 410_000),
    day("2026-09-21", 414_066),
    day("2026-09-22", 1_125_552, 711_486),
  ];
  // IG 증가분 0(414,066 그대로) + FB 전액 711,486
  assert.equal(safeIncrement(stats, stats[2], false, "2026-09-01"), 711_486);
});

test("🚨 Σ증분 == 최종 누적 (교차게시 글도 총량이 안 샌다)", () => {
  // 이 불변식이 깨지면 리포트 총합이 대시보드 누적과 영구히 어긋난다.
  const stats = [
    day("2026-09-20", 100_000),
    day("2026-09-21", 150_000),
    day("2026-09-22", 900_000, 700_000),   // 전환: IG 200,000 + FB 700,000
    day("2026-09-23", 920_000, 705_000),   // IG +15,000 · FB +5,000
  ];
  const sum = stats.reduce(
    (acc, s) => acc + (safeIncrement(stats, s, false, "2026-09-19") ?? 0), 0);
  assert.equal(sum, 920_000, `Σ증분 ${sum} 이 최종 누적 920,000 과 다르다`);
});

test("두 번째 FB 측정부터는 실제 증가분이 더해진다", () => {
  const stats = [
    day("2026-09-22", 1_125_552, 711_486),
    day("2026-09-23", 1_130_552, 713_486),   // IG +3,000 · FB +2,000
  ];
  assert.equal(safeIncrement(stats, stats[1], false, "2026-09-01"), 5_000);
});

test("🚨 FB 조회가 하루 실패해도 증분이 튀지 않는다 — mono 보정이 합계를 유지하기 때문", () => {
  // 그날 fb 가 비는데 play_count 는 역행가드로 합계가 유지된다.
  // fb 를 0 으로 읽으면 IG 가 FB 만큼 갑자기 늘어난 것처럼 보여 증분이 폭발한다.
  const stats = [
    day("2026-09-22", 1_125_552, 711_486),
    day("2026-09-23", 1_125_552, null),      // FB 조회 실패 → 값 비고 play 는 그대로
  ];
  assert.equal(fbAt(stats, stats[1]), 711_486, "직전 FB 값을 이어 쓰지 않았다");
  assert.equal(safeIncrement(stats, stats[1], false, "2026-09-01"), 0);
});

test("첫 측정이 곧 첫 FB 측정이면 그날 전액(IG+FB)이 증분이다", () => {
  const stats = [day("2026-09-22", 50_000, 20_000)];
  assert.equal(safeIncrement(stats, stats[0], false, "2026-09-20"), 50_000);
});

test("배너(도달수)는 FB 합산과 무관하다", () => {
  const stats = [
    { ...day("2026-09-21", null), reach_count: 1_000 },
    { ...day("2026-09-22", null, 999_999), reach_count: 1_500 },
  ] as DailyStats[];
  assert.equal(safeIncrement(stats, stats[1], true, "2026-09-01"), 500);
});

test("fbIncrement: 첫 측정 전액, 이후 델타, 감소는 0", () => {
  const a = day("2026-09-22", 100, 50);
  const b = day("2026-09-23", 120, 70);
  const c = day("2026-09-24", 120, 60);       // FB 가 줄어든 이상값
  assert.equal(fbIncrement([a], a), 50, "첫 FB 측정 = 전액 귀속");
  assert.equal(fbIncrement([a, b], b), 20);
  assert.equal(fbIncrement([a, b, c], c), 0, "감소를 음수 증분으로 흘리면 총합이 깎인다");
});

test("decodeStatsV2: 7번째 항목을 FB 조회수로 읽는다", () => {
  const [row] = decodeStatsV2([["2026-09-22", 1_125_552, 10, 2, null, 1, 711_486]]);
  assert.equal(row.fb_play_count, 711_486);
});

test("decodeStatsV2: 6칸짜리 옛 튜플은 FB 를 null 로 읽는다 — 0 으로 읽으면 안 된다", () => {
  // 0 으로 읽으면 '교차게시 아님'과 '미측정'을 못 가른다. 배포 과도기·옛 캐시 응답에서 실제로 섞인다.
  const [row] = decodeStatsV2([["2026-09-22", 1000, 10, 2, null, 1]]);
  assert.equal(row.fb_play_count, null);
});

// ── 저장·전송 경로와의 계약 ──────────────────────────────────────────
// 값이 여기까지 안 오면 증분 규칙이 아무리 맞아도 소용없다.

test("API 라우트가 fb_play_count 를 읽어 7번째 칸으로 보낸다(소스 계약)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "../app/api/sponsored-posts/route.ts"), "utf8");
  const statCols = src.slice(src.indexOf("const STAT_COLS"), src.indexOf("const collect ="));
  assert.match(statCols, /fb_play_count/,
    "조회 컬럼에 없으면 증분이 FB 몫을 못 빼서 합산 시작일에 스파이크가 난다");
  // 열이 없을 때(마이그레이션 전 배포) 대시보드 전체가 비지 않도록 옛 컬럼으로 내려가는 길이 있어야 한다.
  assert.match(src, /statColsSupportFb/,
    "열 부재 폴백이 없으면 코드가 SQL 보다 먼저 나가는 순간 stats 조회가 전부 실패한다");
  assert.match(src, /s\.fb_play_count \?\? null,/,
    "튜플에 안 실으면 클라이언트가 값을 못 받는다");
});

test("리포트(Python)도 같은 규칙을 쓴다 — 한쪽만 고치면 숫자가 갈린다(소스 계약)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "../../scripts/notify_increments.py"), "utf8");
  assert.match(src, /select\("post_id, measured_at, play_count, reach_count, fb_play_count"\)/,
    "리포트가 fb_play_count 를 안 읽으면 대시보드와 증분이 달라진다");
  assert.match(src, /from cross_post_metrics import fb_increment, ig_only/,
    "Python 쪽 정본 모듈(scripts/cross_post_metrics.py)을 안 쓰면 규칙이 둘로 갈린다");
  const mod = readFileSync(join(import.meta.dirname, "../../scripts/cross_post_metrics.py"), "utf8");
  assert.match(mod, /def fb_at\(/, "FB 몫 이어쓰기(fbAt 대응)가 없다");
  assert.match(mod, /def fb_increment\(/, "FB 증분(fbIncrement 대응)이 없다");
});
