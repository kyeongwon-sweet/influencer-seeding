import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { todayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { notifyBot } from "@/lib/slack";
import { countTodaySuccess, decideAuditFallback, formatAuditFallback } from "@/lib/audit-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 아침 수식감사 폴백 — GitHub 스케줄러가 밀리거나 죽어도 오늘치 전수감사를 보장한다.
 *
 * 2026-08-03 실측: `formula-audit.yml`(10:10 KST 예정)이 최근 사흘 내내 13:2x~13:3x에야 발화했고,
 * 이 날은 10:17까지 미발화라 사람이 손으로 dispatch해야 했다. 기존 감시는 '최근 성공 26시간 이내'라는
 * 나이 기준이라 **어제 늦게 성공하면 오늘 아침 미실행을 못 잡는다**(구조적 사각).
 *
 * 구글(Apps Script) 시간 트리거가 11:00 KST에 이 라우트를 호출한다 = GitHub과 독립 경로.
 *  - 오늘 이미 감사 성공 기록이 있으면 무동작(중복 Slack 없음).
 *  - 없으면 `/api/sponsored-posts/formula-audit`를 직접 호출한다(읽기 전용·비용 0).
 *  - GitHub 조회가 실패하면 **실행 쪽으로** 기운다(감사는 부작용이 없고, 미실행 피해가 더 크다).
 *  - `?dry_run=1`이면 판정만 한다.
 */

const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOW = "formula-audit.yml";

async function fetchTodaySuccessCount(todayKstDate: string): Promise<number> {
  try {
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?status=success&per_page=20`;
    // repo가 비공개면 비인증 조회는 404 → 매일 '조회 실패'로 판정해 폴백 감사를 중복 실행한다.
    // schedule-heartbeat와 같은 규약: OPS_GITHUB_TOKEN 우선, 기존 GITHUB_TOKEN 호환.
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "audit-fallback" };
    const token = resolveGitHubActionsToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return -1;
    const json = (await res.json()) as { workflow_runs?: Array<{ updated_at: string; conclusion: string | null }> };
    const runs = (json.workflow_runs ?? []).map((r) => ({ updatedAt: r.updated_at, conclusion: r.conclusion }));
    return countTodaySuccess(runs, todayKstDate);
  } catch {
    return -1;
  }
}

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const kdate = todayKST();

  const todayRuns = await fetchTodaySuccessCount(kdate);
  const decision = decideAuditFallback(todayRuns);
  let ran: boolean | undefined;

  if (decision.act && !dryRun) {
    try {
      const base = process.env.APP_URL || `https://${req.headers.get("host")}`;
      const res = await fetch(`${base}/api/sponsored-posts/formula-audit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
        cache: "no-store",
      });
      ran = res.ok;
      if (!res.ok) console.error("[audit-fallback] formula-audit", res.status, (await res.text()).slice(0, 300));
    } catch (e) {
      ran = false;
      console.error("[audit-fallback] formula-audit 예외", e);
    }
  }

  const text = formatAuditFallback(decision, kdate, dryRun, ran);
  // 정상(이미 감사됨)일 때는 조용히 — 폴백이 필요했거나 실패했을 때만 알린다.
  if (decision.reason !== "already_done") await notifyBot(text).catch(() => {});

  return NextResponse.json({ ok: true, kdate, dryRun, ...decision, ran, message: text });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
