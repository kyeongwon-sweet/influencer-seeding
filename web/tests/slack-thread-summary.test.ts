import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_SUMMARY_MODEL,
  SUMMARY_MAX_TOKENS,
  formatSummaryHeader,
  isGeneratedSummary,
  isSummaryMention,
  normalizeSlackSummary,
  shortName,
  summarizeWithAI,
} from "../lib/slack-thread-summary.ts";

test("recognizes only the intended @bot summary phrases", () => {
  for (const text of ["<@U123> 요약", "<@U123> 요약해줘", "<@U123> 요약해주세요!", "  <@U123>   요약  "]) {
    assert.equal(isSummaryMention(text), true, text);
  }
  for (const text of ["<@U123> 안녕", "요약본 공유", "<@U123> 요약 내일 해줘", ""]) {
    assert.equal(isSummaryMention(text), false, text);
  }
});

test("uses the requester's given name for Korean full names", () => {
  assert.equal(shortName("황경원"), "경원");
  assert.equal(shortName("황 경원 (빙과_마케팅T_스틱바P)"), "경원");
  assert.equal(shortName("이선민"), "선민");
  assert.equal(shortName("Alex"), "Alex");
});

test("normalizes common Markdown into Slack mrkdwn", () => {
  assert.equal(
    normalizeSlackSummary(
      "### 요약\n\n1) 한 줄 개요 첫 문장\n\n**2) **핵심 내용****\n- 첫째\n* 둘째\n\n**3) **경원님 관련****\n- 없음",
    ),
    "*한눈에 보기*\n> 첫 문장\n\n*핵심 내용*\n• 첫째\n• 둘째\n\n*경원님 확인사항*\n• 별도 확인사항 없음",
  );
  assert.equal(
    normalizeSlackSummary(
      "**1) **한 줄 요약****\n한 문장\n\n**2) **핵심****\n- 첫째\n\n**3) **경원님 관련/할 일****\n- 직접 언급 없음",
    ),
    "*한눈에 보기*\n> 한 문장\n\n*핵심 내용*\n• 첫째\n\n*경원님 확인사항*\n• 별도 확인사항 없음",
  );
  assert.equal(
    normalizeSlackSummary(
      "* 한 줄 요약\n한 문장\n\n* 핵심\n- 첫째\n\n* 경원님 관련/할 일\n- 직접 언급 없음",
    ),
    "*한눈에 보기*\n> 한 문장\n\n*핵심 내용*\n• 첫째\n\n*경원님 확인사항*\n• 별도 확인사항 없음",
  );
});

test("formats title and metadata on separate lines", () => {
  assert.equal(formatSummaryHeader("황경원", 420), "📝 *스레드 요약*\n_경원님 요청 · 원문 420개_");
});

test("removes empty bullets and contradictory requester placeholders", () => {
  assert.equal(
    normalizeSlackSummary(
      "•\n\n한 줄 요약\n운영 현황과 후속 조치를 정리했습니다.\n\n핵심\n• 첫째\n• 둘째\n\n경원님 관련/할 일\n• 캠페인 상태를 확인해 주세요.\n• 직접 언급 없음",
    ),
    "*한눈에 보기*\n> 운영 현황과 후속 조치를 정리했습니다.\n\n*핵심 내용*\n• 첫째\n• 둘째\n\n*경원님 확인사항*\n• 캠페인 상태를 확인해 주세요.",
  );
});

test("uses a free-credit-compatible Gateway model by default", () => {
  assert.equal(DEFAULT_SUMMARY_MODEL, "google/gemini-2.5-flash-lite");
});

test("calls Vercel AI Gateway with OIDC and strict privacy routing", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenBody: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenAuth = String((init?.headers as Record<string, string>)?.authorization || "");
    seenBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "요약 결과" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await summarizeWithAI("대화", "황경원", {
    env: { VERCEL_OIDC_TOKEN: "oidc-test" },
    fetchImpl,
  });

  assert.equal(result, "요약 결과");
  assert.equal(seenUrl, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal(seenAuth, "Bearer oidc-test");
  assert.equal(seenBody.model, DEFAULT_SUMMARY_MODEL);
  assert.equal(seenBody.max_tokens, SUMMARY_MAX_TOKENS);
  assert.deepEqual(seenBody.providerOptions, {
    gateway: {
      only: ["vertex"],
      disallowPromptTraining: true,
      zeroDataRetention: true,
    },
  });
  const serialized = JSON.stringify(seenBody);
  assert.match(serialized, /전체 360자 이내/);
  assert.match(serialized, /핵심 내용.*최대 3개/);
  assert.match(serialized, /경원님 확인사항/);
  assert.match(serialized, /불릿 하나에는 사실 하나만 담고 65자 이내/);
});

test("Slack events route keeps app mention wiring and excludes the command message", () => {
  const source = fs.readFileSync("app/api/slack-events/route.ts", "utf8");
  assert.match(source, /e\.type === "app_mention"/);
  assert.match(source, /isSummaryMention/);
  assert.match(source, /runSlackThreadSummary/);
  assert.match(source, /includeCutoff:\s*false/);
  assert.match(source, /headers\.get\("x-vercel-oidc-token"\)/);
  assert.match(source, /env:\s*summaryEnv/);
  assert.match(source, /after\(async/);
});

test("repeated summary commands are excluded from the transcript", () => {
  const source = fs.readFileSync("lib/slack-thread-summary.ts", "utf8");
  assert.match(source, /!isSummaryMention\(message\.text \|\| ""\)/);
});

test("previous bot summaries are excluded from repeated summaries", () => {
  assert.equal(
    isGeneratedSummary("📝 *스레드 요약* — 요청: 경원님 (3개 메시지)\n\n요약 본문"),
    true,
  );
  assert.equal(isGeneratedSummary("📝 스레드 요약 — 요청: 경원님 (3개 메시지)"), true);
  assert.equal(isGeneratedSummary(":memo: *스레드 요약* — 요청: 경원님 (3개 메시지)"), true);
  assert.equal(isGeneratedSummary("📝 *스레드 요약*\n_경원님 요청 · 원문 3개_"), true);
  assert.equal(isGeneratedSummary("일반 대화에서 스레드 요약을 논의했습니다."), false);
});

test("both Slack entry points forward the runtime OIDC header to AI Gateway", () => {
  for (const path of ["app/api/slack-events/route.ts", "app/api/slack/summarize/route.ts"]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /headers\.get\("x-vercel-oidc-token"\)/, path);
    assert.match(source, /VERCEL_OIDC_TOKEN:/, path);
    assert.match(source, /env:\s*summaryEnv/, path);
  }
});
