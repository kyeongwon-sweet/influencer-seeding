import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { runSlackThreadSummary, summaryFailureMessage } from "@/lib/slack-thread-summary";

// 여믄봇 "요약" 메시지 단축키(Message shortcut) 처리.
//
// 왜 슬래시 커맨드가 아니라 메시지 단축키인가:
//   Slack 공식 문서상 "개발자가 만든 커스텀 슬래시 커맨드는 스레드 안에서 실행 불가"이며
//   payload에 thread_ts도 오지 않는다. 스레드 맥락을 받을 수 있는 유일한 방법이 '메시지 단축키'다.
//   (메시지 우측 ... 메뉴 → "요약" → 그 메시지가 속한 스레드 전체를 요약)
//
// Slack 앱(여믄봇) 설정:
//   Interactivity & Shortcuts → ON
//     Request URL: https://<도메인>/api/slack/summarize
//     Create New Shortcut → On messages → Name "요약", Callback ID: summarize_thread
//   OAuth scopes(봇): channels:history, groups:history, chat:write, users:read  (추가 후 재설치)
//   여믄봇이 대상 채널의 멤버여야 스레드를 읽고 답글을 달 수 있다.
//
// 필요 env: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET(여믄봇)
// LLM: Vercel 배포의 자동 OIDC → AI Gateway(기본 google/gemini-3.1-flash-lite).
//   선택 env: SUMMARY_MODEL, AI_GATEWAY_API_KEY(로컬), ANTHROPIC_API_KEY(로컬 폴백)
//
// 동작: 3초 내 200 ACK → after()로 스레드(conversations.replies) 수집 →
//   작성자 실명 매핑 → LLM으로 '요청자 기준' 요약 → 스레드에 공개 게시(chat.postMessage thread_ts).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLBACK_IDS = new Set(["summarize_thread", "요약", "summarize"]);

function verifySlack(raw: string, ts: string, sig: string, secret: string): boolean {
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const mine = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
  } catch {
    return false;
  }
}

type SlackMessage = {
  ts?: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  subtype?: string;
};

type MessageActionPayload = {
  type?: string;
  callback_id?: string;
  trigger_id?: string;
  response_url?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: SlackMessage;
};

// 요청자에게만 보이는 에러 안내(response_url = ephemeral).
async function ephemeral(responseUrl: string | undefined, text: string): Promise<void> {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text }),
    });
  } catch (e) {
    console.error("[summarize] ephemeral 실패", e);
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = (process.env.SLACK_SIGNING_SECRET || "").trim();
  const ts = req.headers.get("x-slack-request-timestamp") || "";
  const sig = req.headers.get("x-slack-signature") || "";
  if (!secret || !verifySlack(raw, ts, sig, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payloadStr = new URLSearchParams(raw).get("payload");
  if (!payloadStr) return NextResponse.json({ ok: true });
  let payload: MessageActionPayload;
  try {
    payload = JSON.parse(payloadStr) as MessageActionPayload;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // 메시지 단축키만 처리.
  if (payload.type !== "message_action" || !CALLBACK_IDS.has(payload.callback_id || "")) {
    return NextResponse.json({ ok: true });
  }

  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  const channel = payload.channel?.id || "";
  const actedTs = payload.message?.ts || "";
  const rootTs = payload.message?.thread_ts || actedTs; // 스레드 부모(없으면 그 메시지 자체)
  const requesterId = payload.user?.id || "";
  const responseUrl = payload.response_url;

  // 3초 ACK 제약 → 즉시 200, 실제 작업은 after()에서.
  after(async () => {
    try {
      if (!token) {
        await ephemeral(responseUrl, "요약 실패: 봇 토큰(SLACK_BOT_TOKEN)이 설정되지 않았습니다.");
        return;
      }
      if (!channel || !rootTs) {
        await ephemeral(responseUrl, "요약 실패: 메시지 정보를 읽지 못했습니다.");
        return;
      }

      const result = await runSlackThreadSummary({
        channel,
        rootTs,
        cutoffTs: actedTs,
        includeCutoff: true,
        requesterId,
        token,
      });
      if (!result.ok) await ephemeral(responseUrl, summaryFailureMessage(result));
    } catch (e) {
      console.error("[summarize] 처리 실패", e);
      await ephemeral(responseUrl, "요약 처리 중 오류가 발생했습니다.");
    }
  });

  return NextResponse.json({ ok: true });
}
