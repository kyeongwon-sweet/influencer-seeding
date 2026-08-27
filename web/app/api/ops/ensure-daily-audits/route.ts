import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { todayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { formatGitHubTokenExpiryMessage, getGitHubTokenExpiryFindings } from "@/lib/github-token-expiry";
import { notifyBot } from "@/lib/slack";
import { countTodaySuccess } from "@/lib/audit-fallback";
import { decideEnsure, formatEnsureSummary, needsNotify, type EnsureAction } from "@/lib/ensure-daily-audits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 아침 자동화 보장 — 오늘 안 돈 중요 워크플로만 `workflow_dispatch`로 깨운다.
 *
 * 배경(실측 2026-08-07): GitHub cron이 상시 3시간 지연(설정 10:10 → 실제 13:2x)에 이어
 * **이틀 연속 완전 누락**했다. Apps Script 시간 트리거는 같은 기간 정상 발화했다.
 * → Apps Script(09:40 KST)가 이 라우트를 호출 = **시각은 구글이 보장, 실행은 GitHub이 담당**.
 *   Python+시크릿 작업은 HTTP로 직접 못 부른다 → 포팅 대신 dispatch로 깨운다.
 *
 * 중복 방지: 오늘 성공 실행이 있으면 skip(=GitHub cron이 제때 돌았으면 무동작).
 * 알림: 전부 skip이면 조용히, 하나라도 깨웠거나 실패했으면 Slack.
 * `?dry_run=1` 이면 판정만 한다.
 */
const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOWS = [
  "injibot-daily-report.yml",
  "formula-audit.yml",
  "invalid-creator-fields.yml",
] as const;
/** dispatch 시 기본 브랜치. 워크플로가 default branch에만 있으므로 고정. */
const REF = "main";

/** 오늘(KST) 성공 실행 수. 조회 실패는 -1(호출측이 '실행 쪽으로' 판정). */
async function todaySuccessCount(workflow: string, kdate: string): Promise<number> {
  try {
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/runs?status=success&per_page=20`;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ensure-daily-audits" };
    const token = resolveGitHubActionsToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return -1;
    const json = (await res.json()) as { workflow_runs?: Array<{ updated_at: string; conclusion: string | null }> };
    const runs = (json.workflow_runs ?? []).map((r) => ({ updatedAt: r.updated_at, conclusion: r.conclusion }));
    return countTodaySuccess(runs, kdate);
  } catch {
    return -1;
  }
}

/**
 * workflow_dispatch 1회. 성공 여부만 돌려준다.
 * ⚠️ 조회용 토큰(OPS_GITHUB_TOKEN/GITHUB_TOKEN)은 읽기 전용일 수 있어 **dispatch 전용 토큰을 우선**한다.
 *    권한이 없으면 401/403이 나므로 실패를 삼키지 말고 로그·알림에 남긴다(조용한 실패 금지).
 */
async function dispatchWorkflow(workflow: string): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.GH_DISPATCH_TOKEN?.trim() || resolveGitHubActionsToken();
  if (!token) return { ok: false, detail: "dispatch 토큰 없음(GH_DISPATCH_TOKEN)" };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "ensure-daily-audits",
      },
      body: JSON.stringify({ ref: REF }),
      cache: "no-store",
    });
    if (res.status === 204) return { ok: true, detail: "204" };
    return { ok: false, detail: `${res.status} ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const kdate = todayKST();

  const actions: Array<EnsureAction & { dispatched?: boolean; detail?: string }> = [];
  for (const workflow of WORKFLOWS) {
    const todaySuccess = await todaySuccessCount(workflow, kdate);
    const action = decideEnsure({ workflow, todaySuccess });
    if (action.act && !dryRun) {
      const r = await dispatchWorkflow(workflow);
      if (!r.ok) console.error("[ensure-daily-audits] dispatch 실패", workflow, r.detail);
      actions.push({ ...action, dispatched: r.ok, detail: r.detail });
    } else {
      actions.push(action);
    }
  }

  const text = formatEnsureSummary(actions, kdate, dryRun);
  const tokenExpiryFindings = getGitHubTokenExpiryFindings();
  const tokenExpiryText = formatGitHubTokenExpiryMessage(tokenExpiryFindings);
  const message = tokenExpiryText ? `${text}\n${tokenExpiryText}` : text;
  if (needsNotify(actions) || tokenExpiryFindings.length > 0) await notifyBot(message).catch(() => {});
  const allOk = actions.every((a) => !a.act || dryRun || a.dispatched);
  return NextResponse.json({
    ok: allOk,
    kdate,
    dryRun,
    actions,
    tokenExpiryFindings,
    message,
  }, { status: allOk ? 200 : 500 });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
