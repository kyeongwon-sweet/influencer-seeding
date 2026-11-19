-- One-row service-role bundle for the Apps Script DB -> Sheet export.
--
-- The legacy route pages sponsored_posts and post_daily_stats 1,000 rows at a
-- time (about 166 REST calls at the 2026-11-19 volume). This function preserves
-- the exact metric/provenance policy but performs the grouping inside Postgres
-- and returns one compact JSON row. The API remains in legacy/shadow mode until
-- three distinct KST shadow days compare equal.

-- This helper intentionally belongs to this RPC contract instead of reusing
-- sponsored_post_identity_key(). The older DB helper lower-cases generic URL
-- paths and does not collapse duplicate slashes, while the live TypeScript
-- postIdentityKey() preserves path case and normalizes duplicate slashes.
create or replace function public.stats_for_sheet_identity_key_v1(p_url text)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  raw_url text := coalesce(p_url, '');
  parsed_url text;
  authority text;
  host text;
  path text;
  query_text text;
  matched text[];
  post_id text;
  normalized_id text;
begin
  if raw_url = '' then
    return null;
  end if;

  -- TypeScript prefixes https:// unless the raw value starts with lowercase
  -- "http". A malformed value still returns null and the caller uses trim(url).
  parsed_url := case when left(raw_url, 4) = 'http' then raw_url else 'https://' || raw_url end;
  authority := substring(parsed_url from '^https?://([^/?#]+)');
  if authority is null or authority = '' then
    return null;
  end if;
  authority := regexp_replace(authority, '^.*@', '');
  host := lower(split_part(authority, ':', 1));
  if host = '' or host ~ '[[:space:]]' then
    return null;
  end if;
  host := regexp_replace(host, '^www\.', '');
  path := coalesce(substring(parsed_url from '^https?://[^/?#]+([^?#]*)'), '');
  if path = '' then path := '/'; end if;
  query_text := coalesce(substring(parsed_url from '\?([^#]*)'), '');

  if position('instagram.com' in host) > 0 or position('instagr.am' in host) > 0 then
    matched := regexp_match(path, '/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)');
    if matched is not null then
      return 'ig:' || matched[1];
    end if;
  end if;

  if position('tiktok.com' in host) > 0 then
    matched := regexp_match(path, '/(?:video|photo)/([0-9]+)');
    if matched is not null then
      normalized_id := ltrim(matched[1], '0');
      if normalized_id = '' then normalized_id := '0'; end if;
      if length(normalized_id) < 20
         or (length(normalized_id) = 20 and normalized_id <= '18446744073709551615') then
        return 'tt:' || matched[1];
      end if;
      return null;
    end if;
  end if;

  if host = 'youtu.be' or host like '%youtube.com' then
    matched := regexp_match(path, '/shorts/([A-Za-z0-9_-]{6,})');
    if matched is not null then
      return 'yt:' || matched[1];
    end if;

    matched := regexp_match(path, '/(?:embed|live|v)/([A-Za-z0-9_-]{6,})');
    if matched is not null then
      return 'yt:' || matched[1];
    end if;

    if host = 'youtu.be' then
      matched := regexp_match(path, '^/([A-Za-z0-9_-]{6,})');
      if matched is not null then
        return 'yt:' || matched[1];
      end if;
    elsif regexp_replace(path, '/$', '') = '/watch' then
      matched := regexp_match(query_text, '(^|&)v=([A-Za-z0-9_-]{6,})(&|$)');
      if matched is not null then
        post_id := matched[2];
        return 'yt:' || post_id;
      end if;
    end if;
  end if;

  path := regexp_replace(path, '/{2,}', '/', 'g');
  if right(path, 1) <> '/' then path := path || '/'; end if;
  if host = 'tiktok.com' then
    return 'url:https://www.tiktok.com' || path;
  end if;
  return 'url:https://' || host || path;
end;
$$;

