-- Reverse-watchdog egress reduction.
--
-- The legacy job downloads sponsored_posts plus the complete post_daily_stats
-- history (and a second recent window) to find a handful of day-over-day drops.
-- Keep the detector semantics in Postgres and return the complete event set as
-- one JSON row so PostgREST's 1,000-row cap cannot truncate or repaginate it.

create or replace function public.monitoring_reverse_events_v1(
  p_threshold double precision
)
returns table (events jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  with source_rows as (
    select
      s.id,
      s.post_id,
      s.measured_at,
      s.created_at,
      p.url,
      p.account_name,
      (
        coalesce(p.channel_type, '') like '%배너%'
        or lower(coalesce(p.channel_type, '')) like '%banner%'
        or (
          coalesce(p.channel_type, '') like '%매거진%'
          and p.posted_at::date >= date '2026-08-18'
        )
      ) as is_banner,
      case
        when (
          coalesce(p.channel_type, '') like '%배너%'
          or lower(coalesce(p.channel_type, '')) like '%banner%'
          or (
            coalesce(p.channel_type, '') like '%매거진%'
            and p.posted_at::date >= date '2026-08-18'
          )
        ) then s.reach_count
        else s.play_count
      end as metric_value,
      first_value(s.id) over (
        partition by s.post_id
        order by s.id
        rows between unbounded preceding and unbounded following
      ) as post_first_stat_id,
      row_number() over (
        partition by s.post_id, s.measured_at::date
        order by s.measured_at desc, s.created_at desc nulls last, s.id desc
      ) as same_day_rank
    from public.post_daily_stats s
    -- Match legacy's `posts.get(post_id) or {}` behavior even if historical
    -- orphan stats exist: they remain play-count events with an empty label.
    left join public.sponsored_posts p on p.id = s.post_id
  ),
  -- Legacy Python sorts by measured_at/created_at/id and keeps the last row for
  -- each date.  DESC + rank=1 is exactly that same-day correction rule.
  same_day_latest as (
    select *
    from source_rows
    where same_day_rank = 1
  ),
  -- Zero/null means deletion or missing measurement. It is neither an event nor
  -- a new baseline; remove it before lag() so the previous valid value survives.
  valid_daily as (
    select *
    from same_day_latest
    where metric_value is not null
      and metric_value > 0
  ),
  with_previous as (
    select
      v.*,
      lag(v.metric_value) over (
        partition by v.post_id order by v.measured_at
      ) as prev_value,
      lag(v.measured_at) over (
        partition by v.post_id order by v.measured_at
      ) as prev_date
    from valid_daily v
  ),
  reverse_rows as (
    select *
    from with_previous
    where prev_value is not null
      and metric_value < prev_value
      and ((prev_value - metric_value)::double precision / prev_value::double precision) >= p_threshold
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'post_id', post_id,
        'url', coalesce(url, '(URL 없음)'),
        'account_name', coalesce(account_name, ''),
        'date', to_char(measured_at, 'YYYY-MM-DD'),
        'metric', case when is_banner then '도달수' else '조회수' end,
        'value', metric_value,
        'prev', prev_value,
        'prev_date', to_char(prev_date, 'YYYY-MM-DD'),
        'suspect_value', prev_value,
        'suspect_date', to_char(prev_date, 'YYYY-MM-DD'),
        -- The Python client recomputes round(..., 3) to guarantee exact legacy
        -- float/alert parity; retain the raw ratio here for diagnostics.
        'drop_ratio_raw', ((prev_value - metric_value)::double precision / prev_value::double precision)
      )
      order by post_first_stat_id, measured_at
    ),
    '[]'::jsonb
  ) as events
  from reverse_rows;
$$;

revoke all on function public.monitoring_reverse_events_v1(double precision) from public;
revoke all on function public.monitoring_reverse_events_v1(double precision) from anon;
revoke all on function public.monitoring_reverse_events_v1(double precision) from authenticated;
grant execute on function public.monitoring_reverse_events_v1(double precision) to service_role;

comment on function public.monitoring_reverse_events_v1(double precision) is
  'Single-row JSON bundle of exact reverse-watchdog day-over-day events; service-role only.';
