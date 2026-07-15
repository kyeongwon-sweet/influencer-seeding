import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSupabase } from "@/lib/supabase-server";

// 여믄봇 부정 댓글 알림의 [처리완료]/[무시] 버튼 클릭 처리(Slack Interactivity).
// Slack 앱 설정 → Interactivity & Shortcuts → Request URL:
//   https://influencer-seeding-mu.vercel.app/api/slack/comment-action
// 필요 env: SLACK_SIGNING_SECRET(여믄봇), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 동작: post_comments.handled_* 갱신 후 response_url로 원 메시지를 처리 결과로 교체.
//   ⚠️ 외부(인플루언서) 계정은 API로 댓글을 숨길 수 없어 '상태 기록'만 한다(숨김은 보유 계정만, 추후).

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
  comment_done: "✅ 처리완료",
  comment_ignore: "🙈 무시(오탐)",
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.SLACK_SIGNING_SECRET || "";
  const ts = req.headers.get("x-slack-request-timestamp") || "";
  const sig = req.headers.get("x-slack-signature") || "";
  if (!secret || !verifySlack(raw, ts, sig, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Interactivity 페이로드: application/x-www-form-urlencoded 의 payload= 필드(JSON)
  const payloadStr = new URLSearchParams(raw).get("payload");
  if (!payloadStr) return NextResponse.json({ ok: true });
  let payload: any;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (payload.type !== "block_actions") return NextResponse.json({ ok: true });

  const action = (payload.actions || [])[0] || {};
  const actionId: string = action.action_id || "";
  if (!ACTION_LABEL[actionId]) return NextResponse.json({ ok: true });

  const [postId, commentId] = String(action.value || "").split("|");
  const userName: string =
    payload.user?.username || payload.user?.name || payload.user?.id || "unknown";
  const nowIso = new Date().toISOString();
  const decision = actionId === "comment_done" ? "done" : "ignored";

  if (postId && commentId) {
    try {
      await getServerSupabase()
        .from("post_comments")
        .update({ handled_at: nowIso, handled_by: userName, handled_action: decision })
        .eq("post_id", postId)
        .eq("comment_id", commentId);
    } catch (e) {
      console.error("[comment-action] DB update 실패", e);
    }
  }

  // 원 메시지 교체: 기존 본문(첫 section) 유지 + 처리 결과 컨텍스트. 버튼 제거.
  const origBlocks: any[] = payload.message?.blocks || [];
  const bodyBlock = origBlocks.find((b) => b.type === "section") || {
    type: "section",
    text: { type: "mrkdwn", text: payload.message?.text || "부정 댓글" },
  };
  const when = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const replaced = {
    replace_original: true,
    blocks: [
      bodyBlock,
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `${ACTION_LABEL[actionId]} · <@${payload.user?.id}> · ${when} KST` },
        ],
      },
    ],
  };
  try {
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replaced),
      });
    }
  } catch (e) {
    console.error("[comment-action] response_url 갱신 실패", e);
  }

  return NextResponse.json({ ok: true });
}
