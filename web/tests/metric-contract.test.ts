// 배너 판정·증분 규칙의 **교차언어** 계약 — TS 측.
//
// 왜 필요한가 (2026-09-05): 같은 규칙이 TS(web/app/monitoring/lib.ts)와
// Python(scripts/channel_kind.py, scripts/notify_increments.py)에 각각 구현돼 있는데,
// 지금까지 양쪽 테스트가 **자기 모듈만** 봤다. 한쪽 상수만 바뀌면 리포트(Python)와
// 대시보드(TS)가 같은 게시물을 다르게 분류한다 — 2026-09-03~04 play/reach 혼재와 같은 증상.
//
// 계약 정본 = scripts/metric_contract.json. Python 짝은 scripts/test_metric_contract.py.
// 규칙을 바꾸려면 계약 파일 + 양쪽 구현을 함께 고쳐야 한다(한쪽만 고치면 둘 중 하나가 깨진다).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAGAZINE_BANNER_FROM,
  isBannerChannel,
  safeIncrement,
  type DailyStats,
} from "../app/monitoring/lib.ts";

const contract = JSON.parse(
  readFileSync(new URL("../../scripts/metric_contract.json", import.meta.url), "utf8"),
) as {
  magazine_banner_from: string;
  backlog_first_measurement_max_gap_days: number;
  banner_vectors: Array<{
    channel_type: string | null;
    posted_at: string | null;
    expected: boolean;
    why: string;
  }>;
};

const channelKindPy = readFileSync(
  new URL("../../scripts/channel_kind.py", import.meta.url),
  "utf8",
);
const notifyIncrementsPy = readFileSync(
  new URL("../../scripts/notify_increments.py", import.meta.url),
  "utf8",
);

// 패턴이 **정확히 1건**일 때만 값을 돌려준다.
// ⚠️ `.match()`는 첫 매치를 쓴다. 같은 모양이 앞쪽에 하나 더 생기면 계약 테스트가 엉뚱한 줄을
// 조용히 고정한다 — 드리프트를 막으려는 테스트가 스스로 조용히 실패하는 꼴이다.
// 0건=이름/형태 변경, 2건 이상=어느 줄을 고정할지 사람이 정해야 함. 둘 다 실패시킨다.
function soleMatch(re: RegExp, src: string, what: string, path: string): string {
  const hits = [...src.matchAll(re)].map((m) => m[1]);
  assert.equal(
    hits.length,
    1,
    `${path} 에서 '${what}' 패턴이 ${hits.length}건 매치됐다(1건이어야 함). ` +
      "0건=이름/형태가 바뀜, 2건 이상=첫 매치가 의도한 줄이 아닐 수 있음. " +
      "패턴을 좁히거나 이 계약 테스트를 함께 갱신할 것.",
  );
  return hits[0];
}

const row = (measured_at: string, play: number | null, reach: number | null = null): DailyStats => ({
  measured_at,
  play_count: play,
  reach_count: reach,
  likes_count: null,
  comments_count: null,
});

test("TS 상수가 계약과 같다", () => {
  assert.equal(MAGAZINE_BANNER_FROM, contract.magazine_banner_from);
});

test("Python 상수가 계약과 같다 (교차언어)", () => {
  const got = soleMatch(
    /MAGAZINE_BANNER_FROM\s*=\s*"([^"]+)"/g,
    channelKindPy,
    "MAGAZINE_BANNER_FROM 선언",
    "scripts/channel_kind.py",
  );
  assert.equal(
    got,
    contract.magazine_banner_from,
    "Python 상수만 바뀌면 리포트와 대시보드가 같은 매거진 글을 다르게 분류한다",
  );
});

test("isBannerChannel 이 계약 벡터를 그대로 재현한다", () => {
  for (const v of contract.banner_vectors) {
    assert.equal(
      isBannerChannel(v.channel_type, v.posted_at),
      v.expected,
      `ct=${JSON.stringify(v.channel_type)} posted=${JSON.stringify(v.posted_at)} : ${v.why}`,
    );
  }
});

test("백로그 창이 양쪽에서 같다 (교차언어)", () => {
  const want = contract.backlog_first_measurement_max_gap_days;
  const py = soleMatch(
    /\.days\s*>\s*(\d+)/g,
    notifyIncrementsPy,
    "백로그 창(.days > N)",
    "scripts/notify_increments.py",
  );
  assert.equal(Number(py), want, "Python 리포트의 '첫 측정=전액' 창이 계약과 다르다");
});

test("safeIncrement: baseline 은 '직전값'이 아니라 '이전 유효값의 최댓값'이다", () => {
  // 이 구분이 실제로 중요했다 — 이력 한 행이 유실되면 baseline 이 더 낮은 옛 값으로
  // 내려앉아 증분이 부풀려진다(2026-09-05 페이지 드롭 분석).
  const stats = [row("2026-09-01", 100), row("2026-09-02", 80), row("2026-09-03", 120)];
  assert.equal(safeIncrement(stats, stats[2], false, "2026-09-01"), 20); // 120 - max(100,80)
});

test("safeIncrement: 첫 유효측정은 게시 후 계약 일수 이내만 전액", () => {
  const within = [row("2026-09-08", 5000)];
  assert.equal(
    safeIncrement(within, within[0], false, "2026-09-01"),
    5000,
    "게시 후 7일 = 경계 안 → 전액",
  );
  const beyond = [row("2026-09-09", 5000)];
  assert.equal(
    safeIncrement(beyond, beyond[0], false, "2026-09-01"),
    null,
    "게시 후 8일 = 백로그 → null(스파이크 방지)",
  );
});

test("safeIncrement: 그날 측정이 없거나 0이면 증분이 아니다(공백≠0)", () => {
  const noMeasure = [row("2026-09-01", 100), row("2026-09-02", null)];
  assert.equal(safeIncrement(noMeasure, noMeasure[1], false, "2026-09-01"), null);
  const zero = [row("2026-09-01", 100), row("2026-09-02", 0)];
  assert.equal(safeIncrement(zero, zero[1], false, "2026-09-01"), null);
});

test("safeIncrement: 배너는 도달수(reach)로 계산한다", () => {
  const stats = [row("2026-09-01", null, 1000), row("2026-09-02", null, 1500)];
  assert.equal(safeIncrement(stats, stats[1], true, "2026-08-30"), 500);
});
