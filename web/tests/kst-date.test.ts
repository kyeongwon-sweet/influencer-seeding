import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { kstDateOf } from "../lib/dateRule.ts";

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

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("서버 코드에 UTC 날짜 자르기(유닉스시각·현재시각)가 다시 들어오지 않는다", () => {
  const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files = [...walk(join(root, "lib")), ...walk(join(root, "app", "api"))];
  const patterns = [
    /new Date\(\s*[\w.]+\s*\*\s*1000\s*\)\.toISOString\(\)\.(?:slice|substring)\(0,\s*10\)/, // 유닉스 시각 → UTC 날짜
    /new Date\(\)\.toISOString\(\)\.(?:slice|substring)\(0,\s*10\)/, // 지금 → UTC 날짜(KST 오전엔 어제)
  ];
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (line.includes("utc-date-ok")) return; // 의도적 UTC(예: Trends 일 버킷) — 사유 주석 필수
      if (patterns.some(re => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], "kstDateOf()/todayKST()를 쓰세요:\n" + hits.join("\n"));
});
