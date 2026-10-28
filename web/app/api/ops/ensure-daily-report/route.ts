import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { addDaysToDate, todayKST } from "@/lib/dateRule";
import { resolveGitHubActionsToken } from "@/lib/github-actions-auth";
import { notifyBot } from "@/lib/slack";
import { REPORT_PRODUCTS, isReportForDate } from "@/lib/report-message";

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
 * ⚠️ 제품별(쫀득바·바치케)로 따로 판정·dispatch(product 입력)한다 — 2026-10-28 바치케 미발송 사고:
 *    쫀득바만 보고 product 없이 dispatch 해 바치케 작업은 skip, 바치케는 지연된 GitHub 크론만 기다렸다.
 *    Apps Script 는 응답의 posted(=전 제품 게시됨)만 보므로 바꿀 필요 없다.
 */
const REPO = process.env.GITHUB_REPOSITORY || "kyeongwon-sweet/influencer-seeding";
const WORKFLOW = "daily-increment-report.yml";
const REF = "main";
const REPORT_CHANNEL = process.env.SLACK_CHANNEL || "C0B4F7GBX17"; // #빙과_마케팅_리포트


// KST 어제(리포트 대상일) = 워크플로가 MONITORING_DATE로 쓰는 그 날짜.
function kstYesterday(kToday: string): string {
  return addDaysToDate(kToday, -1);
}

type ProductKey = (typeof REPORT_PRODUCTS)[number]["key"];
type Posted = boolean | null;   // true=게시됨 / false=미게시 / null=확인불가

// 어제 리포트가 채널에 실제 게시됐는지 — 제품별. 채널 기록은 한 번만 읽는다.
async function postedByProduct(reportDate: string): Promise<Record<ProductKey, Posted>> {
  const unknown = Object.fromEntries(REPORT_PRODUCTS.map((p) => [p.key, null])) as Record<ProductKey, Posted>;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return unknown;
  try {
    const res = await fetch(`https://slack.com/api/conversations.history?channel=${REPORT_CHANNEL}&limit=60`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const j = (await res.json()) as { ok?: boolean; messages?: Array<{ text?: string }> };
    if (!j.ok) return unknown;
    const msgs = j.messages ?? [];
    // ⚠️ 본문 전체가 아니라 **제목줄**만 본다 — 정정 주석에 들어간 날짜를 '게시됨'으로
    //    오인해 자가치유가 dispatch 를 건너뛴 사고가 있었다(2026-09-23). 제품명까지 본다(쫀득바↔바치케).
    return Object.fromEntries(REPORT_PRODUCTS.map((p) => [
      p.key, msgs.some((m) => isReportForDate(m.text, reportDate, p.title)),
    ])) as Record<ProductKey, Posted>;
  } catch {
    return unknown;
  }
}

async function dispatchReport(finalRetry: boolean, product: ProductKey): Promise<{ ok: boolean; detail: string }> {
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
      body: JSON.stringify({
        ref: REF,
        inputs: { final_retry: finalRetry ? "true" : "false", product },
      }), // date는 비움 → 어제(KST). final_retry는 최종 보류 DM 라우팅, product는 해당 제품 작업만 돌린다.
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
  const probe = req.nextUrl.searchParams.get("probe") === "1";
  const finalRetry = req.nextUrl.searchParams.get("final_retry") === "1";
  const syncOk = req.nextUrl.searchParams.get("sync_ok") !== "0";
  const kdate = todayKST();
  const reportDate = kstYesterday(kdate);
  const byProduct = await postedByProduct(reportDate);
  // posted = 전 제품 게시됨일 때만 true(Apps Script 는 이 값 하나로 syncAll·dispatch 여부를 정한다).
  const vals = Object.values(byProduct);
  const posted: Posted = vals.every((v) => v === true) ? true : vals.some((v) => v === false) ? false : null;

  // Apps Script가 syncAll 필요 여부만 확인하는 1차 조회. 알림·dispatch·상태 변경이 없다.
  if (probe) {
    return NextResponse.json({ ok: true, kdate, reportDate, posted, byProduct, acted: false, probe: true });
  }

  if (posted === true) {
    return NextResponse.json({ ok: true, kdate, reportDate, posted: true, byProduct, acted: false }); // 이미 게시됨 → 무동작
  }

  // 제품별로 미게시(false) 또는 확인불가(null)만 dispatch(리포트 자체 DEDUP이 중복 최종 차단).
  const syncText = syncOk ? "syncAll 완료" : "syncAll 실패(기존 DB로 재검수)";
  const retryText = finalRetry ? " · 최종 재시도" : "";
  const results: Array<{ product: ProductKey; posted: Posted; dispatched: boolean; detail: string }> = [];
  for (const p of REPORT_PRODUCTS) {
    const pp = byProduct[p.key];
    if (pp === true) continue;
    let dispatched = false;
    let detail = "dry_run";
    if (!dryRun) {
      const r = await dispatchReport(finalRetry, p.key);
      dispatched = r.ok;
      detail = r.detail;
      if (!r.ok) console.error("[ensure-daily-report] dispatch 실패", p.key, detail);
    }
    results.push({ product: p.key, posted: pp, dispatched, detail });
    const why = pp === false ? "미게시 확인" : "게시 여부 확인 불가";
    const name = p.title.replace(" 조회수 일일 증분", "");
    const msg = `⚠️ *리포트 발송 보장* \`(${reportDate})\`\n어제 ${name} 증분 리포트 ${why} → ${syncText}${retryText} → **자동 발송 dispatch**${dryRun ? "(dry_run)" : dispatched ? " 완료(데이터 있으면 곧 게시, DEDUP로 중복 없음)." : ` 실패: ${detail}`}.`;
    await notifyBot(msg).catch(() => {});
  }
  const ok = dryRun || results.every((r) => r.dispatched);
  return NextResponse.json({ ok, kdate, reportDate, posted, byProduct, acted: true, results, finalRetry, syncOk }, { status: ok ? 200 : 500 });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
