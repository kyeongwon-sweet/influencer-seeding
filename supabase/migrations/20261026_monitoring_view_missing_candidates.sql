-- Missing-view retry queue: keep policy decisions in Python, but reduce the
-- complete per-post stat history to the exact facts those decisions consume.
--
-- p_target is an explicit KST business date supplied by the caller.  The RPC
-- never derives a date from the database/session timezone.
--
-- One JSON bundle row is intentional: PostgREST caps set-returning responses
-- at 1,000 rows, while the live candidate set is already larger than that.

create or replace function public.monitoring_view_missing_candidates_v1(
  p_target date,
  p_created_before timestamptz
)
returns table (
  candidates jsonb,
  candidate_count bigint,
  source_stat_rows bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with candidate_posts as materialized (
    select
      p.id,
      p.url,
      p.account_name,
      p.created_at,
      p.posted_at,
      p.ended_at,
      p.channel_type,
      p.notes,
      p.not_found_streak,
      p.not_found_last_at,
      p.review_requested_at
    from public.sponsored_posts p
    where p.ended_at is null
      and (p.posted_at is null or p.posted_at::date <= p_target)
      and (p.created_at is null or p.created_at <= p_created_before)
  ),
  source_rows as materialized (
    select
      s.id,
      s.post_id,
      s.measured_at,
      s.play_count,
      s.reach_count,
      s.likes_count,
      s.comments_count,
      s.manual,
      case
        -- This is deliberately not greatest()/max(): Python metric() gives a
        -- non-null play_count (including zero) precedence over reach_count.
        when s.play_count is not null then s.play_count
        else s.reach_count
      end as selected_metric
    from public.post_daily_stats s
    join candidate_posts p on p.id = s.post_id
    where s.created_at is null or s.created_at <= p_created_before
  ),
  history as (
    select
      s.post_id,
      count(*) filter (where s.measured_at::date = p_target)::integer as same_day_rows,
      coalesce(bool_or(s.selected_metric > 0) filter (where s.measured_at::date = p_target), false)
        as same_day_has_positive_metric,
      coalesce(bool_or(s.play_count is null and s.reach_count is null)
        filter (where s.measured_at::date = p_target), false) as same_day_has_null_metric,
      coalesce(bool_or(s.play_count = 0) filter (where s.measured_at::date = p_target), false)
        as same_day_has_play_zero,
      coalesce(bool_or(s.selected_metric > 0), false) as has_metric,
      coalesce(bool_or(s.likes_count is not null or s.comments_count is not null), false)
        as has_likes_or_comments,
      coalesce(bool_or(s.manual is true and s.selected_metric = 0), false) as has_manual_zero,
      coalesce(bool_or(s.play_count is not null and s.manual is distinct from true), false)
        as has_auto_play_ever,
      coalesce(bool_or(s.reach_count is not null and s.manual is distinct from true), false)
        as has_auto_reach_ever,
      coalesce(bool_or(s.reach_count > 0), false) as has_reach_ever
    from source_rows s
    group by s.post_id
  ),
  last_positive as (
    select distinct on (s.post_id)
      s.post_id,
      s.selected_metric::bigint as last_metric,
      s.measured_at::date as last_metric_date
    from source_rows s
    where s.selected_metric > 0
    -- Legacy fetch_pages() orders by id ascending and overwrites ties for the
    -- same measured_at, so the greatest id is the exact same final row.
    order by s.post_id, s.measured_at desc, s.id desc
  ),
  candidate_rows as (
    select
      p.id,
      jsonb_build_object(
        'id', p.id,
        'url', p.url,
        'account_name', p.account_name,
        'created_at', p.created_at,
        'posted_at', p.posted_at,
        'ended_at', p.ended_at,
        'channel_type', p.channel_type,
        'notes', p.notes,
        'not_found_streak', p.not_found_streak,
        'not_found_last_at', p.not_found_last_at,
        'review_requested_at', p.review_requested_at,
        'same_day_rows', coalesce(h.same_day_rows, 0),
        'same_day_has_positive_metric', coalesce(h.same_day_has_positive_metric, false),
        'same_day_has_null_metric', coalesce(h.same_day_has_null_metric, false),
        'same_day_has_play_zero', coalesce(h.same_day_has_play_zero, false),
        'has_metric', coalesce(h.has_metric, false),
        'has_likes_or_comments', coalesce(h.has_likes_or_comments, false),
        'has_manual_zero', coalesce(h.has_manual_zero, false),
        'has_auto_play_ever', coalesce(h.has_auto_play_ever, false),
        'has_auto_reach_ever', coalesce(h.has_auto_reach_ever, false),
        'has_reach_ever', coalesce(h.has_reach_ever, false),
        'last_metric', lp.last_metric,
        'last_metric_date', lp.last_metric_date
      ) as payload
    from candidate_posts p
    left join history h on h.post_id = p.id
    left join last_positive lp on lp.post_id = p.id
  )
  select
    coalesce(jsonb_agg(c.payload order by c.id), '[]'::jsonb) as candidates,
    count(*)::bigint as candidate_count,
    (select count(*)::bigint from source_rows) as source_stat_rows
  from candidate_rows c;
$$;

revoke all on function public.monitoring_view_missing_candidates_v1(date, timestamptz) from public;
revoke all on function public.monitoring_view_missing_candidates_v1(date, timestamptz) from anon;
revoke all on function public.monitoring_view_missing_candidates_v1(date, timestamptz) from authenticated;
grant execute on function public.monitoring_view_missing_candidates_v1(date, timestamptz) to service_role;

comment on function public.monitoring_view_missing_candidates_v1(date, timestamptz) is
  'Single-row exact candidate/history facts for the Python missing-view policy; target is an explicit KST business date.';
