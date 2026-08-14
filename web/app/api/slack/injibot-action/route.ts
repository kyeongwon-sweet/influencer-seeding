import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSupabase } from "@/lib/supabase-server";
import { recordFalsePositiveReview, recordReviewDecision } from "@/lib/injibot-review";
import { hideMetaAdCommentForSlackMessage } from "@/lib/meta-instagram-comments";
import { hideTiktokAdCommentForSlackMessage } from "@/lib/tiktok-ads-comments";

// injibot(부정 댓글 알림) 버튼 클릭 처리(Slack Interactivity).
// injibot Slack 앱 → Interactivity & Shortcuts → Request URL:
//   https://influencer-seeding-mu.vercel.app/api/slack/injibot-action
// 필요 env: INJIBOT_SIGNING_SECRET (injibot 앱 Signing Secret)
// 동작: 서명검증 → response_url로 원 메시지를 처리 결과("처리완료/무시 · @사용자")로 교체.
//   외부(인플루언서) 계정은 실제 댓글 숨김/삭제 API가 없어 '상태 기록(메시지 갱신)'만 한다.
//   보유(온드/위성) 계정의 실제 API 숨김은 추후(플랫폼별 토큰 필요).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const ACTION_LABEL: Record<string, string> = {
  hide: "숨김 처리 🚫",
  approve: "승인 ✅",
  hold: "보류 ⏸️",
  unhide: "숨김해제 👁️",
  complete: "처리완료 ✅",
  ignore: "무시(오탐) 🙈",
};

// [완료]·[숨김] = 처리 완료 → 원 메시지(스레드 답글)를 삭제해 스레드엔 '미처리'만 남긴다.
// 그 외(승인/보류/숨김해제/무시)는 기존대로 상태 컨텍스트로 교체.
const DELETE_ON_RESOLVE = new Set(["complete", "hide"]);

type SlackBlock = { type?: string; [key: string]: unknown };

type SlackMessage = {
  ts?: string;
  thread_ts?: string;
  blocks?: SlackBlock[];
};

