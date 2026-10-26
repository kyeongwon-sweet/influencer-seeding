-- Return the dashboard summaries as one PostgREST row.
--
-- PostgREST caps set-returning RPC responses at 1,000 rows.  Paging the v1 RPC
-- therefore re-runs the complete window-function query for every page.  A JSON
-- bundle keeps the exact same rows and service-role boundary while evaluating
-- the expensive summary only once.

create or replace function public.monitoring_dashboard_stat_summary_bundle_v1(
  p_from date,
  p_before date,
  p_created_before timestamptz
)
returns table (summaries jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(s) order by s.id),
    '[]'::jsonb
  ) as summaries
  from public.monitoring_dashboard_stat_summaries_v1(
    p_from,
    p_before,
    p_created_before
  ) s;
$$;

revoke all on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) from public;
revoke all on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) from anon;
revoke all on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) from authenticated;
grant execute on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) to service_role;

comment on function public.monitoring_dashboard_stat_summary_bundle_v1(date, date, timestamptz) is
  'Single-row JSON bundle of exact dashboard summaries; avoids recomputing the summary RPC for each PostgREST page.';
