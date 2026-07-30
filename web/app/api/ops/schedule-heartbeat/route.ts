import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { notifyBot } from "@/lib/slack";
import { WATCH_TARGETS, evaluateSchedules, formatHeartbeat } from "@/lib/schedule-heartbeat";

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

async function lastScheduleSuccess(repo: string, workflow: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?status=success&event=schedule&per_page=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "schedule-heartbeat",
  };
  if (process.env.OPS_GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.OPS_GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub ${res.status} (${workflow})`);
  const json = (await res.json()) as { workflow_runs?: Array<{ updated_at: string }> };
  const runs = json.workflow_runs ?? [];
  return runs.length > 0 ? runs[0].updated_at : null;
}

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const last: Record<string, string | null> = {};
  const errors: string[] = [];
  for (const t of WATCH_TARGETS) {
    try {
      last[t.workflow] = await lastScheduleSuccess(REPO, t.workflow);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      // 조회 실패는 '이상 없음'으로 삼키지 않는다 — 알림에 그대로 노출.
      last[t.workflow] = null;
    }
  }

  const findings = evaluateSchedules(last, new Date());
  const { text, healthy } = formatHeartbeat(findings, REPO);
  const message = errors.length > 0 ? `${text}\n⚠️ GitHub 조회 오류 ${errors.length}건: ${errors.slice(0, 3).join(" / ")}` : text;

  // 정상일 때 매번 알리면 소음이라, 이상(또는 조회 실패)일 때만 발송한다.
  if (!healthy || errors.length > 0) await notifyBot(message).catch(() => {});

  return NextResponse.json({
    ok: true,
    healthy: healthy && errors.length === 0,
    repo: REPO,
    findings,
    lastScheduleSuccess: last,
    errors,
  });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
