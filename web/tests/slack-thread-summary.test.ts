import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_SUMMARY_MODEL,
  isSummaryMention,
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
  assert.equal(shortName("이선민"), "선민");
  assert.equal(shortName("Alex"), "Alex");
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
  assert.deepEqual(seenBody.providerOptions, {
    gateway: {
      only: ["vertex"],
      disallowPromptTraining: true,
      zeroDataRetention: true,
    },
  });
  const serialized = JSON.stringify(seenBody);
  assert.match(serialized, /경원님 관련/);
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

test("both Slack entry points forward the runtime OIDC header to AI Gateway", () => {
  for (const path of ["app/api/slack-events/route.ts", "app/api/slack/summarize/route.ts"]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /headers\.get\("x-vercel-oidc-token"\)/, path);
    assert.match(source, /VERCEL_OIDC_TOKEN:/, path);
    assert.match(source, /env:\s*summaryEnv/, path);
  }
});
