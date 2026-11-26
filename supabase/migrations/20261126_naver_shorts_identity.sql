-- 2026-11-26 네이버 숏폼 식별키 (사용자 지시 "응 고쳐")
--
-- 왜: 네이버 숏폼 주소 m.naver.com/shorts/?seedMediaId=<ID>&serviceType=CLIP 는 영상 번호가 쿼리에 있다.
--     기존 함수는 일반 URL의 쿼리를 지우므로 모든 네이버 숏폼이 'url:https://m.naver.com/shorts/' 한 키가 되어
--     두 번째 숏폼부터 같은 글로 합쳐진다(유니크 인덱스 충돌 → 시트 동기화 배치 실패 위험).
--
-- 이 파일은 **함수만** 바꾼다. 기존 행 키는 url 이 바뀔 때(트리거: before insert or update of url)만 다시 계산되므로
-- 지금 들어 있는 1행('https://m.naver.com/shorts/', 쿼리 없음)은 그대로다 → 현재 서버 코드와 완전히 호환.
-- 기존 1행의 url 갱신은 서버 코드(naverShortsMediaId) 배포 직후 별도 1줄 UPDATE 로 한다(인계문 참고).

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

  -- 네이버 숏폼: 영상 ID가 쿼리(?seedMediaId=)에 있다. 아래 일반 규칙은 쿼리를 지워 모든 숏폼이
  -- 'url:https://m.naver.com/shorts/' 한 키로 합쳐지므로 그 전에 nvs:<ID 대문자>로 뽑는다.
  -- web/lib/url-utils.ts naverShortsMediaId 와 같은 규칙.
  if (host = 'naver.com' or host = 'm.naver.com') and path ~* '^/shorts/?$' then
    m := regexp_match(u, '[?&]seedmediaid=([A-Za-z0-9]{8,64})(?:[&#]|$)', 'i');
    if m is not null then
      return 'nvs:' || upper(m[1]);
    end if;
  end if;

  u := lower(regexp_replace(u, '^https?://www\.', 'https://'));
  u := regexp_replace(u, '[?#].*$', '');
  u := regexp_replace(u, '/+$', '');
  return 'url:' || u || '/';
end;
$$;