revoke all on function public.stats_for_sheet_identity_key_v1(text) from public;
revoke all on function public.stats_for_sheet_identity_key_v1(text) from anon;
revoke all on function public.stats_for_sheet_identity_key_v1(text) from authenticated;
grant execute on function public.stats_for_sheet_identity_key_v1(text) to service_role;

-- stats_for_sheet_identity_contract_begin
do $$
declare
  fixture record;
  actual text;
begin
  for fixture in
    select * from (values
      ('https://naver.me/GzdNQMv2', 'url:https://naver.me/GzdNQMv2/'),
      ('http://example.com/A//B?utm_source=x#frag', 'url:https://example.com/A/B/'),
      ('instagram.com/reel/Ab_C-1/?x=1', 'ig:Ab_C-1'),
      ('https://www.instagram.com/Foo.Bar/?hl=ko', 'url:https://instagram.com/Foo.Bar/'),
      ('https://www.youtube.com/watch?v=Abc_12-xyz&list=PL1', 'yt:Abc_12-xyz'),
      ('https://www.youtube.com/shorts/Abc_12-xyz/?si=1', 'yt:Abc_12-xyz'),
      ('https://youtu.be/Abc_12-xyz?t=1', 'yt:Abc_12-xyz'),
      ('https://www.tiktok.com/@acct/photo/7696140243162074388/?x=1', 'tt:7696140243162074388'),
      ('https://www.tiktok.com/@Foo/', 'url:https://www.tiktok.com/@Foo/'),
      ('https://www.tiktok.com/@acct/video/18446744073709551616/', null::text)
    ) as contract(input_url, expected_key)
  loop
    actual := public.stats_for_sheet_identity_key_v1(fixture.input_url);
    if actual is distinct from fixture.expected_key then
      raise exception 'stats_for_sheet_identity_key_v1 contract mismatch';
    end if;
  end loop;
end;
$$;
-- stats_for_sheet_identity_contract_end

