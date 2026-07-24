type SupabaseUpdateResult = {
  data?: Array<{ id?: string }> | null;
  error?: { message?: string } | null;
};

export type FalsePositiveReviewInput = {
  channelId: string;
  messageTs: string;
  userId: string;
  reviewedAt?: string;
};

export type FalsePositiveReviewResult = {
  ok: boolean;
  matchedRows: number;
  error?: string;
};

export async function recordFalsePositiveReview(
  supabase: any,
  { channelId, messageTs, userId, reviewedAt = new Date().toISOString() }: FalsePositiveReviewInput
): Promise<FalsePositiveReviewResult> {
  if (!channelId || !messageTs) {
    return { ok: false, matchedRows: 0, error: "missing Slack channel id or message ts" };
  }

  const { data, error } = await supabase
    .from("negative_comment_alerts")
    .update({
      review_decision: "false_positive",
      reviewed_by: userId,
      reviewed_at: reviewedAt,
    })
    .eq("slack_channel_id", channelId)
    .eq("slack_ts", messageTs)
    .select("id");

  if (error) {
    return { ok: false, matchedRows: 0, error: error.message || "Supabase update failed" };
  }

  const matchedRows = Array.isArray(data) ? data.length : 0;
  if (matchedRows === 0) {
    return { ok: false, matchedRows, error: "no matching alert row" };
  }

  return { ok: true, matchedRows };
}
