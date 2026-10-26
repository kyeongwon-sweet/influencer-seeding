-- AI monitoring dashboard: bounded history support.
--
-- The browser only needs recent raw rows.  Values that require older history are reduced to
-- one summary row per post inside Postgres so the REST response no longer transfers the whole
-- post_daily_stats table.  p_before is supplied by the app as the KST "today" boundary; never
-- derive the business date from the database session timezone.

create index if not exists post_daily_stats_measured_id_idx
  on public.post_daily_stats (measured_at, id);
create index if not exists post_daily_stats_post_measured_id_idx
  on public.post_daily_stats (post_id, measured_at, id);

create or replace function public.monitoring_dashboard_stat_summaries_v1(
  p_from date,
  p_before date,
  p_created_before timestamptz
)
returns table (
  id uuid,
  post_id uuid,
  latest_stats jsonb,
  prev_stats jsonb,
  prior_play_seed bigint,
  prior_reach_seed bigint,
  prior_ig_max bigint,
  prior_reach_max bigint,
  prior_fb_max bigint,
  prior_likes_seed bigint,
  prior_comments_seed bigint,
  prior_display_measured_at date,
  prior_display_likes bigint,
  prior_display_comments bigint,
  prior_display_increment bigint,
  day7_play_count bigint
)
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
      s.play_count,
      s.likes_count,
      s.comments_count,
      s.created_at,
      s.reach_count,
      s.manual,
      s.fb_play_count,
      p.posted_at::date as posted_at,
      p.channel_type,
      count(*) filter (where s.manual is true and s.play_count > 0) over (
        partition by s.post_id order by s.measured_at, s.id
        rows between unbounded preceding and current row
      ) as reset_group,
      max(s.fb_play_count) over (
        partition by s.post_id order by s.measured_at, s.id
        rows between unbounded preceding and current row
      ) as carried_fb
    from public.post_daily_stats s
    join public.sponsored_posts p on p.id = s.post_id
    where p_from < p_before
      and s.measured_at < p_before
      and s.created_at <= p_created_before
      and p.product_name is not null
      and p.product_name <> ''
      and (p.posted_at is null or s.measured_at >= p.posted_at::date)
  ),
  monotonic as (
    select
      r.*,
      coalesce(
        max(r.play_count) over (
          partition by r.post_id, r.reset_group order by r.measured_at, r.id
          rows between unbounded preceding and current row
        ),
        0
      )::bigint as mono_play
    from source_rows r
  ),
  metrics as (
    select
      m.*,
      case when m.fb_play_count > 0 then m.fb_play_count else m.carried_fb end::bigint as effective_fb,
      greatest(0, m.mono_play - coalesce(
        case when m.fb_play_count > 0 then m.fb_play_count else m.carried_fb end,
        0
      ))::bigint as ig_value,
      case
        when m.reach_count is not null then m.reach_count
        when m.play_count is not null then m.mono_play
        else null
      end::bigint as banner_value,
      (
        coalesce(m.channel_type, '') like '%배너%'
        or lower(coalesce(m.channel_type, '')) like '%banner%'
        or (coalesce(m.channel_type, '') like '%매거진%' and m.posted_at >= date '2026-08-18')
      ) as is_banner
    from monotonic m
  ),
  with_history as (
    select
      m.*,
      max(m.ig_value) filter (where m.ig_value > 0) over (
        partition by m.post_id order by m.measured_at, m.id
        rows between unbounded preceding and 1 preceding
      )::bigint as prior_ig_before,
      max(m.banner_value) filter (where m.banner_value > 0) over (
        partition by m.post_id order by m.measured_at, m.id
        rows between unbounded preceding and 1 preceding
      )::bigint as prior_reach_before,
      max(m.effective_fb) filter (where m.effective_fb > 0) over (
        partition by m.post_id order by m.measured_at, m.id
        rows between unbounded preceding and 1 preceding
      )::bigint as prior_fb_before
    from metrics m
  ),
  ranked as (
    select
      m.*,
      row_number() over (partition by m.post_id order by m.measured_at desc, m.id desc) as latest_rank
    from with_history m
  ),
  latest as (
    select * from ranked where latest_rank = 1
  ),
  previous_day as (
    -- Existing UI semantics after stats_v2 decode: previous value means exactly the
    -- calendar day before latest. mono rows without a raw play still carry maxPlay.
    select distinct on (m.post_id) m.*
    from with_history m
    join latest l
      on l.post_id = m.post_id
     and m.measured_at = l.measured_at - 1
    order by m.post_id, m.id asc
  ),
  prior_latest as (
    -- 컷오프 직전의 현재 state. 과거 최대값과 합치면 positive manual 하향
    -- 정정을 최근 구간 첫 행에서 되돌리게 되므로 별도 seed로 유지한다.
    select distinct on (m.post_id)
      m.*,
      m.mono_play::bigint as prior_play_seed
    from with_history m
    where m.measured_at < p_from
    order by m.post_id, m.measured_at desc, m.id desc
  ),
  prior_likes_latest as (
    select distinct on (m.post_id) m.post_id, m.likes_count::bigint as prior_likes_seed
    from with_history m
    where m.measured_at < p_from and m.likes_count is not null
    order by m.post_id, m.measured_at desc, m.id desc
  ),
  prior_comments_latest as (
    select distinct on (m.post_id) m.post_id, m.comments_count::bigint as prior_comments_seed
    from with_history m
    where m.measured_at < p_from and m.comments_count is not null
    order by m.post_id, m.measured_at desc, m.id desc
  ),
  prior_reach_latest as (
    -- 배너 current state도 safeIncrement용 historical maximum과 분리한다.
    select distinct on (m.post_id)
      m.*,
      m.banner_value::bigint as prior_reach_seed
    from with_history m
    where m.measured_at < p_from
      and m.banner_value > 0
    order by m.post_id, m.measured_at desc, m.id desc
  ),
  prior as (
    select
      m.post_id,
      max(greatest(0, m.mono_play - coalesce(
        case when m.fb_play_count > 0 then m.fb_play_count else m.carried_fb end,
        0
      ))) filter (
        where m.measured_at < p_from and m.mono_play > 0
      )::bigint as prior_ig_max,
      max(
        case
          when m.reach_count is not null then m.reach_count
          when m.play_count is not null then m.mono_play
          else null
        end
      ) filter (where m.measured_at < p_from)::bigint as prior_reach_max,
      max(m.carried_fb) filter (where m.measured_at < p_from)::bigint as prior_fb_max
    from with_history m
    group by m.post_id
  ),
  day7_candidates as (
    select
      m.post_id,
      m.mono_play,
      row_number() over (
        partition by m.post_id
        order by abs(m.measured_at - (m.posted_at + 7)), m.measured_at, m.id
      ) as day7_rank
    from with_history m
    where m.posted_at is not null
      and abs(m.measured_at - (m.posted_at + 7)) <= 2
  ),
  day7 as (
    select post_id, mono_play::bigint as day7_play_count
    from day7_candidates
    where day7_rank = 1
  )
  select
    p.id as id,
    p.id as post_id,
    case when l.post_id is null then null else jsonb_build_object(
      'post_id', l.post_id,
      'measured_at', l.measured_at,
      'play_count', l.mono_play,
      'likes_count', l.likes_count,
      'comments_count', l.comments_count,
      'created_at', l.created_at,
      'reach_count', l.reach_count,
      'manual', l.manual,
      'fb_play_count', l.fb_play_count,
      'play_collected', l.play_count is not null
    ) end as latest_stats,
    case when pd.post_id is null then null else jsonb_build_object(
      'post_id', pd.post_id,
      'measured_at', pd.measured_at,
      'play_count', pd.mono_play,
      'likes_count', pd.likes_count,
      'comments_count', pd.comments_count,
      'created_at', pd.created_at,
      'reach_count', pd.reach_count,
      'manual', pd.manual,
      'fb_play_count', pd.fb_play_count,
      'play_collected', pd.play_count is not null
    ) end as prev_stats,
    pl.prior_play_seed,
    prl.prior_reach_seed,
    pr.prior_ig_max,
    pr.prior_reach_max,
    pr.prior_fb_max,
    pll.prior_likes_seed,
    pcl.prior_comments_seed,
    case when (
      coalesce(p.channel_type, '') like '%배너%'
      or lower(coalesce(p.channel_type, '')) like '%banner%'
      or (coalesce(p.channel_type, '') like '%매거진%' and p.posted_at::date >= date '2026-08-18')
    ) then prl.measured_at else pl.measured_at end::date as prior_display_measured_at,
    case when (
      coalesce(p.channel_type, '') like '%배너%'
      or lower(coalesce(p.channel_type, '')) like '%banner%'
      or (coalesce(p.channel_type, '') like '%매거진%' and p.posted_at::date >= date '2026-08-18')
    ) then prl.likes_count else pl.likes_count end::bigint as prior_display_likes,
    case when (
      coalesce(p.channel_type, '') like '%배너%'
      or lower(coalesce(p.channel_type, '')) like '%banner%'
      or (coalesce(p.channel_type, '') like '%매거진%' and p.posted_at::date >= date '2026-08-18')
    ) then prl.comments_count else pl.comments_count end::bigint as prior_display_comments,
    case
      when (
        coalesce(p.channel_type, '') like '%배너%'
        or lower(coalesce(p.channel_type, '')) like '%banner%'
        or (coalesce(p.channel_type, '') like '%매거진%' and p.posted_at::date >= date '2026-08-18')
      ) then case
        when prl.banner_value is null or prl.banner_value <= 0 then null
        when prl.prior_reach_before is null
          and prl.posted_at is not null
          and prl.measured_at - prl.posted_at > 7 then null
        when prl.prior_reach_before is null then prl.banner_value
        else greatest(0, prl.banner_value - prl.prior_reach_before)
      end
      else case
        when pl.ig_value is null or pl.ig_value <= 0 then null
        when pl.prior_ig_before is null
          and pl.posted_at is not null
          and pl.measured_at - pl.posted_at > 7 then null
        else
          (case
            when pl.prior_ig_before is null then pl.ig_value
            else greatest(0, pl.ig_value - pl.prior_ig_before)
          end)
          + (case
            when pl.effective_fb is null or pl.effective_fb <= 0 then 0
            when pl.prior_fb_before is null then pl.effective_fb
            else greatest(0, pl.effective_fb - pl.prior_fb_before)
          end)
      end
    end::bigint as prior_display_increment,
    d.day7_play_count
  from public.sponsored_posts p
  left join latest l on l.post_id = p.id
  left join previous_day pd on pd.post_id = p.id
  left join prior_latest pl on pl.post_id = p.id
  left join prior_likes_latest pll on pll.post_id = p.id
  left join prior_comments_latest pcl on pcl.post_id = p.id
  left join prior_reach_latest prl on prl.post_id = p.id
  left join prior pr on pr.post_id = p.id
  left join day7 d on d.post_id = p.id
  where p_from < p_before
    and p.product_name is not null
    and p.product_name <> ''
  order by p.id;
$$;

revoke all on function public.monitoring_dashboard_stat_summaries_v1(date, date, timestamptz) from public;
revoke all on function public.monitoring_dashboard_stat_summaries_v1(date, date, timestamptz) from anon;
revoke all on function public.monitoring_dashboard_stat_summaries_v1(date, date, timestamptz) from authenticated;
grant execute on function public.monitoring_dashboard_stat_summaries_v1(date, date, timestamptz) to service_role;

comment on function public.monitoring_dashboard_stat_summaries_v1(date, date, timestamptz) is
  'One-row-per-post monitoring summary for bounded dashboard history. Dates are explicit KST business-date boundaries.';
