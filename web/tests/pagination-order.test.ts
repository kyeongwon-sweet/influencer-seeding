import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();
const appRoot = join(root, "app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function statementAt(source: string, index: number): string {
  const start = source.lastIndexOf(";", index - 1) + 1;
  const end = source.indexOf(";", index);
  return source.slice(start, end === -1 ? source.length : end + 1);
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

const SAFE_QUERY_BUILDERS = new Map<string, RegExp>([
  // baseQuery() ends in uploaded_at + id ordering and is shared by limit and full-pagination reads.
  ["app/api/organic-mentions/route.ts", /baseQuery\(\)\.range\(/],
]);

// `id` 컬럼이 없는 테이블 — 유일 키가 자연 키다. range 문장의 정렬이 이 키 목록으로 **정확히** 끝나야 한다.
// 이 목록은 추측이 아니라 쓰기 쪽 `upsert({ onConflict })` 와 같아야 하며(아래 테스트가 강제),
// PostgREST onConflict 는 해당 UNIQUE 제약이 없으면 에러가 나므로 유일성이 DB 차원에서 보장된다.
// 배경(2026-09-30): 이 네 라우트가 페이지를 안 넘겨 google_search_trends(1,505행)가 앞 1,000행에서
// 잘렸고, 메인 그래프 구글 검색량 선이 8월 중순에서 끊겨 보였다.
const NATURAL_UNIQUE_ORDER = new Map<string, { keys: string[]; writer: string }>([
  ["app/api/google-trends/route.ts", { keys: ["measured_at", "keyword"], writer: "app/api/google-trends/webhook/route.ts" }],
  ["app/api/youtube-trends/route.ts", { keys: ["measured_at", "keyword"], writer: "app/api/youtube-trends/webhook/route.ts" }],
  ["app/api/brand-metrics/route.ts", { keys: ["measured_at"], writer: "app/api/brand-metrics/collect/route.ts" }],
  ["app/api/b2b-revenue/route.ts", { keys: ["date"], writer: "app/api/b2b-revenue/fetch/route.ts" }],
]);

function endsWith(keys: string[], suffix: string[]): boolean {
  return suffix.length <= keys.length && suffix.every((k, i) => keys[keys.length - suffix.length + i] === k);
}

test("every range pagination query ends with a unique id order", () => {
  const unsafe: string[] = [];

  for (const file of sourceFiles(appRoot)) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(root, file).replaceAll("\\", "/");
    for (const match of source.matchAll(/\.range\(/g)) {
      const index = match.index ?? 0;
      const statement = statementAt(source, index);
      const safeBuilder = SAFE_QUERY_BUILDERS.get(relativePath);
      if (safeBuilder?.test(statement)) continue;

      const orderKeys = [...statement.matchAll(/\.order\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
      const natural = NATURAL_UNIQUE_ORDER.get(relativePath);
      if (natural && endsWith(orderKeys, natural.keys)) continue;
      if (orderKeys.at(-1) !== "id") {
        unsafe.push(`${relativePath}:${lineAt(source, index)} order=[${orderKeys.join(", ") || "none"}]`);
      }
    }
  }

  assert.deepEqual(
    unsafe,
    [],
    `Supabase range pagination requires a unique final order key:\n${unsafe.join("\n")}`,
  );
});

test("the organic range exception keeps its id-ordered query builder", () => {
  const source = readFileSync(join(root, "app/api/organic-mentions/route.ts"), "utf8");
  assert.match(
    source,
    /\.order\("uploaded_at", \{ ascending: false, nullsFirst: false \}\)\s*\.order\("id", \{ ascending: true \}\)/,
  );
});

test("자연 유일 키 예외는 쓰기 쪽 onConflict 키와 정확히 같다", () => {
  for (const [route, { keys, writer }] of NATURAL_UNIQUE_ORDER) {
    const src = readFileSync(join(root, writer), "utf8");
    const conflicts = [...src.matchAll(/onConflict:\s*["']([^"']+)["']/g)].map((m) => m[1].split(",").map((k) => k.trim()));
    assert.ok(
      conflicts.some((c) => c.join(",") === keys.join(",")),
      `${route} 의 정렬 키 [${keys}] 가 ${writer} 의 onConflict ${JSON.stringify(conflicts)} 와 다르다 — 유일성 근거가 사라졌다`,
    );
  }
});
