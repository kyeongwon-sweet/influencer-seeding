import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { todayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { notifyBot } from "@/lib/slack";
import { countTodaySuccess } from "@/lib/audit-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 리포트 결과 워치독 — GitHub cron이 '일일 증분 리포트' 발송을 누락하면 직접 dispatch한다.
 *
 * 배경(실측 2026-08-27): GitHub이 12:20/13:20/14:20/15:20 KST 백업 크론 4개를 **전부 드롭**해
 * 리포트가 통째로 미발송됐다(워크플로는 active, 코드/검수 정상). 백업 크론을 여러 개 둬도
 * GitHub이 전부 누락하면 소용없어, **GitHub 크론에 의존하지 않는 감시**가 필요하다.
 * → 시각은 구글 Apps Script(≈16:10 KST, 마지막 백업 크론 이후)가 보장, 실행 확인·재발동은 이 라우트가 담당.
 *
 * 판정: 오늘(KST) 리포트 워크플로 **성공 실행이 1건이라도 있으면** 이미 나간 것 → 무동작(조용).
 *       0건이면 크론 누락으로 보고 워크플로 dispatch(입력 없음 → date=어제=오늘 리포트, 실발송) + Slack 알림.
 *       조회 실패(-1)는 '발송됨/안됨' 미확정이라 dispatch하지 않고 경고만(중복 발송 방지).
 */
const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOW = "daily-increment-report.yml";
const REF = "main";

async function todaySuccessCount(kdate: string): Promise<number> {
  try {
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=30`;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ensure-daily-report" };
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

async function dispatchReport(): Promise<{ ok: boolean; detail: string }> {
  // ⚠️ 조회용 토큰은 읽기 전용일 수 있어 dispatch 전용 토큰을 우선(ensure-daily-audits와 동일).
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
        "User-Agent": "ensure-daily-report",
      },
      body: JSON.stringify({ ref: REF }), // 입력 없음 → date=어제(KST)=오늘 리포트, dry_run/update_ts 없음(실발송)
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
  const success = await todaySuccessCount(kdate);

  if (success === -1) {
    const msg = `⚠️ 리포트 워치독: GitHub 실행 이력 조회 실패 \`(${kdate})\` — 발송 여부 미확인, 채널 수동 확인 필요.`;
    if (!dryRun) await notifyBot(msg).catch(() => {});
    return NextResponse.json({ ok: false, kdate, success, acted: false, note: "lookup_failed" }, { status: 200 });
  }
  if (success >= 1) {
    return NextResponse.json({ ok: true, kdate, success, acted: false }); // 이미 발송됨 → 조용히 통과
  }

  let dispatched = false;
  let detail = "dry_run";
  if (!dryRun) {
    const r = await dispatchReport();
    dispatched = r.ok;
    detail = r.detail;
    if (!r.ok) console.error("[ensure-daily-report] dispatch 실패", detail);
  }
  const msg = `⚠️ *리포트 크론 누락 감지* \`(${kdate})\`\n오늘 일일 증분 리포트 예약 실행이 확인되지 않아 **자동 발송 dispatch**${dryRun ? "(dry_run)" : dispatched ? " 완료 — 곧 채널에 게시됩니다." : ` 실패: ${detail}`}.`;
  await notifyBot(msg).catch(() => {});
  const ok = dryRun || dispatched;
  return NextResponse.json({ ok, kdate, success, acted: true, dispatched, detail }, { status: ok ? 200 : 500 });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
