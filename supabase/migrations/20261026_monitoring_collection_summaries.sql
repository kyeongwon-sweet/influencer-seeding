-- Monitoring collector: keep historical reductions inside Postgres.
--
-- run_monitoring.py used to transfer every historical post_daily_stats row for
-- active posts, then transfer the full history again for daily_view_snapshot.
-- These RPCs preserve the exact reductions while returning one JSON bundle row
-- (active summary) and one row total (snapshot).  The bundle is required because
-- PostgREST can cap set-returning RPC responses at 1,000 rows while the active set
-- is already larger than that.  The caller supplies the KST business-date boundary
-- explicitly; database/session timezone is irrelevant.

create or replace function public.monitoring_collection_active_summary_v1(
  p_post_ids uuid[],
  p_target_date date
)
returns table (
  summary_rows jsonb,
  row_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with requested as (
    select distinct unnest(coalesce(p_post_ids, '{}'::uuid[])) as post_id
  ),
  history as (
    select
      s.id,
      s.post_id,
      s.play_count,
      s.reach_count,
      s.likes_count,
      s.comments_count,
      s.measured_at,
      s.manual,
      s.created_at
    from public.post_daily_stats s
    join requested r on r.post_id = s.post_id
  ),
  latest_before_target as (
    select distinct on (h.post_id)
      h.post_id,
      h.play_count,
      h.reach_count,
      h.likes_count,
      h.comments_count,
      h.measured_at,
      h.manual
    from history h
    where h.measured_at < p_target_date
    order by h.post_id, h.measured_at desc, h.created_at desc, h.id desc
  ),
  reduced as (
    select
      h.post_id,
      greatest(
        coalesce(max(h.play_count) filter (where h.play_count > 0), 0),
        coalesce(max(h.reach_count) filter (where h.reach_count > 0), 0)
      )::bigint as max_metric,
      bool_or(h.manual is true) as manual_tracked,
      max(h.measured_at) filter (
        where greatest(coalesce(h.play_count, 0), coalesce(h.reach_count, 0)) > 0
      ) as last_valid_metric_date,
      bool_or(h.play_count > 0) as had_positive_play,
      max(h.measured_at) filter (
        where h.manual is true
          and (h.play_count is not null or h.reach_count is not null)
      ) as last_manual_at
    from history h
    group by h.post_id
  ),
  output_rows as (
    select
      r.post_id,
      l.play_count::bigint as last_play_count,
      l.reach_count::bigint as last_reach_count,
      l.likes_count::bigint as last_likes_count,
      l.comments_count::bigint as last_comments_count,
      l.measured_at as last_measured_at,
      l.manual as last_manual,
      coalesce(a.max_metric, 0)::bigint as max_metric,
      coalesce(a.manual_tracked, false) as manual_tracked,
      a.last_valid_metric_date,
      coalesce(a.had_positive_play, false) as had_positive_play,
      a.last_manual_at
    from requested r
    left join latest_before_target l on l.post_id = r.post_id
    left join reduced a on a.post_id = r.post_id
  )
  select
    coalesce(jsonb_agg(to_jsonb(o) order by o.post_id), '[]'::jsonb) as summary_rows,
    count(*)::bigint as row_count
  from output_rows o;
$$;

create or replace function public.monitoring_collection_snapshot_totals_v1(
  p_post_ids uuid[],
  p_upto date
)
returns table (
  total_play bigint,
  total_likes bigint,
  total_comments bigint,
  post_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with requested as (
    select distinct unnest(coalesce(p_post_ids, '{}'::uuid[])) as post_id
  ),
  history as (
    select
      s.id,
      s.post_id,
      s.play_count,
      s.likes_count,
      s.comments_count,
      s.measured_at,
      s.created_at
    from public.post_daily_stats s
    join requested r on r.post_id = s.post_id
    where s.measured_at <= p_upto
  ),
  latest as (
    select distinct on (h.post_id)
      h.post_id,
      h.likes_count,
      h.comments_count
    from history h
    order by h.post_id, h.measured_at desc, h.created_at desc, h.id desc
  ),
  max_play as (
    select
      h.post_id,
      max(h.play_count) filter (where h.play_count >= 0) as play_count
    from history h
    group by h.post_id
  )
  select
    coalesce((select sum(m.play_count) from max_play m), 0)::bigint as total_play,
    coalesce(sum(
      case
        when coalesce(l.likes_count, 0) >= 0 then coalesce(l.likes_count, 0)
        else 0
      end
    ), 0)::bigint as total_likes,
    coalesce(sum(
      case
        when coalesce(l.comments_count, 0) >= 0 then coalesce(l.comments_count, 0)
        else 0
      end
    ), 0)::bigint as total_comments,
    count(l.post_id)::bigint as post_count
  from latest l;
$$;

revoke all on function public.monitoring_collection_active_summary_v1(uuid[], date) from public;
revoke all on function public.monitoring_collection_active_summary_v1(uuid[], date) from anon;
revoke all on function public.monitoring_collection_active_summary_v1(uuid[], date) from authenticated;
grant execute on function public.monitoring_collection_active_summary_v1(uuid[], date) to service_role;

revoke all on function public.monitoring_collection_snapshot_totals_v1(uuid[], date) from public;
revoke all on function public.monitoring_collection_snapshot_totals_v1(uuid[], date) from anon;
revoke all on function public.monitoring_collection_snapshot_totals_v1(uuid[], date) from authenticated;
grant execute on function public.monitoring_collection_snapshot_totals_v1(uuid[], date) to service_role;

comment on function public.monitoring_collection_active_summary_v1(uuid[], date) is
  'Exact run_monitoring active-history reduction for an explicit KST target date; service_role only.';
comment on function public.monitoring_collection_snapshot_totals_v1(uuid[], date) is
  'Exact run_monitoring daily snapshot reduction through an explicit KST date; service_role only.';
