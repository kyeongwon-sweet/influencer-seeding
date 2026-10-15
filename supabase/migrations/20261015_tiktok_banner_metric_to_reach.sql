-- Canonical metric policy: every banner is reported from reach_count.
-- TikTok exposes the public cumulative number as playCount, but banner rows
-- must store that collected number in reach_count (never play_count).

begin;

set local lock_timeout = '15s';

lock table public.sponsored_posts in share mode;
lock table public.post_daily_stats in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.post_daily_stats s
    join public.sponsored_posts p on p.id = s.post_id
    where p.url ilike '%tiktok.com/%'
      and (
        p.channel_type ilike '%배너%'
        or p.channel_type ilike '%banner%'
        or (
          p.channel_type ilike '%매거진%'
          and left(coalesce(p.posted_at::text, ''), 10) >= '2026-08-18'
        )
      )
      and s.play_count is not null
      and s.reach_count is not null
  ) then
    raise exception 'TikTok banner stats contain both play_count and reach_count; manual review required';
  end if;
end;
$$;

update public.post_daily_stats s
set reach_count = s.play_count,
    play_count = null
from public.sponsored_posts p
where p.id = s.post_id
  and p.url ilike '%tiktok.com/%'
  and (
    p.channel_type ilike '%배너%'
    or p.channel_type ilike '%banner%'
    or (
      p.channel_type ilike '%매거진%'
      and left(coalesce(p.posted_at::text, ''), 10) >= '2026-08-18'
    )
  )
  and s.play_count is not null;

do $$
begin
  if exists (
    select 1
    from public.post_daily_stats s
    join public.sponsored_posts p on p.id = s.post_id
    where p.url ilike '%tiktok.com/%'
      and (
        p.channel_type ilike '%배너%'
        or p.channel_type ilike '%banner%'
        or (
          p.channel_type ilike '%매거진%'
          and left(coalesce(p.posted_at::text, ''), 10) >= '2026-08-18'
        )
      )
      and s.play_count is not null
  ) then
    raise exception 'TikTok banner metric migration verification failed';
  end if;
end;
$$;

commit;
