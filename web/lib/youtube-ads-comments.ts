// YouTube 광고 댓글 [숨김]은 소유 채널 OAuth가 저장된 negative-comment-monitor Actions에서 실행한다.
// Vercel은 Google OAuth 시크릿이나 댓글 ID를 받지 않고, Slack 서명 검증 뒤 DB 식별키(channel+ts)만 전달한다.

type SupabaseErrorLike = { message?: string } | null;
type SupabaseFilterQuery<T> = {
  eq(column: string, value: string): SupabaseFilterQuery<T>;
  maybeSingle(): Promise<{ data: T | null; error: SupabaseErrorLike }>;
};
type SupabaseSelectQuery<T> = { select(columns: string): SupabaseFilterQuery<T> };
type NegativeCommentAlertRow = { source?: string | null; platform?: string | null; comment_id?: string | null };
type SupabaseLike = { from(table: string): unknown };

export type HideYouTubeCommentInput = {
  channelId: string;
  messageTs: string;
  organicSatellite?: boolean;
};

const DEFAULT_REPO = "kyeongwon-sweet/negative-comment-monitor";
const WORKFLOW = "youtube-owner-comment-hide.yml";

export async function dispatchYouTubeAdCommentHideForSlackMessage(
  supabase: SupabaseLike,
  { channelId, messageTs, organicSatellite = false }: HideYouTubeCommentInput,
  fetchImpl: typeof fetch = fetch,
) {
  const alertQuery = supabase.from("negative_comment_alerts") as SupabaseSelectQuery<NegativeCommentAlertRow>;
  const { data: alert, error: alertError } = await alertQuery
    .select("source,platform,comment_id")
    .eq("slack_channel_id", channelId)
    .eq("slack_ts", messageTs)
    .maybeSingle();
  if (alertError) return { handled: true, ok: false, error: alertError.message || "alert lookup failed" };
  const isYouTubeAd = alert?.source === "youtube_ads";
  const isOrganicYouTube = organicSatellite
    && alert?.source == null
    && String(alert?.platform || "").toLowerCase() === "youtube";
  if (!alert || (!isYouTubeAd && !isOrganicYouTube)) return { handled: false, ok: true };
  if (!alert.comment_id) return { handled: true, ok: false, error: "YouTube comment id missing" };

  const token = (process.env.GH_DISPATCH_TOKEN || "").trim();
  if (!token) return { handled: true, ok: false, error: "GitHub dispatch token not configured" };
  const repo = (process.env.NEGATIVE_COMMENT_MONITOR_REPO || DEFAULT_REPO).trim();
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "influencer-seeding-injibot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "master",
        inputs: {
          slack_channel_id: channelId,
          slack_ts: messageTs,
          alert_scope: isOrganicYouTube ? "organic_satellite" : "youtube_ads",
        },
      }),
    },
  );
  if (!response.ok) {
    return { handled: true, ok: false, error: `GitHub workflow dispatch failed (${response.status})` };
  }
  return { handled: true, ok: true, pending: true };
}
