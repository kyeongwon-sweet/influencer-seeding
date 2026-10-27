-- 광고 플랫폼(1차: Google Ads/YouTube) 광고그룹×일 성과 — 2026-10-27, 바치케(P바치) 유튜브 직접 연동.
-- 시트(파인트 인지광고 대시보드) 수기값과 병행 비교하다가, 검증 뒤에만 정본으로 바꾼다. 수기값을 덮어쓰지 않는다.
-- 날짜 = Google Ads segments.date(계정 시간대). 계정 815-143-8670 시간대는 Asia/Seoul(수집기가 매번 확인, 다르면 저장 안 함).
-- 행이 없는 날 = 그날 노출 없음. 단 '그날을 조회했다'는 사실은 ops_daily_runs(service='google_ads_sync')에 남겨
-- 조회 실패(빈 값)와 확정 0을 구분한다.
-- SQL Editor에서 1회 실행(추가만·재실행 안전).

create table if not exists public.ad_platform_daily (
  platform      text        not null,              -- 'google_ads'
  account_id    text        not null,              -- 하이픈 없는 고객 ID
  campaign_id   text        not null,
  campaign_name text,
  channel_type  text,                              -- campaign.advertising_channel_type (VIDEO 등)
  ad_group_id   text        not null,
  ad_group_name text,
  date          date        not null,
  cost_krw      numeric     not null default 0,    -- cost_micros / 1e6 (계정 통화 KRW)
  impressions   bigint      not null default 0,
  views         bigint,                            -- TrueView 조회수(광고 조회수, 영상 공개 조회수 아님). null = 지표 미제공
  product       text,                              -- 이름 규칙으로 판정한 제품('P바치'), 판정 안 되면 null
  fetched_at    timestamptz not null default now(),
  primary key (platform, ad_group_id, date)
);

create index if not exists ad_platform_daily_product_date on public.ad_platform_daily (product, date);

alter table public.ad_platform_daily enable row level security;
