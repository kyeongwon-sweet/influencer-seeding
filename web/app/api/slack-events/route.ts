import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSupabase } from "@/lib/supabase-server";

// 여믄봇 이벤트 수신: 누가 DM을 보내든 사진 1장을 랜덤 응답
// 사진은 Supabase Storage 'yeomun' 버킷에서 실시간 조회 → 버킷에 넣기만 하면 즉시 포함됨
// Slack Event Subscriptions Request URL: https://<도메인>/api/slack-events
// 필요 env: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "yeomun";

function verifySlack(raw: string, ts: string, sig: string, secret: string): boolean {
  if (!ts || !sig) return false;
  // 5분 이상 지난 요청은 거부(재전송 공격 방지)
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const base = `v0:${ts}:${raw}`;
  const mine = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const ts = req.headers.get("x-slack-request-timestamp") || "";
  const sig = req.headers.get("x-slack-signature") || "";

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // 1) URL 검증(최초 등록 시) — 서명 검증 전에 challenge 반환
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // 2) 서명 검증
  if (!signingSecret || !verifySlack(raw, ts, sig, signingSecret)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  // 3) Slack 재전송(중복) 무시 → 사진 두 번 안 감
  if (req.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true });
  }

  if (body.type === "event_callback") {
    const e = body.event || {};
    // DM 메시지이고, 봇/시스템 메시지가 아닐 때만 응답 (봇 자기 응답으로 인한 루프 방지)
    const isUserDM =
      e.type === "message" &&
      e.channel_type === "im" &&
      !e.bot_id &&
      !e.subtype &&
      !!e.user;

    if (isUserDM) {
      // Supabase Storage 'yeomun' 버킷에서 사진 목록 실시간 조회 → 랜덤 1장
      const sb = getServerSupabase();
      const { data: files } = await sb.storage.from(BUCKET).list("", { limit: 100 });
      const imgs = (files || []).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name));
      if (imgs.length === 0) return NextResponse.json({ ok: true });
      const pick = imgs[Math.floor(Math.random() * imgs.length)].name;
      const imageUrl = sb.storage.from(BUCKET).getPublicUrl(pick).data.publicUrl;
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: e.channel,
          text: "🎁",
          blocks: [{ type: "image", image_url: imageUrl, alt_text: "여믄봇" }],
        }),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
