-- Align the database TikTok video/photo identity rule with web/lib/url-utils.ts.
-- TikTok /photo/ and /video/ URLs both identify a post by their numeric ID.
--
-- Safety:
--   * lock writers while the projected keys are checked and backfilled;
--   * abort unless the live TikTok /photo/ set exactly matches the reviewed 268-row backup;
--   * abort before any UPDATE if two existing rows would collapse to one key;
--   * keep the existing partial UNIQUE index as the final database guard.

begin;

set local lock_timeout = '15s';

lock table public.sponsored_posts in share row exclusive mode;

create or replace function public.sponsored_post_identity_key(p_url text)
returns text
language plpgsql
immutable
as $$
declare
  u text := btrim(coalesce(p_url, ''));
  m text[];
  host text;
  path text;
  id text;
begin
  if u = '' then
    return null;
  end if;

  if u !~* '^https?://' then
    u := 'https://' || u;
  end if;

  u := regexp_replace(u, '#.*$', '');
  host := lower(coalesce(substring(u from '^https?://([^/?#]+)'), ''));
  host := regexp_replace(host, '^www\.', '');
  path := coalesce(substring(u from '^https?://[^/?#]+([^?#]*)'), '/');

  if host like '%instagram.com' or host like '%instagr.am' then
    m := regexp_match(path, '/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)');
    if m is not null then
      return 'ig:' || m[1];
    end if;
  end if;

  if host like '%tiktok.com' then
    m := regexp_match(path, '/(?:video|photo)/([0-9]+)');
    if m is not null then
      id := ltrim(m[1], '0');
      if id = '' then id := '0'; end if;
      if length(id) < 20 or (length(id) = 20 and id <= '18446744073709551615') then
        return 'tt:' || m[1];
      end if;
      return null;
    end if;
  end if;

  if host = 'youtu.be' or host like '%youtube.com' then
    m := regexp_match(path, '/shorts/([A-Za-z0-9_-]{6,})');
    if m is not null then
      return 'yt:' || m[1];
    end if;

    m := regexp_match(path, '/(?:embed|live|v)/([A-Za-z0-9_-]{6,})');
    if m is not null then
      return 'yt:' || m[1];
    end if;

    if host = 'youtu.be' then
      m := regexp_match(path, '^/([A-Za-z0-9_-]{6,})');
      if m is not null then
        return 'yt:' || m[1];
      end if;
    end if;

    id := substring(u from '[?&]v=([A-Za-z0-9_-]{6,})');
    if id is not null then
      return 'yt:' || id;
    end if;
  end if;

  u := lower(regexp_replace(u, '^https?://www\.', 'https://'));
  u := regexp_replace(u, '[?#].*$', '');
  u := regexp_replace(u, '/+$', '');
  return 'url:' || u || '/';
end;
$$;

do $$
declare
  v_photo_count bigint;
  v_photo_id_hash text;
  v_photo_tuple_hash text;
  v_non_photo_mismatches bigint;
begin
  with photo as (
    select p.id, p.url, p.normalized_key
    from public.sponsored_posts p
    where p.url ~* 'tiktok\.com/[^?#]*/photo/[0-9]+'
  )
  select
    count(*),
    md5(string_agg(id::text, ',' order by id::text)),
    md5(string_agg(
      id::text || '|' || url || '|' || coalesce(normalized_key, ''),
      chr(10) order by id::text
    ))
  into v_photo_count, v_photo_id_hash, v_photo_tuple_hash
  from photo;

  select count(*)
  into v_non_photo_mismatches
  from public.sponsored_posts p
  where p.url !~* 'tiktok\.com/[^?#]*/photo/[0-9]+'
    and p.normalized_key is distinct from public.sponsored_post_identity_key(p.url);

  if v_photo_count <> 268
     or v_photo_id_hash <> '33044ab2ec6a6e3d01228d5dd798cb7f'
     or v_photo_tuple_hash <> '71cf390385addb4838e9dbc1369ea571' then
    raise exception 'TikTok photo backup set changed (count %, id_hash %, tuple_hash %); aborting',
      v_photo_count, v_photo_id_hash, v_photo_tuple_hash;
  end if;

  if v_non_photo_mismatches <> 0 then
    raise exception 'non-photo normalized_key mismatches found (%); aborting broad backfill',
      v_non_photo_mismatches;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.sponsored_posts
    where public.sponsored_post_identity_key(url) is not null
    group by public.sponsored_post_identity_key(url)
    having count(*) > 1
  ) then
    raise exception 'projected sponsored_posts identity keys are not unique; aborting TikTok photo backfill';
  end if;
end;
$$;

update public.sponsored_posts
set normalized_key = public.sponsored_post_identity_key(url)
where normalized_key is distinct from public.sponsored_post_identity_key(url);

do $$
begin
  if exists (
    select 1
    from public.sponsored_posts
    where normalized_key is distinct from public.sponsored_post_identity_key(url)
  ) then
    raise exception 'sponsored_posts normalized_key backfill verification failed';
  end if;
end;
$$;

create unique index if not exists sponsored_posts_normalized_key_uidx
  on public.sponsored_posts (normalized_key)
  where normalized_key is not null;

do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public'
      and tbl.relname = 'sponsored_posts'
      and idx.relname = 'sponsored_posts_normalized_key_uidx'
      and i.indisunique
      and i.indisvalid
      and pg_get_indexdef(i.indexrelid) ilike '%(normalized_key)%'
      and pg_get_indexdef(i.indexrelid) ilike '%where (normalized_key is not null)%'
  ) then
    raise exception 'sponsored_posts_normalized_key_uidx is missing or has an unexpected definition';
  end if;
end;
$$;

create or replace function public.set_sponsored_post_normalized_key()
returns trigger
language plpgsql
as $$
begin
  new.normalized_key := public.sponsored_post_identity_key(new.url);
  return new;
end;
$$;

drop trigger if exists trg_sponsored_posts_normalized_key on public.sponsored_posts;
create trigger trg_sponsored_posts_normalized_key
  before insert or update of url on public.sponsored_posts
  for each row execute function public.set_sponsored_post_normalized_key();

commit;
