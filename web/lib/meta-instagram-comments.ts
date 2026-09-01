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

type MetaCommentCandidate = MetaAdCommentEvent & { ad_id: string };

export function verifyMetaWebhookSignature(rawBody: string, signature: string, appSecret: string): boolean {
  if (!rawBody || !signature || !appSecret || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export type MetaWebhookShapeSummary = {
  object: string;
  entryCount: number;
  changeCount: number;
  fields: string[];
  valueKeys: string[];
  mediaKeys: string[];
  commentLikeChanges: number;
  adTaggedChanges: number;
};

// Webhook delivery diagnostics must never log comment text, account ids, media ids,
// usernames, or signatures. Keep only the structural keys needed to distinguish
// an Instagram comments delivery from an unrelated Page/feed delivery.
export function summarizeMetaWebhookPayload(payload: unknown): MetaWebhookShapeSummary {
  const root = payload as { object?: unknown; entry?: Array<Record<string, unknown>> };
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const fields = new Set<string>();
  const valueKeys = new Set<string>();
  const mediaKeys = new Set<string>();
  let changeCount = 0;
  let commentLikeChanges = 0;
  let adTaggedChanges = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : [];
    for (const change of changes) {
      changeCount += 1;
      const field = String(change.field || "");
      if (field) fields.add(field);
      const value = change.value && typeof change.value === "object"
        ? change.value as Record<string, unknown>
        : {};
      for (const key of Object.keys(value)) valueKeys.add(key);
      const media = value.media && typeof value.media === "object"
        ? value.media as Record<string, unknown>
        : {};
      for (const key of Object.keys(media)) mediaKeys.add(key);
      if (field === "comments" || value.comment_id || value.id) commentLikeChanges += 1;
      if (media.ad_id || value.ad_id) adTaggedChanges += 1;
    }
  }

  return {
    object: String(root?.object || ""),
    entryCount: entries.length,
    changeCount,
    fields: [...fields].sort(),
    valueKeys: [...valueKeys].sort(),
    mediaKeys: [...mediaKeys].sort(),
    commentLikeChanges,
    adTaggedChanges,
  };
}

function extractMetaCommentCandidates(payload: unknown): MetaCommentCandidate[] {
  const root = payload as { object?: string; entry?: Array<Record<string, unknown>> };
  if (root?.object !== "instagram" || !Array.isArray(root.entry)) return [];
  const events: MetaCommentCandidate[] = [];
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
      if (!commentId || !text || !igUserId) continue;
      const adTitle = media.ad_title ? String(media.ad_title) : null;
      // 전환(conversion) 광고는 큐에 담지 않는다(김유진 별도관리, 분류 토큰 절약). 소재명 토큰에 '전환'.
      if (adTitle && adTitle.split("_").map((s) => s.trim()).includes("전환")) continue;
      events.push({
        comment_id: commentId,
        ig_user_id: igUserId,
        media_id: media.id ? String(media.id) : null,
        original_media_id: media.original_media_id ? String(media.original_media_id) : null,
        ad_id: adId,
        ad_title: adTitle,
        username: from.username ? String(from.username) : null,
        comment_text: text,
        parent_comment_id: value.parent_id ? String(value.parent_id) : null,
        event_time: eventTime,
      });
    }
  }
  return events;
}

export function extractMetaAdCommentEvents(payload: unknown): MetaAdCommentEvent[] {
  return extractMetaCommentCandidates(payload).filter((event) => Boolean(event.ad_id));
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

type MetaAdCreative = {
  id?: string;
  name?: string;
  creative?: {
    effective_instagram_media_id?: string;
    source_instagram_media_id?: string;
  };
};

// Instagram v26 comments payloads (특히 dynamic ads)는 media.ad_id를 생략할 수 있다.
// 이 경우 광고계정의 creative media id와 대조해 실제 광고 댓글만 복원하고,
// 매칭되지 않은 오가닉 댓글은 인지광고 큐에 넣지 않는다.
export async function resolveMetaAdlessCommentEvents(
  supabase: SupabaseLike,
  payload: unknown,
  { adAccountId, graphBase = "https://graph.facebook.com/v26.0" }: { adAccountId: string; graphBase?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MetaAdCommentEvent[]> {
  const candidates = extractMetaCommentCandidates(payload).filter((event) => !event.ad_id && (event.media_id || event.original_media_id));
  const account = String(adAccountId || "").trim();
  if (!candidates.length || !account) return [];

  const tokenQuery = supabase.from("meta_tokens") as SupabaseSelectQuery<MetaTokenRow>;
  const { data: tokenRow, error: tokenError } = await tokenQuery
    .select("token,expires_at")
    .eq("kind", "ig_ads")
    .maybeSingle();
  if (tokenError || !tokenRow?.token) return [];
  const expiresAt = Date.parse(tokenRow.expires_at || "");
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return [];

  const mediaIds = new Set(candidates.flatMap((event) => [event.media_id, event.original_media_id]).filter(Boolean) as string[]);
  const adByMedia = new Map<string, { id: string; title: string }>();
  const fields = "id,name,creative{effective_instagram_media_id,source_instagram_media_id}";
  const base = graphBase.replace(/\/$/, "");
  let next = `${base}/${encodeURIComponent(account)}/ads?fields=${encodeURIComponent(fields)}&limit=500`;
  for (let page = 0; next && page < 10 && adByMedia.size < mediaIds.size; page += 1) {
    const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${tokenRow.token}` } });
    if (!response.ok) return [];
    const body = await response.json().catch(() => ({})) as { data?: MetaAdCreative[]; paging?: { next?: string } };
    for (const ad of body.data || []) {
      const id = String(ad.id || "");
      if (!id) continue;
      const title = String(ad.name || "");
      for (const mediaId of [ad.creative?.effective_instagram_media_id, ad.creative?.source_instagram_media_id]) {
        const key = String(mediaId || "");
        if (key && mediaIds.has(key)) adByMedia.set(key, { id, title });
      }
    }
    next = String(body.paging?.next || "");
  }

  return candidates.flatMap((event) => {
    const ad = adByMedia.get(String(event.media_id || ""))
      || adByMedia.get(String(event.original_media_id || ""));
    if (!ad || (ad.title && ad.title.split("_").map((part) => part.trim()).includes("전환"))) return [];
    return [{ ...event, ad_id: ad.id, ad_title: ad.title || null }];
  });
}

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
