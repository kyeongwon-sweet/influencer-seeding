import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { todayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { notifyBot } from "@/lib/slack";
import { decideEnsureCollect, type CollectRun } from "@/lib/collect-primary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 자정 수집 시작 — 구글 Apps Script 시간 트리거(00:05~00:35 KST, 백업 01:15~01:45)가 부른다.
 *
 * 배경(2026-10-27): GitHub 예약 00:41 KST가 최근 31일 중앙값 +4시간, 최대 +6.9시간 늦게 떴고
 * 1시간 안에 뜬 날이 0일이었다. 시각은 구글이 보장하고, 실행은 GitHub(workflow_dispatch)이 한다
 * (ensure-daily-audits·ensure-daily-report 와 같은 구조).
 *
 * 동작: 오늘 밤 주 수집이 없으면 cron-daily-collect.yml 을 final_snapshot=true 로 dispatch.
 *       이미 돌고 있거나 끝났으면 무동작. 판정 규칙은 lib/collect-primary.ts(= scripts/collect_role.py).
 * 알림: 정상 dispatch·무동작은 조용히. dispatch 실패·실행 목록 조회 실패만 Slack.
 * `?dry_run=1` 이면 판정만 한다.
 */
const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOW = "cron-daily-collect.yml";
const REF = "main";

function kstHourNow(): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  return Number(h);
}

async function listTodayRuns(kdate: string): Promise<CollectRun[] | null> {
  try {
    const since = new Date(Date.parse(`${kdate}T00:00:00+09:00`)).toISOString().replace(/\.\d{3}Z$/, "Z");
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=50&created=${encodeURIComponent(">=" + since)}`;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ensure-daily-collect" };
    const token = resolveGitHubActionsToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { workflow_runs?: CollectRun[] };
    return json.workflow_runs ?? [];
  } catch {
    return null;
  }
}

async function dispatchPrimary(): Promise<{ ok: boolean; detail: string }> {
  // 조회용 토큰은 읽기 전용일 수 있어 dispatch 전용 토큰을 우선(ensure-daily-audits와 동일).
  const token = process.env.GH_DISPATCH_TOKEN?.trim() || resolveGitHubActionsToken();
  if (!token) return { ok: false, detail: "dispatch 토큰 없음(GH_DISPATCH_TOKEN)" };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "ensure-daily-collect",
      },
      body: JSON.stringify({ ref: REF, inputs: { final_snapshot: "true" } }),
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
  const kstHour = kstHourNow();
  const runs = await listTodayRuns(kdate);
  const decision = decideEnsureCollect(runs, kdate, kstHour);

  if (decision.action === "skip") {
    if (decision.reason === "runs_unreadable" && !dryRun) {
      await notifyBot(`⚠️ *자정 수집 시작* \`${kdate}\` — GitHub 실행 목록을 못 읽어 시작을 보류했습니다(중복 수집 방지). 00:41 GitHub 예약이 대신 수집합니다(늦을 수 있음).`).catch(() => {});
    }
    return NextResponse.json({ ok: true, kdate, kstHour, dryRun, ...decision, dispatched: false });
  }

  if (dryRun) return NextResponse.json({ ok: true, kdate, kstHour, dryRun, ...decision, dispatched: false });

  const r = await dispatchPrimary();
  if (!r.ok) {
    console.error("[ensure-daily-collect] dispatch 실패", r.detail);
    await notifyBot(`🚨 *자정 수집 시작 실패* \`${kdate}\` — dispatch 실패: ${r.detail}. 00:41 GitHub 예약이 대신 수집합니다(늦을 수 있음).`).catch(() => {});
  }
  return NextResponse.json({ ok: r.ok, kdate, kstHour, dryRun, ...decision, dispatched: r.ok, detail: r.detail }, { status: r.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
