import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

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

  const userId: string = payload.user?.id || "";
  const when = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

  // 원 메시지의 버튼(actions) 블록을 제거하고 처리 결과 컨텍스트를 덧붙인다.
  const origBlocks: any[] = payload.message?.blocks || [];
  const keptBlocks = origBlocks.filter((b) => b.type !== "actions");
  keptBlocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `*${ACTION_LABEL[actionId]}* · <@${userId}> · ${when} KST` }],
  });

  try {
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: true, blocks: keptBlocks }),
      });
    }
  } catch (e) {
    console.error("[injibot-action] response_url 갱신 실패", e);
  }

  return NextResponse.json({ ok: true });
}
