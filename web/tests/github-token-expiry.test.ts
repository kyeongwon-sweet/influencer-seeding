import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatGitHubTokenExpiryMessage,
  getGitHubTokenExpiryFindings,
} from "../lib/github-token-expiry.ts";

const NOW = new Date("2026-08-07T00:00:00Z");

test("GH_DISPATCH_TOKEN is required for automated workflow dispatch", () => {
  const findings = getGitHubTokenExpiryFindings({}, NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].token, "GH_DISPATCH_TOKEN");
  assert.equal(findings[0].severity, "missing_token");
});

test("present tokens must carry an explicit expiry date for renewal alerts", () => {
  const findings = getGitHubTokenExpiryFindings({ GH_DISPATCH_TOKEN: "token" }, NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "missing_expiry");
  assert.equal(findings[0].expiresAtEnv, "GH_DISPATCH_TOKEN_EXPIRES_AT");
});

test("long-lived token outside the warning window is quiet", () => {
  const findings = getGitHubTokenExpiryFindings({
    GH_DISPATCH_TOKEN: "token",
    GH_DISPATCH_TOKEN_EXPIRES_AT: "2027-08-07",
  }, NOW);
  assert.deepEqual(findings, []);
});

test("expiring token is reported within the warning window", () => {
  const findings = getGitHubTokenExpiryFindings({
    GH_DISPATCH_TOKEN: "token",
    GH_DISPATCH_TOKEN_EXPIRES_AT: "2026-08-30",
  }, NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "expiring");
  assert.equal(findings[0].daysLeft, 24);
});

test("warning window is configurable", () => {
  const findings = getGitHubTokenExpiryFindings({
    GH_DISPATCH_TOKEN: "token",
    GH_DISPATCH_TOKEN_EXPIRES_AT: "2026-10-01",
    GITHUB_TOKEN_EXPIRY_WARN_DAYS: "60",
  }, NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "expiring");
});

test("expired and invalid dates are explicit", () => {
  assert.equal(getGitHubTokenExpiryFindings({
    GH_DISPATCH_TOKEN: "token",
    GH_DISPATCH_TOKEN_EXPIRES_AT: "2026-08-01",
  }, NOW)[0].severity, "expired");

  assert.equal(getGitHubTokenExpiryFindings({
    GH_DISPATCH_TOKEN: "token",
    GH_DISPATCH_TOKEN_EXPIRES_AT: "not-a-date",
  }, NOW)[0].severity, "invalid_expiry");
});

test("expiry Slack message includes the env var operators must set", () => {
  const msg = formatGitHubTokenExpiryMessage(getGitHubTokenExpiryFindings({
    GH_DISPATCH_TOKEN: "token",
  }, NOW));
  assert.match(msg, /GH_DISPATCH_TOKEN_EXPIRES_AT=YYYY-MM-DD/);
});
