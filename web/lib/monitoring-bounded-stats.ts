import { addDaysToDate } from "./dateRule.ts";

export const DASHBOARD_HISTORY_DAYS = 60;
export const STATS_LOADED_FROM_HEADER = "X-Stats-Loaded-From";
export const STATS_LOADED_BEFORE_HEADER = "X-Stats-Loaded-Before";
export const STATS_HISTORY_MODE_HEADER = "X-Stats-History-Mode";

export type DashboardStatRow = {
  post_id: string;
  measured_at: string;
  play_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  created_at?: string | null;
  reach_count?: number | null;
  manual?: boolean | null;
  fb_play_count?: number | null;
  play_collected?: boolean;
  history_baseline?: boolean;
  history_ig_max?: number | null;
  history_reach_max?: number | null;
  history_fb_max?: number | null;
  history_likes_seed?: number | null;
  history_comments_seed?: number | null;
  history_latest_increment?: number | null;
};

export type DashboardStatSummary = {
  id?: string;
  post_id: string;
  latest_stats?: DashboardStatRow | null;
  prev_stats?: DashboardStatRow | null;
  prior_play_seed?: number | string | null;
  prior_reach_seed?: number | string | null;
  prior_ig_max?: number | string | null;
  prior_reach_max?: number | string | null;
  prior_fb_max?: number | string | null;
  prior_likes_seed?: number | string | null;
  prior_comments_seed?: number | string | null;
  prior_display_measured_at?: string | null;
  prior_display_likes?: number | string | null;
  prior_display_comments?: number | string | null;
  prior_display_increment?: number | string | null;
  day7_play_count?: number | string | null;
};

/**
 * RPC JSON bundle의 최소 식별 계약을 검증한다. 숫자 필드는 Postgres/Supabase 설정에
 * 따라 number 또는 string이 될 수 있어 여기서는 식별자와 행 구조만 엄격히 검사하고,
 * 전체 게시물 coverage·중복 여부는 route에서 별도로 fail-closed 한다.
 */
export function decodeDashboardStatSummaryBundle(value: unknown): DashboardStatSummary[] | null {
  if (!Array.isArray(value)) return null;
  const rows: DashboardStatSummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.post_id !== "string" || row.id !== row.post_id) {
      return null;
    }
    rows.push(row as DashboardStatSummary);
  }
  return rows;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 최근 구간 첫날의 증분 기준만 전달하기 위한 합성 행.
 * 화면의 날짜축에는 노출하지 않고 safeIncrement의 과거 baseline으로만 사용한다.
 */
