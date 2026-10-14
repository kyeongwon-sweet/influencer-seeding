import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SELF_DM_CHANNEL = "D0B2U2J8QNS";
const STATUS_USER = "U0B2Y0ZC8QZ";
const ALLOWED_CHANNELS = new Set([SELF_DM_CHANNEL, STATUS_USER]);
const MAX_BATCH = 35;
const TS_RE = /^\d+\.\d+$/;

type SlackResult = {
  ok?: boolean;
  error?: string;
  user?: string;
  bot_id?: string;
  team?: string;
};

function authorized(req: NextRequest): boolean {
  return checkCronAuth(req) === "ok";
}

function tokenOrNull(): string | null {
  return process.env.SLACK_BOT_TOKEN || null;
}

async function slackPost(token: string, method: string, params?: URLSearchParams): Promise<SlackResult> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    cache: "no-store",
  });
  return await response.json() as SlackResult;
}

async function identity(token: string) {
  const result = await slackPost(token, "auth.test");
  return {
    ok: result.ok === true,
    error: result.error ?? null,
    user: result.user ?? null,
    botId: result.bot_id ?? null,
    team: result.team ?? null,
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = tokenOrNull();
  if (!token) return NextResponse.json({ error: "SLACK_BOT_TOKEN missing" }, { status: 503 });

  const bot = await identity(token);
  return NextResponse.json({ ok: bot.ok, bot, writeEnabled: true, maxBatch: MAX_BATCH });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = tokenOrNull();
  if (!token) return NextResponse.json({ error: "SLACK_BOT_TOKEN missing" }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const channel = typeof payload.channel === "string" ? payload.channel : "";
  const timestamps = Array.isArray(payload.timestamps)
    ? [...new Set(payload.timestamps.filter((value): value is string => typeof value === "string"))]
    : [];
  const dryRun = payload.dryRun === true;
  const confirm = typeof payload.confirm === "string" ? payload.confirm : "";

  if (!ALLOWED_CHANNELS.has(channel)) {
    return NextResponse.json({ error: "channel not allowed" }, { status: 400 });
  }
  if (timestamps.length === 0 || timestamps.length > MAX_BATCH || timestamps.some(ts => !TS_RE.test(ts))) {
    return NextResponse.json({ error: `timestamps must contain 1-${MAX_BATCH} Slack message timestamps` }, { status: 400 });
  }
  if (!dryRun && confirm !== `DELETE ${channel}`) {
    return NextResponse.json({ error: "confirmation mismatch" }, { status: 400 });
  }

  const bot = await identity(token);
  if (!bot.ok) return NextResponse.json({ error: "Slack auth failed", bot }, { status: 502 });
  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, bot, channel, found: timestamps.length, deleted: 0, failed: 0 });
  }

  const failures: Array<{ ts: string; error: string }> = [];
  let deleted = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    const ts = timestamps[index];
    const params = new URLSearchParams({ channel, ts });
    if (channel === STATUS_USER) params.set("as_user", "true");
    const result = await slackPost(token, "chat.delete", params);
    if (result.ok) deleted += 1;
    else failures.push({ ts, error: result.error ?? "unknown" });
    if (index + 1 < timestamps.length) await new Promise(resolve => setTimeout(resolve, 1300));
  }

  return NextResponse.json({
    ok: failures.length === 0,
    dryRun: false,
    bot,
    channel,
    found: timestamps.length,
    deleted,
    failed: failures.length,
    failures,
  });
}
