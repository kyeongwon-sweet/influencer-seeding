import { test } from "node:test";
import assert from "node:assert/strict";
import { excludeFailedGitHubLookups, resolveGitHubActionsToken } from "../lib/github-actions-auth.ts";

test("운영 전용 GitHub 토큰을 기존 토큰보다 우선한다", () => {
  assert.equal(resolveGitHubActionsToken({
    OPS_GITHUB_TOKEN: " dedicated ",
    GITHUB_TOKEN: "legacy",
  }), "dedicated");
});

test("운영 전용 토큰이 없으면 기존 GITHUB_TOKEN을 사용한다", () => {
  assert.equal(resolveGitHubActionsToken({ GITHUB_TOKEN: " legacy " }), "legacy");
});

test("빈 토큰은 인증값으로 사용하지 않는다", () => {
  assert.equal(resolveGitHubActionsToken({ OPS_GITHUB_TOKEN: " ", GITHUB_TOKEN: "" }), undefined);
});

test("GitHub 조회 실패 workflow를 미발화 판정 대상에서 제외한다", () => {
  const targets = [{ workflow: "ok.yml" }, { workflow: "private-404.yml" }];
  assert.deepEqual(excludeFailedGitHubLookups(targets, ["private-404.yml"]), [{ workflow: "ok.yml" }]);
});
