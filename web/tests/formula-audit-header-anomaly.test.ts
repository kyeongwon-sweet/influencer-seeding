import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { findUnparsableDateHeaders, resolveMetricDateColumns } from "../lib/formula-audit.ts";

// 실측(2026-09-03 라이브 연동시트 gviz 읽기): 메타 A~O, 날짜 구간 P~DU, 그 뒤 등록상태.
const START = 15;          // incCol(I=8) 다음이 아니라, 테스트는 구간을 직접 지정
const YEAR = 2026;
const BROKEN_P1 = '\n\n\n=IF(COUNT(P2:DS2)=0,"",MAX(P2:DS2))';

function band(labels: Array<string | number | null>) {
  return { header: labels, start: 0, end: labels.length };
}

test("사고 재현: 날짜 자리에 H수식 텍스트가 덮이면 그 칸을 짚어낸다", () => {
  const h = [BROKEN_P1, "2026. 5. 18", "2026. 5. 19"];
  const out = findUnparsableDateHeaders(h, 0, h.length, YEAR);
  assert.equal(out.length, 1);
  assert.equal(out[0].idx, 0);
  assert.match(out[0].label, /MAX\(P2:DS2\)/);
});

test("2자리 연도·요일 접미 헤더는 감사가 날짜로 읽으므로 대상이 아니다", () => {
  // 실측: DS1="26.9.1.(화)", DU1="26.9.3.(목)" — 형식은 특이하지만 parseHeaderDate가 인식한다.
  const h = ["2026. 8. 31", "26.9.1.(화)", "2026. 9. 2", "26.9.3.(목)"];
  assert.deepEqual(findUnparsableDateHeaders(h, 0, h.length, YEAR), []);
  assert.equal(resolveMetricDateColumns(h, 0, h.length, YEAR).length, 4);
});

test("빈 헤더는 +1일 추정 대상이므로 보고하지 않는다", () => {
  const h = ["2026. 5. 18", "", ""];
  assert.deepEqual(findUnparsableDateHeaders(h, 0, h.length, YEAR), []);
  assert.equal(resolveMetricDateColumns(h, 0, h.length, YEAR).length, 3);
});

test("구간 밖(등록상태 등)은 애초에 대상이 아니다 — 호출부가 statusCol을 endExclusive로 준다", () => {
  const h = ["2026. 5. 18", "2026. 5. 19", "등록상태", "메모"];
  assert.deepEqual(findUnparsableDateHeaders(h, 0, 2, YEAR), []);
  // 구간을 잘못 넓히면 등록상태가 잡히는 게 정상 동작(호출부 계약 확인용)
  assert.equal(findUnparsableDateHeaders(h, 0, h.length, YEAR).length, 2);
});

test("감사 라우트는 I 다음 메타데이터가 아니라 상태 다음 날짜열부터 검사한다", () => {
  const src = fs.readFileSync("app/api/sponsored-posts/formula-audit/route.ts", "utf8");
  assert.match(src, /metricStatusCol\s*=\s*findCol\(\["상태"\]\)/);
  assert.match(src, /metricDateStart\(current\)/);
  assert.match(src, /current\.metricStatusCol\s*>\s*current\.incCol\s*\?\s*current\.metricStatusCol\s*\+\s*1/);
  assert.doesNotMatch(src, /findUnparsableDateHeaders\(\s*snapshot\.header,\s*snapshot\.incCol\s*\+\s*1/);
});

test("날짜로 인식된 칸과 미인식 칸은 겹치지 않는다(판정 파리티)", () => {
  const h = ["2026. 5. 17", BROKEN_P1, "26.5.19", "", "쓰레기", "2026. 5. 21"];
  const dates = new Set(resolveMetricDateColumns(h, 0, h.length, YEAR).map((c) => c.idx));
  const bad = findUnparsableDateHeaders(h, 0, h.length, YEAR).map((c) => c.idx);
  for (const idx of bad) assert.equal(dates.has(idx), false, `idx ${idx} 이중 판정`);
  assert.deepEqual(bad, [1, 4]);
});

test("감사 라우트가 실제로 이 검사를 호출하고 알림 맨 앞에 세운다", () => {
  const src = fs.readFileSync("app/api/sponsored-posts/formula-audit/route.ts", "utf8");
  assert.match(src, /findUnparsableDateHeaders/);
  // healthy 판정에 반영 — 헤더가 깨진 날 '정상'으로 닫히면 안 된다
  assert.match(src, /healthy\s*=\s*shapeHealthy\s*&&\s*unparsableDateHeaders\.length === 0/);
  // 알림은 원인 라인을 앞에 붙여 보낸다
  assert.match(src, /notifyBot\(notifyText\)/);
  assert.ok(src.indexOf("headerAlert") < src.indexOf("notifyBot(notifyText)"));
});
