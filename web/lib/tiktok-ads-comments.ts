// TikTok 광고 댓글 [숨김] — injibot-action의 [숨김] 버튼(source=tiktok_ads)이 호출한다.
// Meta(Graph API)와 동일 계약({ handled, ok, error }): handled=false면 이 소스가 아님(호출측이 무시).
// Slack payload의 comment id는 신뢰하지 않고, 서버 DB(negative_comment_alerts)에서 channel+ts로 원본을 찾는다.
// advertiser_id·access token은 서버 env(Vercel 시크릿). TikTok Business API v1.3 comment/status/update.

type SupabaseErrorLike = { message?: string } | null;
type SupabaseFilterQuery<T> = {
  eq(column: string, value: string): SupabaseFilterQuery<T>;
  maybeSingle(): Promise<{ data: T | null; error: SupabaseErrorLike }>;
};
type SupabaseSelectQuery<T> = { select(columns: string): SupabaseFilterQuery<T> };
type NegativeCommentAlertRow = { source?: string | null; comment_id?: string | null };
type SupabaseLike = { from(table: string): unknown };

export type HideTiktokCommentInput = { channelId: string; messageTs: string };
export type TiktokCommentVisibility = "HIDDEN" | "PUBLIC";

const DEFAULT_TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

export async function setTiktokAdCommentVisibilityForSlackMessage(
  supabase: SupabaseLike,
  { channelId, messageTs }: HideTiktokCommentInput,
  operation: TiktokCommentVisibility,
  fetchImpl: typeof fetch = fetch,
) {
  const alertQuery = supabase.from("negative_comment_alerts") as SupabaseSelectQuery<NegativeCommentAlertRow>;
  const { data: alert, error: alertError } = await alertQuery
    .select("source,comment_id")
    .eq("slack_channel_id", channelId)
    .eq("slack_ts", messageTs)
    .maybeSingle();
  // 조회 장애를 non-TikTok으로 오인해 카드만 지우는 일이 없도록 fail closed.
  if (alertError) return { handled: true, ok: false, error: alertError.message || "alert lookup failed" };
  if (!alert || alert.source !== "tiktok_ads") return { handled: false, ok: true };
  if (!alert.comment_id) return { handled: true, ok: false, error: "TikTok comment id missing" };

  const advertiserId = (process.env.TIKTOK_ADVERTISER_ID || "").trim();
  const accessToken = (process.env.TIKTOK_ACCESS_TOKEN || "").trim();
  if (!advertiserId || !accessToken) {
    return { handled: true, ok: false, error: "TikTok advertiser/token not configured" };
  }
  const apiBase = (process.env.TIKTOK_API_BASE || DEFAULT_TIKTOK_API_BASE).replace(/\/$/, "");

  // comment/status/update: 공개↔숨김. body = { advertiser_id, comment_ids[], operation, ad_type }.
  // 라이브 광고계정 검증 결과 operation 허용값은 HIDDEN/PUBLIC이며 HIDE는 40002로 거절됐다.
  // ad_type=BIDDING은 비-Spark 다크 광고 댓글에서 실제 숨김 성공을 확인했다.
  const response = await fetchImpl(`${apiBase}/comment/status/update/`, {
    method: "POST",
    headers: { "Access-Token": accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      comment_ids: [alert.comment_id],
      operation,
      ad_type: (process.env.TIKTOK_HIDE_AD_TYPE || "BIDDING").trim(),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { code?: number; message?: string };
  // TikTok Business API: code 0 = 성공.
  if (!response.ok || payload.code !== 0) {
    return { handled: true, ok: false, error: String(payload.message || `TikTok HTTP ${response.status}`).slice(0, 200) };
  }
  return { handled: true, ok: true };
}

export async function hideTiktokAdCommentForSlackMessage(
  supabase: SupabaseLike,
  input: HideTiktokCommentInput,
  fetchImpl: typeof fetch = fetch,
) {
  return setTiktokAdCommentVisibilityForSlackMessage(supabase, input, "HIDDEN", fetchImpl);
}

export async function unhideTiktokAdCommentForSlackMessage(
  supabase: SupabaseLike,
  input: HideTiktokCommentInput,
  fetchImpl: typeof fetch = fetch,
) {
  return setTiktokAdCommentVisibilityForSlackMessage(supabase, input, "PUBLIC", fetchImpl);
}
