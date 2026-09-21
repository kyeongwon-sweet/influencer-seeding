// 프로필 URL(인스타 스토리 등)의 중복 판정 — 행동 계약.
//
// 배경(2026-09-21 실측): 인스타 스토리는 영구 링크가 없어 노션·수기 모두 프로필 주소로 기록한다.
// URL만으로 중복을 보면 **같은 계정의 다른 날짜 노출이 한 건으로 묻힌다** —
// `운동하는 쩡`(jungyun_diet)의 2023-02-12(파인트)와 2023-11-30(초코바)가 그렇게 1건만 들어갔다.
// 그래서 프로필형 URL에 한해 업로드일자를 식별자에 더한다. 게시물 URL은 종전대로 URL만 쓴다.

import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalMentionUrl,
  mentionDedupeKey,
  splitDuplicateMentions,
} from "../lib/url-utils.ts";

const PROFILE = "https://www.instagram.com/jungyun_diet/";
const POST = "https://www.instagram.com/p/C9UwQTNy-1x/";

test("프로필 URL은 날짜가 다르면 다른 건으로 본다", () => {
  const a = mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-02-12" });
  const b = mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-11-30" });
  assert.notEqual(a, b, "같은 계정의 다른 날짜 노출이 한 건으로 묻힌다");
  assert.equal(a, mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-02-12" }));
});

test("게시물 URL은 날짜가 달라도 같은 건이다", () => {
  // ⚠️ 여기에 날짜를 섞으면 같은 글이 날짜만 다르게 두 번 들어간다(수기 입력·재수집에서 흔하다).
  const a = mentionDedupeKey({ url: POST, uploaded_at: "2024-07-12" });
  const b = mentionDedupeKey({ url: POST, uploaded_at: "2024-08-01" });
  assert.equal(a, b);
  assert.equal(a, canonicalMentionUrl(POST));
});

test("날짜를 모르면 URL만으로 판정한다 — 중복 적재보다 누락이 낫다", () => {
  const known = mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-02-12" });
  for (const missing of [undefined, null, "", "몰라", "2023-02"]) {
    const k = mentionDedupeKey({ url: PROFILE, uploaded_at: missing });
    assert.equal(k, canonicalMentionUrl(PROFILE), `uploaded_at=${String(missing)}`);
    assert.notEqual(k, known);
  }
});

test("날짜시각(ISO)이 와도 날짜 부분만 쓴다", () => {
  assert.equal(
    mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-02-12T09:30:00+09:00" }),
    mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-02-12" }),
  );
});

test("URL 파라미터는 여전히 접힌다 — 정규화가 먼저다", () => {
  assert.equal(
    mentionDedupeKey({ url: PROFILE + "?igsh=abc", uploaded_at: "2023-02-12" }),
    mentionDedupeKey({ url: PROFILE, uploaded_at: "2023-02-12" }),
  );
});

test("splitDuplicateMentions: 같은 프로필의 다른 날짜는 둘 다 저장된다", () => {
  const items = [
    { url: PROFILE, uploaded_at: "2023-02-12", mentioned_product: "파인트" },
    { url: PROFILE, uploaded_at: "2023-11-30", mentioned_product: "초코바" },
  ];
  const { unique, duplicates } = splitDuplicateMentions(items, []);
  assert.equal(unique.length, 2);
  assert.equal(duplicates.length, 0);
});

test("splitDuplicateMentions: 같은 프로필·같은 날짜는 여전히 중복이다", () => {
  const items = [
    { url: PROFILE, uploaded_at: "2023-02-12" },
    { url: PROFILE + "?utm_source=x", uploaded_at: "2023-02-12" },
  ];
  const { unique, duplicates } = splitDuplicateMentions(items, []);
  assert.equal(unique.length, 1);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].reason, "in_batch");
});

test("기존 행을 {url, uploaded_at}로 넘기면 DB 중복이 걸러진다", () => {
  const { unique, duplicates } = splitDuplicateMentions(
    [{ url: PROFILE, uploaded_at: "2023-02-12" }],
    [{ url: PROFILE, uploaded_at: "2023-02-12" }],
  );
  assert.equal(unique.length, 0);
  assert.equal(duplicates[0].reason, "existing");
});

