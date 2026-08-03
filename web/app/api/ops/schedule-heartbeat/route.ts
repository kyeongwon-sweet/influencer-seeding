import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { excludeFailedGitHubLookups, resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { notifyBot } from "@/lib/slack";
import {
  WATCH_TARGETS,
  evaluateSchedules,
  formatHeartbeat,
  type HeartbeatRun,
} from "@/lib/schedule-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 크로스 프로바이더 스케줄 하트비트 — GitHub 크론이 죽었는지 **GitHub 밖에서** 확인한다.
 *
 * 2026-07-30 사고: GitHub Actions 스케줄이 두 repo 모두 전면 정지했고, 감시자(cron-watchdog)도
 * 같은 스케줄러에 실려 있어 경보가 못 떴다. 이 라우트는 Google Apps Script 시간 트리거(또는 외부
 * 핑)가 호출하도록 만들어, 스케줄러 장애를 다른 제공자 경로로 감지·Slack 통보한다.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>.
 * GitHub 조회: PUBLIC repo라 토큰 없이 읽는다(비인증 60req/h로 충분. 비공개 전환 시 GH_TOKEN 필요).
 * 부수효과: Slack 알림뿐. DB/시트 쓰기 없음.
 */

const REPO = process.env.OPS_GITHUB_REPO || "kyeongwon-sweet/influencer-seeding";

type GitHubRun = {
  updated_at: string;
  conclusion: string | null;
  event: string;
  html_url: string;
};

async function latestRun(repo: string, workflow: string, query: string): Promise<HeartbeatRun | null> {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?${query}&per_page=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "schedule-heartbeat",
  };
  const token = resolveGitHubActionsToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub ${res.status} (${workflow})`);
  const json = (await res.json()) as { workflow_runs?: GitHubRun[] };
  const runs = json.workflow_runs ?? [];
  if (runs.length === 0) return null;
  const run = runs[0];
  return {
    updatedAt: run.updated_at,
    conclusion: run.conclusion,
    event: run.event,
    url: run.html_url,
  };
}

async function lastScheduleSuccess(repo: string, workflow: string): Promise<string | null> {
  return (await latestRun(repo, workflow, "status=success&event=schedule"))?.updatedAt ?? null;
}

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const last: Record<string, string | null> = {};
  const errors: string[] = [];
  const lookupFailed = new Set<string>();
  for (const t of WATCH_TARGETS) {
    try {
      last[t.workflow] = await lastScheduleSuccess(REPO, t.workflow);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      // 조회 실패는 '스케줄 기록 없음'이 아니다. 해당 workflow의 판정을 보류한다.
      lookupFailed.add(t.workflow);
    }
  }

  const findings = evaluateSchedules(
    last,
    new Date(),
    excludeFailedGitHubLookups(WATCH_TARGETS, lookupFailed),
  );
  const latestSchedule: Record<string, HeartbeatRun | null> = {};
  const latestSuccess: Record<string, HeartbeatRun | null> = {};
  await Promise.all(findings.flatMap((finding) => [
    latestRun(REPO, finding.workflow, "event=schedule")
      .then((run) => { latestSchedule[finding.workflow] = run; })
      .catch((e) => {
        errors.push(e instanceof Error ? e.message : String(e));
        latestSchedule[finding.workflow] = null;
      }),
    latestRun(REPO, finding.workflow, "status=success")
      .then((run) => { latestSuccess[finding.workflow] = run; })
      .catch((e) => {
        errors.push(e instanceof Error ? e.message : String(e));
        latestSuccess[finding.workflow] = null;
      }),
  ]));

  const { text, healthy } = formatHeartbeat(findings, REPO, latestSchedule, latestSuccess);
  const uniqueErrors = [...new Set(errors)];
  const lookupMessage = uniqueErrors.length > 0
    ? `⚠️ [스케줄 하트비트] ${REPO} — GitHub 조회 실패 ${uniqueErrors.length}건, 해당 스케줄 상태 판정 보류\n${uniqueErrors.slice(0, 3).join(" / ")}`
    : "";
  const message = lookupMessage
    ? (findings.length > 0 ? `${text}\n${lookupMessage}` : lookupMessage)
    : text;

  // 정상일 때 매번 알리면 소음이라, 이상(또는 조회 실패)일 때만 발송한다.
  if (!healthy || uniqueErrors.length > 0) await notifyBot(message).catch(() => {});

  return NextResponse.json({
    ok: true,
    healthy: healthy && uniqueErrors.length === 0,
    repo: REPO,
    findings,
    lastScheduleSuccess: last,
    latestSchedule,
    latestSuccess,
    errors: uniqueErrors,
  });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