create or replace function public.stats_for_sheet_bundle_v1()
returns table (bundle jsonb, source_posts bigint, source_stats bigint, contract_version integer)
language sql
stable
security invoker
set search_path = public
as $$
  with post_rows as materialized (
    select
      p.id,
      p.url,
      coalesce(
        public.stats_for_sheet_identity_key_v1(p.url),
        btrim(p.url)
      ) as post_key,
      p.posted_at::date as posted_at,
      p.ended_at::date as ended_at,
      (
        position('배너' in coalesce(p.channel_type, '')) > 0
        or position('banner' in lower(coalesce(p.channel_type, ''))) > 0
        or (
          position('매거진' in coalesce(p.channel_type, '')) > 0
          and p.posted_at::date >= date '2026-08-18'
        )
      ) as is_banner,
      lower(p.url) ~ '(youtube\.com|youtu\.be)' as is_youtube
    from public.sponsored_posts p
    where p.url is not null
      and p.url <> ''
  ),
  key_info as materialized (
    select
      post_key,
      (array_agg(url order by id))[1] as url,
      bool_or(ended_at is null) as is_active,
      max(ended_at) as ended_at
    from post_rows
    group by post_key
  ),
  raw_stats as materialized (
    select
      p.post_key,
      p.posted_at,
      p.is_youtube,
      s.measured_at::date as measured_at,
      case when p.is_banner then s.reach_count else s.play_count end::bigint as metric,
      coalesce(s.manual, false) as manual,
      s.created_at
    from post_rows p
    join public.post_daily_stats s on s.post_id = p.id
  ),
  eligible_stats as materialized (
    select
      post_key,
      measured_at,
      metric,
      manual,
      (
        metric = 0
        and is_youtube
        and (manual or created_at >= timestamptz '2026-10-12T00:55:00Z')
      ) as zero_confirmed
    from raw_stats
    where not (posted_at is not null and measured_at < posted_at)
      and metric is not null
      and metric >= 0
      and (
        metric <> 0
        or (
          is_youtube
          and (manual or created_at >= timestamptz '2026-10-12T00:55:00Z')
        )
      )
  ),
  stats_by_date as materialized (
    select
      post_key,
      measured_at,
      max(metric) as metric,
      bool_or(manual) as manual,
      bool_or(zero_confirmed) as zero_confirmed
    from eligible_stats
    group by post_key, measured_at
  ),
  stats_by_key as materialized (
    select
      post_key,
      jsonb_agg(
        jsonb_build_array(measured_at::text, metric, manual, zero_confirmed)
        order by measured_at
      ) as stats
    from stats_by_date
    group by post_key
  ),
  export_posts as (
    select
      k.post_key,
      jsonb_build_object(
        'url', k.url,
        'key', k.post_key,
        'ended_at', case when k.is_active then null else k.ended_at::text end,
        'stats', s.stats
      ) as post
    from stats_by_key s
    join key_info k on k.post_key = s.post_key

    union all

    select
      k.post_key,
      jsonb_build_object(
        'url', k.url,
        'key', k.post_key,
        'ended_at', k.ended_at::text,
        'stats', '[]'::jsonb
      ) as post
    from key_info k
    left join stats_by_key s on s.post_key = k.post_key
    where not k.is_active
      and s.post_key is null
  ),
  post_bundle as (
    select coalesce(jsonb_agg(post order by post_key), '[]'::jsonb) as posts
    from export_posts
  ),
  diagnostics as (
    select
      count(*) filter (
        where posted_at is not null and measured_at < posted_at
      )::bigint as pre_posted_dropped
    from raw_stats
  ),
  ended_without as (
    select count(*)::bigint as ended_without_stats
    from key_info k
    left join stats_by_key s on s.post_key = k.post_key
    where not k.is_active
      and s.post_key is null
  ),
  source_counts as (
    select
      (select count(*)::bigint from public.sponsored_posts) as source_posts,
      (select count(*)::bigint from public.post_daily_stats) as source_stats
  )
  select
    jsonb_build_object(
      'posts', p.posts,
      'pre_posted_dropped', d.pre_posted_dropped,
      'ended_without_stats', e.ended_without_stats
    ) as bundle,
    c.source_posts,
    c.source_stats,
    1 as contract_version
  from post_bundle p
  cross join diagnostics d
  cross join ended_without e
  cross join source_counts c;
$$;

revoke all on function public.stats_for_sheet_bundle_v1() from public;
revoke all on function public.stats_for_sheet_bundle_v1() from anon;
revoke all on function public.stats_for_sheet_bundle_v1() from authenticated;
grant execute on function public.stats_for_sheet_bundle_v1() to service_role;

comment on function public.stats_for_sheet_bundle_v1() is
  'Single-row exact DB-to-Sheet metric bundle; service-role only and shadow-gated by the API.';

-- Shadow runs execute the legacy paginator and the optimized bundle in separate
-- transactions. If any database write occurs between them, a mismatch may be a
-- moving-snapshot artifact rather than a semantic difference. WAL position is
-- a conservative, data-free watermark: changed means "inconclusive", while an
-- unchanged position means both reads observed a write-quiet interval.
create or replace function public.stats_for_sheet_watermark_v1()
returns table (watermark text)
language sql
volatile
security invoker
set search_path = public
as $$
  select pg_current_wal_lsn()::text as watermark;
$$;

revoke all on function public.stats_for_sheet_watermark_v1() from public;
revoke all on function public.stats_for_sheet_watermark_v1() from anon;
revoke all on function public.stats_for_sheet_watermark_v1() from authenticated;
grant execute on function public.stats_for_sheet_watermark_v1() to service_role;

comment on function public.stats_for_sheet_watermark_v1() is
  'Data-free WAL watermark used to reject moving-snapshot shadow comparisons; service-role only.';
