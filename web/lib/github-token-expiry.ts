type TokenExpiryEnv = Record<string, string | undefined>;

export type TokenExpiryFinding = {
  token: string;
  expiresAtEnv: string;
  severity: "missing_token" | "missing_expiry" | "invalid_expiry" | "expired" | "expiring";
  daysLeft: number | null;
  expiresAt: string | null;
  message: string;
};

const DEFAULT_WARN_DAYS = 30;

const WATCHED_TOKENS = [
  {
    token: "GH_DISPATCH_TOKEN",
    expiresAtEnv: "GH_DISPATCH_TOKEN_EXPIRES_AT",
    required: true,
    purpose: "GitHub Actions workflow_dispatch",
  },
  {
    token: "OPS_GITHUB_TOKEN",
    expiresAtEnv: "OPS_GITHUB_TOKEN_EXPIRES_AT",
    required: false,
    purpose: "GitHub Actions run lookup",
  },
] as const;

function parseWarnDays(env: TokenExpiryEnv): number {
  const raw = Number(env.GITHUB_TOKEN_EXPIRY_WARN_DAYS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WARN_DAYS;
}

function parseExpiry(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T23:59:59Z` : trimmed;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysUntil(expiresAt: Date, now: Date): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

export function getGitHubTokenExpiryFindings(
  env: TokenExpiryEnv = process.env,
  now: Date = new Date(),
): TokenExpiryFinding[] {
  const warnDays = parseWarnDays(env);
  const findings: TokenExpiryFinding[] = [];

  for (const spec of WATCHED_TOKENS) {
    const tokenValue = env[spec.token]?.trim();
    const expiryValue = env[spec.expiresAtEnv]?.trim();

    if (!tokenValue) {
      if (spec.required) {
        findings.push({
          token: spec.token,
          expiresAtEnv: spec.expiresAtEnv,
          severity: "missing_token",
          daysLeft: null,
          expiresAt: null,
          message: `${spec.token} is missing; ${spec.purpose} cannot be guaranteed.`,
        });
      }
      continue;
    }

    if (!expiryValue) {
      findings.push({
        token: spec.token,
        expiresAtEnv: spec.expiresAtEnv,
        severity: "missing_expiry",
        daysLeft: null,
        expiresAt: null,
        message: `${spec.token} has no ${spec.expiresAtEnv}; expiry cannot be monitored.`,
      });
      continue;
    }

    const expiry = parseExpiry(expiryValue);
    if (!expiry) {
      findings.push({
        token: spec.token,
        expiresAtEnv: spec.expiresAtEnv,
        severity: "invalid_expiry",
        daysLeft: null,
        expiresAt: expiryValue,
        message: `${spec.expiresAtEnv} is invalid: ${expiryValue}`,
      });
      continue;
    }

    const left = daysUntil(expiry, now);
    if (left < 0) {
      findings.push({
        token: spec.token,
        expiresAtEnv: spec.expiresAtEnv,
        severity: "expired",
        daysLeft: left,
        expiresAt: expiry.toISOString(),
        message: `${spec.token} expired ${Math.abs(left)} day(s) ago.`,
      });
    } else if (left <= warnDays) {
      findings.push({
        token: spec.token,
        expiresAtEnv: spec.expiresAtEnv,
        severity: "expiring",
        daysLeft: left,
        expiresAt: expiry.toISOString(),
        message: `${spec.token} expires in ${left} day(s).`,
      });
    }
  }

  return findings;
}

export function formatGitHubTokenExpiryMessage(findings: TokenExpiryFinding[]): string {
  if (findings.length === 0) return "";
  const lines = findings.map((f) => {
    const when = f.expiresAt ? ` (${f.expiresAt.slice(0, 10)})` : "";
    const setup = f.severity === "missing_expiry"
      ? ` Set ${f.expiresAtEnv}=YYYY-MM-DD after rotating the token.`
      : "";
    return `• ${f.token}: ${f.message}${when}${setup}`;
  });
  return [`⚠️ [GitHub 토큰 만료 점검] 장기 토큰 갱신/확인이 필요합니다.`, ...lines].join("\n");
}
