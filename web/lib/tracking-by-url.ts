export type TrackingPlanRow = {
  url: string;
  key: string | null;
  ended_at: string | null;
};

export type TrackingPostRow = {
  id: string;
  url: string | null;
  normalized_key?: string | null;
  manual_fields?: string[] | null;
};

export type TrackingUpdateGroup = {
  ended_at: string | null;
  manual_fields: string[];
  ids: string[];
};

export function mergeTrackingManualFields(current: unknown, protectEndedAt: boolean): string[] {
  const fields = Array.isArray(current) ? current.map(String) : [];
  const set = new Set(fields.filter(Boolean));
  if (protectEndedAt) set.add("ended_at");
  else set.delete("ended_at");
  return [...set];
}

/**
 * Bulk-read 결과를 기존 순차 라우트와 같은 의미로 쓰기 계획으로 바꾼다.
 * - normalized_key가 매칭되면 URL fallback을 사용하지 않는다.
 * - 같은 DB 행이 요청에 여러 번 나오면 마지막 요청이 최종 상태다.
 * - manual_fields가 다른 행은 같은 bulk UPDATE로 합치지 않는다.
 */
export function buildTrackingUpdatePlan(rows: TrackingPlanRow[], posts: TrackingPostRow[]): {
  groups: TrackingUpdateGroup[];
  missing: string[];
} {
  const uniquePosts = new Map(posts.map(post => [post.id, post]));
  const byKey = new Map<string, TrackingPostRow[]>();
  const byUrl = new Map<string, TrackingPostRow[]>();
  for (const post of uniquePosts.values()) {
    if (post.normalized_key) {
      const matches = byKey.get(post.normalized_key) ?? [];
      matches.push(post);
      byKey.set(post.normalized_key, matches);
    }
    if (post.url) {
      const matches = byUrl.get(post.url) ?? [];
      matches.push(post);
      byUrl.set(post.url, matches);
    }
  }

  const finalByPost = new Map<string, { post: TrackingPostRow; row: TrackingPlanRow }>();
  const missing: string[] = [];
  for (const row of rows) {
    const keyMatches = row.key ? (byKey.get(row.key) ?? []) : [];
    const matches = keyMatches.length ? keyMatches : (byUrl.get(row.url) ?? []);
    if (!matches.length) {
      missing.push(row.url);
      continue;
    }
    for (const post of matches) finalByPost.set(post.id, { post, row });
  }

  const grouped = new Map<string, TrackingUpdateGroup>();
  for (const { post, row } of finalByPost.values()) {
    const manualFields = mergeTrackingManualFields(post.manual_fields, row.ended_at === null);
    const groupKey = JSON.stringify([row.ended_at, manualFields]);
    const group = grouped.get(groupKey) ?? {
      ended_at: row.ended_at,
      manual_fields: manualFields,
      ids: [],
    };
    group.ids.push(post.id);
    grouped.set(groupKey, group);
  }

  return { groups: [...grouped.values()], missing };
}