test("기존 행을 문자열로만 넘기면 프로필 신규분이 흡수된다 — 호출부가 uploaded_at을 꼭 넘겨야 하는 이유", () => {
  const { unique } = splitDuplicateMentions(
    [{ url: PROFILE, uploaded_at: "2023-11-30" }],
    [PROFILE],
  );
  assert.equal(unique.length, 0, "문자열 목록은 URL만 비교한다(구버전 호환)");
});

test("🚨 저장되는 url에 날짜 키가 새어 나가면 안 된다", () => {
  // key(`URL@날짜`)를 그대로 저장하면 링크가 깨진다.
  const { unique } = splitDuplicateMentions(
    [{ url: PROFILE + "?igsh=abc", uploaded_at: "2023-11-30" }],
    [],
  );
  assert.equal(unique[0].url, canonicalMentionUrl(PROFILE));
  assert.ok(!String(unique[0].url).includes("@"), "저장 URL에 @날짜가 붙었다");
  assert.ok(!String(unique[0].url).includes("2023-11-30"));
});

test("게시물 URL의 기존 중복 차단은 그대로다(회귀 방지)", () => {
  const { unique, duplicates } = splitDuplicateMentions(
    [{ url: "https://www.instagram.com/p/C9UwQTNy-1x/?img_index=5", uploaded_at: "2024-07-12" }],
    [{ url: POST, uploaded_at: null }],
  );
  assert.equal(unique.length, 0);
  assert.equal(duplicates[0].reason, "existing");
});

test("두 호출부가 uploaded_at을 함께 읽는다(소스 계약)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const rel of ["../app/api/organic-mentions/route.ts",
                     "../app/api/organic-mentions/import-notion/route.ts"]) {
    const src = readFileSync(join(import.meta.dirname, rel), "utf8");
    assert.match(src, /select\("url,uploaded_at"\)/,
      `${rel}: url만 읽으면 프로필 신규분이 조용히 흡수된다`);
  }
});

// ── 스키마와의 계약 ───────────────────────────────────────────────────
// DB 식별자(mention_key)는 SQL 함수가, 앱 식별자는 mentionDedupeKey 가 만든다.
// 두 판정이 어긋나면 **앱은 신규로 보는데 DB가 409로 거부**(또는 그 반대)한다 — 조용히 안 깨진다.

test("SQL 마이그레이션이 TS와 같은 프로필 판정 정규식을 쓴다", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const sql = readFileSync(
    join(import.meta.dirname, "../../supabase/migrations/20260921_organic_mentions_mention_key_step1.sql"),
    "utf8");
  // TS: /instagram\.com/i && !/\/(p|reels|reel|tv)\/[A-Za-z0-9_-]+/i
  assert.match(sql, /~\*\s*'instagram\\.com'/, "SQL 쪽 인스타 판정이 바뀌었다");
  assert.match(sql, /!~\*\s*'\/\(p\|reels\|reel\|tv\)\/\[A-Za-z0-9_-\]\+'/, "SQL 쪽 게시물 경로 판정이 바뀌었다");
  assert.match(sql, /#uploaded=/, "접미사 형식이 TS(mentionDedupeKey)와 달라졌다");
  assert.match(sql, /YYYY-MM-DD/, "날짜 포맷이 TS(slice(0,10))와 달라졌다");
});

test("업서트가 mention_key를 대상으로 한다 — url 단독 UNIQUE는 제거된다", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "../app/api/apify-webhook/route.ts"), "utf8");
  // ⚠️ organic_mentions 업서트만 본다. 같은 파일의 `influencers` 는 자체 url UNIQUE 를 그대로 쓰므로
  //    파일 전체에서 onConflict:'url' 을 금지하면 멀쩡한 코드를 막는다(처음에 그렇게 짰다가 잡혔다).
  const organicUpserts = [...src.matchAll(/from\('organic_mentions'\)\.upsert\([^)]*\)/g)].map((m) => m[0]);
  assert.equal(organicUpserts.length, 2, "organic_mentions 업서트가 2곳이 아니다 — 계약 갱신 필요");
  for (const call of organicUpserts) {
    assert.ok(!/onConflict:\s*'url'/.test(call),
      "onConflict:'url' 이 남아 있으면 3단계 SQL 적용 순간 수집이 실패한다");
    assert.match(call, /onConflict:\s*'mention_key'/);
  }
  assert.match(src, /isInstagramNonPostUrl\(cleanUrl\)\) continue;/,
    "조회수 업서트가 프로필 URL을 거르지 않으면 날짜 없는 중복 행이 생긴다");
});
