import crypto from "crypto";

export type MetaAdCommentEvent = {
  comment_id: string;
  ig_user_id: string;
  media_id: string | null;
  original_media_id: string | null;
  ad_id: string;
  ad_title: string | null;
  username: string | null;
  comment_text: string;
  parent_comment_id: string | null;
  event_time: string | null;
};

export function verifyMetaWebhookSignature(rawBody: string, signature: string, appSecret: string): boolean {
  if (!rawBody || !signature || !appSecret || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function extractMetaAdCommentEvents(payload: unknown): MetaAdCommentEvent[] {
  const root = payload as { object?: string; entry?: Array<Record<string, unknown>> };
  if (root?.object !== "instagram" || !Array.isArray(root.entry)) return [];
  const events: MetaAdCommentEvent[] = [];
  for (const entry of root.entry) {
    const igUserId = String(entry.id || "");
    const eventTime = Number.isFinite(Number(entry.time))
      ? new Date(Number(entry.time) * 1000).toISOString()
      : null;
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : [];
    for (const change of changes) {
      if (change.field !== "comments") continue;
      const value = (change.value || {}) as Record<string, unknown>;
      const media = (value.media || {}) as Record<string, unknown>;
      const from = (value.from || {}) as Record<string, unknown>;
      const commentId = String(value.comment_id || value.id || "");
      const adId = String(media.ad_id || "");
      const text = String(value.text || "").trim();
      if (!commentId || !adId || !text || !igUserId) continue;
      events.push({
        comment_id: commentId,
        ig_user_id: igUserId,
        media_id: media.id ? String(media.id) : null,
        original_media_id: media.original_media_id ? String(media.original_media_id) : null,
        ad_id: adId,
        ad_title: media.ad_title ? String(media.ad_title) : null,
        username: from.username ? String(from.username) : null,
        comment_text: text,
        parent_comment_id: value.parent_id ? String(value.parent_id) : null,
        event_time: eventTime,
      });
    }
  }
  return events;
}

type SupabaseErrorLike = { message?: string } | null;
type SupabaseFilterQuery<T> = {
  eq(column: string, value: string): SupabaseFilterQuery<T>;
  maybeSingle(): Promise<{ data: T | null; error: SupabaseErrorLike }>;
};
type SupabaseUpsertQuery = {
  upsert(values: MetaAdCommentEvent[], options: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<{ error: SupabaseErrorLike }>;
};
type SupabaseSelectQuery<T> = {
  select(columns: string): SupabaseFilterQuery<T>;
};
type NegativeCommentAlertRow = { source?: string | null; comment_id?: string | null };
type MetaTokenRow = { token?: string | null; expires_at?: string | null };
type SupabaseLike = { from(table: string): unknown };

export async function storeMetaAdCommentEvents(supabase: SupabaseLike, events: MetaAdCommentEvent[]) {
  if (!events.length) return { ok: true, stored: 0 };
  const query = supabase.from("meta_ad_comment_events") as SupabaseUpsertQuery;
  const { error } = await query
    .upsert(events, { onConflict: "comment_id", ignoreDuplicates: true });
  if (error) return { ok: false, stored: 0, error: error.message || "Supabase upsert failed" };
  return { ok: true, stored: events.length };
}

export type HideMetaCommentInput = { channelId: string; messageTs: string; graphBase?: string };

// Slack payload의 comment id를 신뢰하지 않고, 서버 DB에서 channel+ts로 원본 댓글을 찾는다.
export async function hideMetaAdCommentForSlackMessage(
  supabase: SupabaseLike,
  { channelId, messageTs, graphBase = "https://graph.facebook.com/v26.0" }: HideMetaCommentInput,
  fetchImpl: typeof fetch = fetch,
) {
  const alertQuery = supabase.from("negative_comment_alerts") as SupabaseSelectQuery<NegativeCommentAlertRow>;
  const { data: alert, error: alertError } = await alertQuery
    .select("source,comment_id")
    .eq("slack_channel_id", channelId)
    .eq("slack_ts", messageTs)
    .maybeSingle();
  // 조회 장애를 non-Meta로 오인해 Slack 메시지만 지우는 일이 없도록 fail closed.
  if (alertError) return { handled: true, ok: false, error: alertError.message || "alert lookup failed" };
  if (!alert || alert.source !== "meta_ads") return { handled: false, ok: true };
  if (!alert.comment_id) return { handled: true, ok: false, error: "Meta comment id missing" };

  const tokenQuery = supabase.from("meta_tokens") as SupabaseSelectQuery<MetaTokenRow>;
  const { data: tokenRow, error: tokenError } = await tokenQuery
    .select("token,expires_at")
    .eq("kind", "ig_ads")
    .maybeSingle();
  if (tokenError || !tokenRow?.token) {
    return { handled: true, ok: false, error: tokenError?.message || "Meta token missing" };
  }
  const expiresAt = Date.parse(tokenRow.expires_at || "");
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return { handled: true, ok: false, error: "Meta token expired" };
  }

  const response = await fetchImpl(
    `${graphBase.replace(/\/$/, "")}/${encodeURIComponent(alert.comment_id)}?hide=true`,
    { method: "POST", headers: { Authorization: `Bearer ${tokenRow.token}` } },
  );
  const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } };
  if (!response.ok || payload.success !== true) {
    return { handled: true, ok: false, error: String(payload.error?.message || `Meta HTTP ${response.status}`).slice(0, 200) };
  }
  return { handled: true, ok: true };
}
