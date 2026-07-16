-- Lock sponsored_posts uniqueness to the real post identity, not the literal URL.
-- This prevents /reel/ vs /p/, www vs non-www, and YouTube URL spelling variants
-- from creating separate sponsored_posts rows for the same post.

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
    m := regexp_match(path, '/video/([0-9]+)');
    if m is not null then
      return 'tt:' || m[1];
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

alter table public.sponsored_posts
  add column if not exists normalized_key text;

update public.sponsored_posts
set normalized_key = public.sponsored_post_identity_key(url)
where normalized_key is null
   or normalized_key <> public.sponsored_post_identity_key(url);

-- Known URL spelling correction from the July 2026 audit. Value is unchanged;
-- only the literal URL spelling is normalized so URL-based legacy paths stop
-- missing the existing row before normalized_key is fully adopted everywhere.
update public.sponsored_posts
set url = 'https://www.tiktok.com/@ryuraikj/video/7652295124399000839/',
    normalized_key = public.sponsored_post_identity_key('https://www.tiktok.com/@ryuraikj/video/7652295124399000839/')
where id::text like 'e32284d3%'
  and url <> 'https://www.tiktok.com/@ryuraikj/video/7652295124399000839/';

do $$
begin
  if exists (
    select 1
    from public.sponsored_posts
    where normalized_key is not null
    group by normalized_key
    having count(*) > 1
  ) then
    raise exception 'sponsored_posts.normalized_key has duplicates; resolve duplicates before creating UNIQUE index';
  end if;
end;
$$;

create unique index if not exists sponsored_posts_normalized_key_uidx
  on public.sponsored_posts (normalized_key)
  where normalized_key is not null;

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
