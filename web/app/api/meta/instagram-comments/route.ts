import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  extractMetaAdCommentEvents,
  storeMetaAdCommentEvents,
  summarizeMetaWebhookPayload,
  verifyMetaWebhookSignature,
} from "@/lib/meta-instagram-comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode") || "";
  const token = req.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = req.nextUrl.searchParams.get("hub.challenge") || "";
  const expected = (process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim();
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") || "";
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  if (!verifyMetaWebhookSignature(raw, signature, appSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const events = extractMetaAdCommentEvents(payload);
  console.info("[meta-instagram-comments] delivery", {
    ...summarizeMetaWebhookPayload(payload),
    extractedEvents: events.length,
  });
  const result = await storeMetaAdCommentEvents(getServerSupabase(), events);
  if (!result.ok) {
    console.error("[meta-instagram-comments] queue insert failed", result.error);
    return NextResponse.json({ error: "queue insert failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, accepted: result.stored });
}
