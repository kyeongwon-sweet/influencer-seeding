import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { todayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { notifyBot } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 리포트 결과 워치독 — GitHub cron이 '일일 증분 리포트' 발송을 누락/지연하면 직접 dispatch한다.
 *
 * 배경(실측 2026-08-27~28): GitHub 예약이 워크플로별로 랜덤 지연(3h+)·간헐 미발화. 4중 백업 크론도
 * 같은 구간에 다 밀릴 수 있어, **GitHub 크론에 의존하지 않는** Apps Script(12:35·16:10 KST) 트리거가 이 라우트를 부른다.
 *
 * ⚠️ 판정 신호 = "GitHub 실행 성공 수"가 아니라 **"어제 리포트가 실제로 채널에 게시됐나"**(2026-08-28 수정).
 *   이유: 데이터 지연/DEDUP/strict로 **스킵한 실행도 exit 0(성공)** 이라, 성공 수로 세면 '안 나갔는데 나갔다'고
 *   오판해 자가치유가 무동작한다(08-28 실측 사고 — 8/27 데이터 늦게 들어와 새벽 실행이 스킵→성공, 자가치유 속음).
 * 동작: 어제 리포트 미게시 → dispatch(입력 없음 → date=어제, 실발송; 리포트 자체 DEDUP이 중복 최종 차단) + Slack 알림.
 *       게시됨 → 무동작. 게시 여부 확인 불가 → 안전하게 dispatch(DEDUP이 중복 방지).
 */
const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOW = "daily-increment-report.yml";
const REF = "main";
const REPORT_CHANNEL = process.env.SLACK_CHANNEL || "C0B4F7GBX17"; // #빙과_마케팅_리포트
const REPORT_TITLE = "쫀득바 조회수 일일 증분";

// KST 어제(리포트 대상일) = 워크플로가 MONITORING_DATE로 쓰는 그 날짜.
function kstYesterday(kToday: string): string {
  const d = new Date(kToday + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 어제 리포트가 채널에 실제 게시됐는지. true=게시됨 / false=미게시 / null=확인불가.
async function isReportPosted(reportDate: string): Promise<boolean | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://slack.com/api/conversations.history?channel=${REPORT_CHANNEL}&limit=40`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const j = (await res.json()) as { ok?: boolean; messages?: Array<{ text?: string }> };
    if (!j.ok) return null;
    const needle = `(${reportDate})`;
    return (j.messages ?? []).some((m) => typeof m.text === "string" && m.text.includes(REPORT_TITLE) && m.text.includes(needle));
  } catch {
    return null;
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
  const reportDate = kstYesterday(kdate);
  const posted = await isReportPosted(reportDate); // true/false/null(확인불가)

  if (posted === true) {
    return NextResponse.json({ ok: true, kdate, reportDate, posted: true, acted: false }); // 이미 게시됨 → 무동작
  }

  // 미게시(false) 또는 확인불가(null) → 안전하게 dispatch(리포트 자체 DEDUP이 중복 최종 차단).
  let dispatched = false;
  let detail = "dry_run";
  if (!dryRun) {
    const r = await dispatchReport();
    dispatched = r.ok;
    detail = r.detail;
    if (!r.ok) console.error("[ensure-daily-report] dispatch 실패", detail);
  }
  const why = posted === false ? "미게시 확인" : "게시 여부 확인 불가";
  const msg = `⚠️ *리포트 발송 보장* \`(${reportDate})\`\n어제 증분 리포트 ${why} → **자동 발송 dispatch**${dryRun ? "(dry_run)" : dispatched ? " 완료(데이터 있으면 곧 게시, DEDUP로 중복 없음)." : ` 실패: ${detail}`}.`;
  await notifyBot(msg).catch(() => {});
  const ok = dryRun || dispatched;
  return NextResponse.json({ ok, kdate, reportDate, posted, acted: true, dispatched, detail }, { status: ok ? 200 : 500 });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