type SlackActionPayload = {
  type?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
  user?: { id?: string };
  channel?: { id?: string };
  message?: SlackMessage;
  response_url?: string;
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = (process.env.INJIBOT_SIGNING_SECRET || "").trim();
  const ts = req.headers.get("x-slack-request-timestamp") || "";
  const sig = req.headers.get("x-slack-signature") || "";
  if (!secret || !verifySlack(raw, ts, sig, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payloadStr = new URLSearchParams(raw).get("payload");
  if (!payloadStr) return NextResponse.json({ ok: true });
  let payload: SlackActionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackActionPayload;
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (payload.type !== "block_actions") return NextResponse.json({ ok: true });

  const action = (payload.actions || [])[0] || {};
  const actionId: string = action.action_id || "";
  if (!ACTION_LABEL[actionId]) return NextResponse.json({ ok: true });

  const userId: string = payload.user?.id || "";
  const channelId: string = payload.channel?.id || "";
  const messageTs: string = payload.message?.ts || "";
  const when = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

  // 광고(메타·틱톡) 카드는 [숨김] 후에도 스레드에 남긴다(삭제 대신 '숨김 처리됨' 표시로 이력 보존).
  // 그 외(완료/일반 숨김)는 기존대로 답글 삭제. source는 버튼 value에서 읽는다.
  let actionSource = "";
  try { actionSource = String(JSON.parse(action.value || "{}").source || ""); } catch { actionSource = ""; }
  const isAdComment = actionSource === "meta_ads" || actionSource === "tiktok_ads";
  const keepAdCard = isAdComment && actionId === "hide";
  const willDelete = DELETE_ON_RESOLVE.has(actionId) && !keepAdCard;

  // [무시] = 오탐 → 분류기 피드백용으로 기록. 사람 판정은 classifier hash와 무관하게 최우선 적용된다.
  // 식별은 slack_channel_id + slack_ts(댓글 원문 미사용). best-effort — 실패해도 버튼 UX는 계속.
  if (actionId === "ignore") {
    if (channelId && messageTs) {
      try {
        const result = await recordFalsePositiveReview(getServerSupabase(), {
          channelId,
          messageTs,
          userId,
        });
        if (!result.ok) {
          console.error("[injibot-action] 오탐(false_positive) 기록 실패", result.error);
        }
      } catch (e) {
        console.error("[injibot-action] 오탐(false_positive) 기록 실패", e);
      }
    }
  }

  // 원 메시지의 버튼(actions) 블록을 제거하고 처리 결과 컨텍스트를 덧붙인다.
  const origBlocks: SlackBlock[] = payload.message?.blocks || [];

  // 광고 댓글의 [숨김]은 먼저 실제 플랫폼 API가 성공해야 한다(메타=Graph hide, 틱톡=comment/status/update).
  // Slack button value의 comment id는 신뢰하지 않고 DB의 channel+ts 매핑만 사용한다. source로 플랫폼 분기.
  if (actionId === "hide" && channelId && messageTs) {
    try {
      const hidden = actionSource === "tiktok_ads"
        ? await hideTiktokAdCommentForSlackMessage(getServerSupabase(), { channelId, messageTs })
        : await hideMetaAdCommentForSlackMessage(
            getServerSupabase(),
            { channelId, messageTs, graphBase: process.env.META_GRAPH_BASE || "https://graph.facebook.com/v26.0" },
          );
      if (hidden.handled && !hidden.ok) {
        const failureBlocks = [
          ...origBlocks,
          { type: "context", elements: [{ type: "mrkdwn", text: `*숨김 실패 — 다시 시도해주세요* · <@${userId}>` }] },
        ];
        if (payload.response_url) {
          await fetch(payload.response_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ replace_original: true, blocks: failureBlocks }),
          });
        }
        console.error("[injibot-action] 광고 댓글 숨김 실패", hidden.error);
        return NextResponse.json({ ok: true, hidden: false });
      }
    } catch (e) {
      console.error("[injibot-action] 광고 댓글 숨김 실패", e);
      return NextResponse.json({ ok: true, hidden: false });
    }
  }

  // 처리 결과를 DB에 기록(요약이 처리분을 '미처리'로 오표시하지 않게). ignore는 위에서 false_positive로 기록됨.
  if (actionId !== "ignore" && channelId && messageTs) {
    try {
      const result = await recordReviewDecision(getServerSupabase(), {
        channelId,
        messageTs,
        decision: actionId,
        userId,
      });
      if (!result.ok) console.error("[injibot-action] 처리 결과 기록 실패", result.error);
    } catch (e) {
      console.error("[injibot-action] 처리 결과 기록 실패", e);
    }
  }

  const keptBlocks = origBlocks.filter((b) => b.type !== "actions");
  keptBlocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `*${ACTION_LABEL[actionId]}* · <@${userId}> · ${when} KST` }],
  });

  try {
    if (payload.response_url) {
      const body = willDelete
        ? { delete_original: true } // 완료·(비메타)숨김 → 답글 삭제
        : { replace_original: true, blocks: keptBlocks }; // 메타 광고 숨김 → 카드 유지('숨김 처리됨')
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    console.error("[injibot-action] response_url 갱신 실패", e);
  }

  // 스레드에 '미처리 카드'(버튼 남은 답글)가 하나도 없으면 = 담당자가 그 날짜×분류 부정댓글을 전부
  // 처리(완료·무시·숨김)한 것 → 부모에 :완료느낌표: 반응. 완료/숨김(삭제)·무시·메타숨김(버튼 제거) 모두
  // '처리'로 간주(과거엔 삭제 기준이라 무시·메타숨김이 남으면 안 달렸음). reactions:write 없으면 조용히 무시.
  {
    try {
      const parentTs: string = payload.message?.thread_ts || "";
      const currentTs: string = payload.message?.ts || ""; // 방금 처리한 카드(반영 지연 대비 제외)
      const token = (process.env.INJIBOT_SLACK_TOKEN || "").trim();
      if (parentTs && parentTs !== currentTs && channelId && token) {
        const rep = await fetch(
          `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${parentTs}&limit=100`,
          { headers: { authorization: `Bearer ${token}` } },
        ).then((r) => r.json() as Promise<{ messages?: SlackMessage[] }>);
        const msgs: SlackMessage[] = rep.messages || [];
        // 미처리 카드 = actions(버튼) 블록이 남은 답글. 부모·방금 처리분 제외.
        const unhandled = msgs.filter(
          (m) => m.ts !== parentTs && m.ts !== currentTs && Array.isArray(m.blocks) && m.blocks.some((b) => b.type === "actions"),
        );
        if (msgs.length > 0 && unhandled.length === 0) {
          await fetch("https://slack.com/api/reactions.add", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ channel: channelId, timestamp: parentTs, name: "완료느낌표" }),
          });
        }
      }
    } catch (e) {
      console.error("[injibot-action] 완료 이모지 처리 실패", e);
    }
  }

  return NextResponse.json({ ok: true });
}
