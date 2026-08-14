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

const DEFAULT_TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

export async function hideTiktokAdCommentForSlackMessage(
  supabase: SupabaseLike,
  { channelId, messageTs }: HideTiktokCommentInput,
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
  //   operation=HIDE(숨김), ad_type=BIDDING(비-Spark 다크 광고 기본). ⚠️ operation 정확값은 라이브 계정 검증 필요.
  const response = await fetchImpl(`${apiBase}/comment/status/update/`, {
    method: "POST",
    headers: { "Access-Token": accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      comment_ids: [alert.comment_id],
      operation: (process.env.TIKTOK_HIDE_OPERATION || "HIDE").trim(),
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
