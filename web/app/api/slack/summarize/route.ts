import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";

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
// 필요 env: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET(여믄봇), ANTHROPIC_API_KEY
//   선택 env: SUMMARY_MODEL(기본 claude-sonnet-5)
//
// 동작: 3초 내 200 ACK → after()로 스레드(conversations.replies) 수집 →
//   작성자 실명 매핑 → LLM으로 '요청자 기준' 요약 → 스레드에 공개 게시(chat.postMessage thread_ts).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLBACK_IDS = new Set(["summarize_thread", "요약", "summarize"]);
const SLACK = "https://slack.com/api";

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

type SlackUserProfile = { display_name?: string; real_name?: string };
type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
  user?: { name?: string; real_name?: string; profile?: SlackUserProfile };
  [k: string]: unknown;
};

async function slackGet(path: string, token: string): Promise<SlackApiResponse> {
  const r = await fetch(`${SLACK}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as SlackApiResponse;
}

async function slackPost(method: string, token: string, body: unknown): Promise<SlackApiResponse> {
  const r = await fetch(`${SLACK}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return (await r.json()) as SlackApiResponse;
}

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

// 스레드 전체를 페이지네이션으로 수집(cutoff ts 이하 = '그 전까지'만).
async function fetchThread(
  channel: string,
  rootTs: string,
  cutoffTs: string,
  token: string,
): Promise<{ ok: boolean; error?: string; messages: SlackMessage[] }> {
  const out: SlackMessage[] = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ channel, ts: rootTs, limit: "200", inclusive: "true" });
    if (cursor) q.set("cursor", cursor);
    const res = await slackGet(`conversations.replies?${q.toString()}`, token);
    if (!res.ok) return { ok: false, error: String(res.error || "unknown"), messages: [] };
    for (const m of (res.messages || []) as SlackMessage[]) out.push(m);
    cursor = res.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  const cut = Number(cutoffTs);
  const filtered = out.filter((m) => Number(m.ts) <= cut);
  return { ok: true, messages: filtered };
}

// user id → 표시 이름 매핑(users:read). 실패 시 <@id>로 폴백.
async function resolveNames(ids: string[], token: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await slackGet(`users.info?user=${id}`, token);
        const p = res?.user?.profile || {};
        map[id] = p.display_name || p.real_name || res?.user?.real_name || res?.user?.name || `<@${id}>`;
      } catch {
        map[id] = `<@${id}>`;
      }
    }),
  );
  return map;
}

async function summarizeWithLLM(transcript: string, requesterName: string): Promise<string | null> {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) return null;
  const model = (process.env.SUMMARY_MODEL || "claude-sonnet-5").trim();
  const system =
    "너는 슬랙 스레드를 한국어로 요약하는 봇이다. 반드시 실제 대화 내용만 사용하고, 없는 사실·수치·결정을 지어내지 않는다(없으면 생략).\n" +
    "요청자 관점에서 정리한다. 요청자는 성을 뗀 이름 + '님'으로 부른다(예: 황경원 → 경원님).\n" +
    "출력은 Slack mrkdwn. *굵게*, 불릿은 '• '. 존댓말. 군더더기 없이 간결하게.\n" +
    "다음 순서로:\n" +
    "1) 한 줄 개요\n" +
    "2) *핵심 내용* — 논의/공유된 것 불릿\n" +
    "3) *경원님 관련* 형태로, 요청자가 멘션·언급되었거나 요청/질문/할 일을 받은 것 위주 불릿 (없으면 이 섹션 생략)\n" +
    "4) *결정/미결* — 정해진 것과 남은 것 (없으면 생략)";
  const user =
    `요청자: ${requesterName}\n\n` +
    `아래는 슬랙 스레드 대화다(작성자: 내용, 시간순):\n\n${transcript}\n\n` +
    `위 스레드를 요청자(${requesterName}) 기준으로 요약해줘.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("[summarize] Anthropic 오류", data);
      return null;
    }
    const parts = (data.content || []) as Array<{ type?: string; text?: string }>;
    const text = parts.filter((p) => p.type === "text").map((p) => p.text || "").join("").trim();
    return text || null;
  } catch (e) {
    console.error("[summarize] Anthropic 호출 실패", e);
    return null;
  }
}

// 요청자 표시 이름에서 '성 뗀 이름'을 뽑아 헤더에 사용(2자 이름 등은 원본 유지).
function shortName(name: string): string {
  const n = (name || "").trim();
  if (/^[가-힣]{3,4}$/.test(n)) return n.slice(1); // 홍길동 → 길동, 황경원 → 경원
  return n;
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

      const thread = await fetchThread(channel, rootTs, actedTs, token);
      if (!thread.ok) {
        const hint =
          thread.error === "not_in_channel" || thread.error === "channel_not_found"
            ? "여믄봇을 이 채널에 초대(`/invite @여믄봇`)한 뒤 다시 시도해주세요."
            : thread.error === "missing_scope"
              ? "여믄봇에 `channels:history`/`groups:history`/`users:read` 권한이 필요합니다(앱 재설치)."
              : `Slack 오류: ${thread.error}`;
        await ephemeral(responseUrl, `스레드를 읽지 못했습니다. ${hint}`);
        return;
      }

      // 사람이 쓴 실제 메시지만(채널 조인/봇 잡음 등 subtype 제외). 텍스트 없는 것 제외.
      const msgs = thread.messages.filter(
        (m) => (m.text || "").trim() && !m.subtype,
      );
      if (msgs.length === 0) {
        await ephemeral(responseUrl, "요약할 대화 내용이 없습니다.");
        return;
      }

      const userIds = Array.from(new Set(msgs.map((m) => m.user).filter(Boolean) as string[]));
      const idsToResolve = Array.from(new Set([...userIds, requesterId].filter(Boolean)));
      const names = await resolveNames(idsToResolve, token);

      const kstTime = (t?: string) => {
        const d = new Date(Number(t) * 1000 + 9 * 3600 * 1000);
        return d.toISOString().slice(5, 16).replace("T", " ");
      };
      const transcript = msgs
        .map((m) => {
          const who = m.user ? names[m.user] || `<@${m.user}>` : m.username || "봇";
          return `[${kstTime(m.ts)}] ${who}: ${(m.text || "").replace(/\s+/g, " ").trim()}`;
        })
        .join("\n");

      const requesterFull = names[requesterId] || "요청자";
      const summary = await summarizeWithLLM(transcript, requesterFull);
      if (!summary) {
        await ephemeral(
          responseUrl,
          "요약 생성에 실패했습니다. ANTHROPIC_API_KEY 설정 또는 모델 응답을 확인해주세요.",
        );
        return;
      }

      const header = `📝 *스레드 요약* — 요청: ${shortName(requesterFull)}님 (${msgs.length}개 메시지)`;
      const posted = await slackPost("chat.postMessage", token, {
        channel,
        thread_ts: rootTs,
        text: `${header}\n\n${summary}`,
        unfurl_links: false,
        unfurl_media: false,
      });
      if (!posted.ok) {
        const hint =
          posted.error === "not_in_channel"
            ? "여믄봇을 채널에 초대(`/invite @여믄봇`)해주세요."
            : `Slack 오류: ${posted.error}`;
        await ephemeral(responseUrl, `요약은 만들었지만 게시하지 못했습니다. ${hint}`);
      }
    } catch (e) {
      console.error("[summarize] 처리 실패", e);
      await ephemeral(responseUrl, "요약 처리 중 오류가 발생했습니다.");
    }
  });

  return NextResponse.json({ ok: true });
}
