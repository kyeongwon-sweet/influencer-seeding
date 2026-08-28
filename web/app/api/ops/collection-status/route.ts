import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { yesterdayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import {
  collectionCompletedFromJobs,
  collectionRunKstDate,
  COLLECTION_MARKER_REQUIRED_AFTER,
  isCandidateCollectionRun,
  type CollectionWorkflowRun,
  type GitHubJob,
} from "@/lib/collection-completion";
import { notifyBot } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOW = "cron-daily-collect.yml";

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "linked-sheet-collection-gate",
  };
  const token = resolveGitHubActionsToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readCollectionStatus(targetDate: string) {
  const headers = githubHeaders();
  const runsUrl = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`;
  const runsRes = await fetch(runsUrl, { headers, cache: "no-store" });
  if (!runsRes.ok) throw new Error(`GitHub runs ${runsRes.status}`);
  const runsJson = (await runsRes.json()) as { workflow_runs?: CollectionWorkflowRun[] };
  const candidates = (runsJson.workflow_runs ?? []).filter((run) => isCandidateCollectionRun(run, targetDate));

  const checked = [];
  for (const run of candidates) {
    const jobsUrl = `https://api.github.com/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`;
    const jobsRes = await fetch(jobsUrl, { headers, cache: "no-store" });
    if (!jobsRes.ok) throw new Error(`GitHub jobs ${jobsRes.status} (run ${run.id})`);
    const jobsJson = (await jobsRes.json()) as { jobs?: GitHubJob[] };
    const markerRequired = Date.parse(run.created_at) >= Date.parse(COLLECTION_MARKER_REQUIRED_AFTER);
    const decision = collectionCompletedFromJobs(
      jobsJson.jobs ?? [], run.event, markerRequired, run.conclusion,
    );
    checked.push({
      id: run.id,
      event: run.event,
      created_at: run.created_at,
      html_url: run.html_url ?? null,
      ...decision,
    });
    if (decision.completed) {
      return { completed: true, run: checked[checked.length - 1], checked };
    }
  }
  return { completed: false, run: null, checked };
}

async function handler(req: NextRequest, notify: boolean) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const targetDate = req.nextUrl.searchParams.get("target_date") || yesterdayKST();
  if (!collectionRunKstDate(targetDate)) {
    return NextResponse.json({ error: "invalid target_date" }, { status: 400 });
  }

  try {
    const status = await readCollectionStatus(targetDate);
    if (notify) {
      const reason = req.nextUrl.searchParams.get("reason") || "gate_timeout";
      if (!status.completed || reason === "export_failed") {
        const detail = reason === "export_failed"
          ? "수집 완료 뒤에도 exportStats가 반복 실패했습니다."
          : "수집 완료 마커를 확인하지 못해 exportStats를 실행하지 않았습니다.";
        await notifyBot(
          `🔴 [시트 역채움 보류] ${targetDate} ${detail} DB 수집 실행과 Apps Script 재시도 상태를 확인해 주세요.`,
        );
      }
    }
    return NextResponse.json({ ok: true, targetDate, ...status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (notify) {
      await notifyBot(
        `🔴 [시트 역채움 보류] ${targetDate} 수집 상태 조회 실패로 exportStats를 실행하지 않았습니다: ${detail.slice(0, 240)}`,
      ).catch(() => {});
    }
    return NextResponse.json({ ok: false, targetDate, completed: null, error: detail }, { status: 502 });
  }
}

export async function GET(req: NextRequest) { return handler(req, false); }
export async function POST(req: NextRequest) { return handler(req, true); }
