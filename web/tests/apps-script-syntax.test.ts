// 연동시트 Apps Script(repo 정본) 문법 검사.
// 2026-10-27 사고: 자정 수집 트리거 함수의 알림 문구 따옴표 안에 실제 줄바꿈이 들어간 채 main 에 올라갔다
//   (테스트·빌드는 .gs 를 안 읽어서 통과). Codex 가 그대로 라이브에 붙였으면 스크립트 전체가 문법 오류로 멈춘다.
// Apps Script(V8)는 표준 JS 문법이라 node vm 으로 컴파일만 해 본다(실행하지 않음).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";

const ROOT = join(import.meta.dirname, "../..");

function gsFiles(): string[] {
  const files = ["Combined_Sheet_AppsScript.gs"];
  try {
    for (const f of readdirSync(join(ROOT, "apps-script"))) if (f.endsWith(".gs")) files.push(join("apps-script", f));
  } catch { /* 폴더가 없으면 루트 파일만 */ }
  return files;
}

for (const rel of gsFiles()) {
  test(`Apps Script 문법 오류 없음: ${rel}`, () => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.doesNotThrow(() => new Script(src, { filename: rel }), `${rel} 컴파일 실패`);
  });
}
