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

type SlackEventPayload = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    channel_type?: string;
    bot_id?: string;
    subtype?: string;
    user?: string;
    channel?: string;
  };
};

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

  let body: SlackEventPayload;
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
      const token = process.env.SLACK_BOT_TOKEN || "";

      // 사진을 Slack에 '실물 업로드'(files.uploadV2 3단계)로 보낸다.
      // 예전엔 image 블록의 image_url(외부 링크)로 보냈으나, Slack이 그 URL을 서버에서
      // 직접 가져오다 실패하면 파일이 멀쩡해도 깨진 이미지로 영구히 남는 문제가 있었다(2026-07-08).
      // 실물 업로드는 Slack이 외부 URL을 가져올 필요가 없어 안정적으로 렌더된다.
      // 업로드 실패(예: files:write 스코프 없음) 시엔 최소한 응답은 가도록 기존 링크 방식으로 폴백.
      let uploaded = false;
      try {
        const { data: blob } = await sb.storage.from(BUCKET).download(pick);
        if (blob) {
          const bytes = Buffer.from(await blob.arrayBuffer());
          // 1) 업로드 URL 발급
          const g = await fetch("https://slack.com/api/files.getUploadURLExternal", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ filename: pick, length: String(bytes.length) }),
          }).then((r) => r.json());
          if (g.ok && g.upload_url && g.file_id) {
            // 2) 실제 파일 바이트 업로드
            const form = new FormData();
            form.append("file", new Blob([bytes]), pick);
            await fetch(g.upload_url, { method: "POST", body: form });
            // 3) 업로드 완료 + DM 채널 공유
            const c = await fetch("https://slack.com/api/files.completeUploadExternal", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ files: [{ id: g.file_id, title: "여믄봇" }], channel_id: e.channel }),
            }).then((r) => r.json());
            uploaded = !!c.ok;
          }
        }
      } catch {
        // 무시하고 아래 폴백으로
      }

      if (!uploaded) {
        const imageUrl = sb.storage.from(BUCKET).getPublicUrl(pick).data.publicUrl;
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            channel: e.channel,
            text: "🎁",
            blocks: [{ type: "image", image_url: imageUrl, alt_text: "여믄봇" }],
          }),
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
