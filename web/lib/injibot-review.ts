type SupabaseUpdateResult = {
  data?: Array<{ id?: string }> | null;
  error?: { message?: string } | null;
};

type SupabaseUpdateQuery = {
  eq(column: string, value: string): SupabaseUpdateQuery;
  select(columns: string): PromiseLike<SupabaseUpdateResult>;
};

type SupabaseClientLike = {
  from(table: string): {
    update(values: Record<string, unknown>): SupabaseUpdateQuery;
  };
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

export type ReviewDecisionInput = {
  channelId: string;
  messageTs: string;
  decision: string;
  userId: string;
  reviewedAt?: string;
};

// 처리 결과(review_decision)를 slack_channel_id + slack_ts로 기록. decision 예: complete/hide/approve/hold/unhide/false_positive.
export async function recordReviewDecision(
  supabase: SupabaseClientLike,
  { channelId, messageTs, decision, userId, reviewedAt = new Date().toISOString() }: ReviewDecisionInput
): Promise<FalsePositiveReviewResult> {
  if (!channelId || !messageTs || !decision) {
    return { ok: false, matchedRows: 0, error: "missing channel/ts/decision" };
  }

  const { data, error } = await supabase
    .from("negative_comment_alerts")
    .update({
      review_decision: decision,
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

// 오탐(false_positive) 기록 — recordReviewDecision의 특수형(분류기 피드백에 사용).
export async function recordFalsePositiveReview(
  supabase: SupabaseClientLike,
  { channelId, messageTs, userId, reviewedAt }: FalsePositiveReviewInput
): Promise<FalsePositiveReviewResult> {
  return recordReviewDecision(supabase, { channelId, messageTs, decision: "false_positive", userId, reviewedAt });
}