export function historyBaselineRow(
  summary: DashboardStatSummary | undefined,
  loadedFrom: string,
  isBanner: boolean,
): DashboardStatRow | null {
  if (!summary) return null;
  // 오래전에 종료된 글을 합성 cutoff 날짜로 바꾸면 수기 편집이 엉뚱한 날짜에 저장된다.
  // DB가 고른 실제 마지막 표시행 날짜를 보존하고, 예전 RPC와의 롤링 배포에서만 cutoff-1로 폴백한다.
  const measured_at = summary.prior_display_measured_at ?? addDaysToDate(loadedFrom, -1);
  if (isBanner) {
    const reach = finiteNumber(summary.prior_reach_seed);
    const reachMax = finiteNumber(summary.prior_reach_max);
    const likes = finiteNumber(summary.prior_likes_seed);
    const comments = finiteNumber(summary.prior_comments_seed);
    const latestIncrement = finiteNumber(summary.prior_display_increment);
    const displayLikes = finiteNumber(summary.prior_display_likes);
    const displayComments = finiteNumber(summary.prior_display_comments);
    if ((reach == null || reach <= 0) && likes == null && comments == null) return null;
    return {
      post_id: summary.post_id,
      measured_at,
      play_count: null,
      likes_count: displayLikes,
      comments_count: displayComments,
      reach_count: reach != null && reach > 0 ? reach : null,
      fb_play_count: null,
      play_collected: false,
      history_baseline: true,
      history_reach_max: reachMax,
      history_likes_seed: likes,
      history_comments_seed: comments,
      history_latest_increment: latestIncrement,
    };
  }
  const playSeed = finiteNumber(summary.prior_play_seed);
  const ig = finiteNumber(summary.prior_ig_max);
  const fb = finiteNumber(summary.prior_fb_max) ?? 0;
  const likes = finiteNumber(summary.prior_likes_seed);
  const comments = finiteNumber(summary.prior_comments_seed);
  const latestIncrement = finiteNumber(summary.prior_display_increment);
  const displayLikes = finiteNumber(summary.prior_display_likes);
  const displayComments = finiteNumber(summary.prior_display_comments);
  if ((playSeed == null || playSeed <= 0) && (ig == null || ig <= 0) && fb <= 0 && likes == null && comments == null) return null;
  return {
    post_id: summary.post_id,
    measured_at,
    // 단조화 seed는 컷오프 직전의 실제 state다. 과거 최대값과 합치면 수기 하향
    // 정정을 되돌리므로 safeIncrement용 max는 별도 metadata로 보존한다.
    play_count: Math.max(0, playSeed ?? 0),
    likes_count: displayLikes,
    comments_count: displayComments,
    reach_count: null,
    fb_play_count: fb > 0 ? fb : null,
    play_collected: true,
    history_baseline: true,
    history_ig_max: ig,
    history_fb_max: fb > 0 ? fb : null,
    history_likes_seed: likes,
    history_comments_seed: comments,
    history_latest_increment: latestIncrement,
  };
}

/** 기존 서버 단조화 규칙과 동일. 합성 baseline을 첫 행으로 넣으면 최근 구간의 첫 값도 정확히 clamp된다. */
export function monotonicDashboardStats(rows: DashboardStatRow[]): DashboardStatRow[] {
  let maxPlay = 0;
  return [...rows]
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .map((row) => {
      const collected = row.history_baseline === true || row.play_count != null;
      const manualReset = row.manual === true && row.play_count != null && Number(row.play_count) > 0;
      const play = manualReset
        ? Number(row.play_count)
        : collected
          ? Math.max(maxPlay, Number(row.play_count ?? 0))
          : maxPlay;
      maxPlay = play;
      return { ...row, play_count: play, play_collected: collected };
    });
}

export function visibleDashboardStats<T extends { history_baseline?: boolean }>(rows: T[]): T[] {
  return rows.filter((row) => row.history_baseline !== true);
}

/** full-history fallback와 RPC parity 검증에 쓰는 기존 UI summary semantics. */
export function exactDashboardSummary(rows: DashboardStatRow[], postedAt?: string | null): {
  latest_stats: DashboardStatRow | null;
  prev_stats: DashboardStatRow | null;
  day7_play_count: number | null;
} {
  const visible = monotonicDashboardStats(rows.filter((row) => (
    !postedAt || String(row.measured_at).slice(0, 10) >= String(postedAt).slice(0, 10)
  )));
  const latest = visible.length ? visible[visible.length - 1] : null;
  const prevDate = latest ? addDaysToDate(latest.measured_at, -1) : null;
  const prev = prevDate ? (visible.find((row) => row.measured_at === prevDate) ?? null) : null;
  let day7: { distance: number; value: number } | null = null;
  if (postedAt) {
    const target = addDaysToDate(String(postedAt).slice(0, 10), 7);
    for (const row of visible) {
      const distance = Math.abs(
        (Date.parse(`${row.measured_at}T00:00:00Z`) - Date.parse(`${target}T00:00:00Z`)) / 86400000,
      );
      if (distance <= 2 && (!day7 || distance < day7.distance)) {
        day7 = { distance, value: Number(row.play_count ?? 0) };
      }
    }
  }
  return { latest_stats: latest, prev_stats: prev, day7_play_count: day7?.value ?? null };
}
