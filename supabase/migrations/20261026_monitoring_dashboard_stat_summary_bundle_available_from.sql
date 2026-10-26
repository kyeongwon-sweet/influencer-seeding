-- Preserve the legacy dashboard's unfiltered auxiliary KPI range without
-- transferring old daily rows. The single date is the earliest stat that the
-- old full-history response could expose for a dashboard-visible post.

drop function if exists public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz);

create function public.monitoring_dashboard_stat_summary_bundle_v1(
  p_from date,
  p_before date,
  p_created_before timestamptz
)
returns table (summaries jsonb, available_from date)
language sql
stable
security invoker
set search_path = public
as $$
  with summary_rows as materialized (
    select *
    from public.monitoring_dashboard_stat_summaries_v1(
      p_from,
      p_before,
      p_created_before
    )
  ),
  first_stat as (
    select min(s.measured_at)::date as available_from
    from public.post_daily_stats s
    join public.sponsored_posts p on p.id = s.post_id
    where s.measured_at < p_before
      and s.created_at <= p_created_before
      -- Legacy chartData used pickMetric(), which is play_count only.
      -- Likes/comments-only rows must not move the auxiliary KPI start earlier.
      and s.play_count is not null
      and p.product_name is not null
      and p.product_name <> ''
      and (p.posted_at is null or s.measured_at >= p.posted_at::date)
  )
  select
    coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) as summaries,
    f.available_from
  from summary_rows s
  cross join first_stat f
  group by f.available_from;
$$;

revoke all on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) from public;
revoke all on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) from anon;
revoke all on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) from authenticated;
grant execute on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) to service_role;

comment on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) is
  'Single-row exact dashboard summary bundle plus the earliest legacy-visible stat date; service-role only.';
