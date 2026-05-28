-- ================================================
-- 인플루언서 시딩 시스템 Supabase 스키마
-- ================================================

-- 인플루언서 후보 리스트
create table influencers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null unique,
  platform    text not null check (platform in ('instagram', 'youtube')),
  status      text not null default 'pending'
                check (status in ('pending', 'pass', 'hold', 'reject')),
  source      text check (source in ('listup', 'manual')),
  created_at  timestamptz default now()
);

-- 스크리닝 지표 (실행 히스토리)
create table screening_metrics (
  id                        uuid primary key default gen_random_uuid(),
  influencer_id             uuid references influencers(id) on delete cascade,
  run_at                    timestamptz default now(),

  -- 계정
  followers                 bigint,
  avg_views_per_follower    numeric,
  has_1m_view               boolean,

  -- 게시물 수
  total_posts               int,
  general_posts             int,
  ad_posts                  int,

  -- 순조회수
  total_avg_view_count      numeric,
  general_avg_view_count    numeric,
  ad_avg_view_count         numeric,

  -- 재생수
  total_avg_play_count      numeric,
  general_avg_play_count    numeric,
  ad_avg_play_count         numeric,

  -- Like 비율
  total_like_ratio          numeric,
  general_like_ratio        numeric,
  ad_like_ratio             numeric,

  -- Comments 비율
  total_comment_ratio       numeric,
  general_comment_ratio     numeric,
  ad_comment_ratio          numeric,

  -- 광고 최고 게시물
  top_ad_play_count         bigint,
  top_ad_post_url           text,

  -- 기타
  avg_video_duration        numeric
);

-- 리스트업 검색어 히스토리
create table search_keywords (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null,
  platform    text not null check (platform in ('instagram', 'youtube', 'both')),
  created_at  timestamptz default now()
);

-- 비동기 작업 큐
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('listup', 'screening', 'monitoring')),
  status      text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed')),
  payload     jsonb,
  error       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- updated_at 자동 갱신
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger jobs_updated_at
  before update on jobs
  for each row execute function update_updated_at();

-- 협찬 게시물
create table sponsored_posts (
  id              uuid primary key default gen_random_uuid(),
  influencer_id   uuid references influencers(id) on delete cascade,
  url             text not null unique,
  posted_at       date,
  created_at      timestamptz default now()
);

-- 게시물 일별 성과 (daily snapshot)
create table post_daily_stats (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid references sponsored_posts(id) on delete cascade,
  measured_at   date not null,
  play_count    bigint,
  likes_count   bigint,
  comments_count bigint,
  unique (post_id, measured_at)
);

-- ================================================
-- RLS (Row Level Security)
-- ================================================
alter table influencers        enable row level security;
alter table screening_metrics  enable row level security;
alter table search_keywords    enable row level security;
alter table jobs               enable row level security;
alter table sponsored_posts    enable row level security;
alter table post_daily_stats   enable row level security;

-- 인증된 사용자만 모든 데이터 접근 허용 (단일 고객사)
create policy "authenticated users only" on influencers
  for all using (auth.role() = 'authenticated');

create policy "authenticated users only" on screening_metrics
  for all using (auth.role() = 'authenticated');

create policy "authenticated users only" on search_keywords
  for all using (auth.role() = 'authenticated');

create policy "authenticated users only" on jobs
  for all using (auth.role() = 'authenticated');

create policy "authenticated users only" on sponsored_posts
  for all using (auth.role() = 'authenticated');

create policy "authenticated users only" on post_daily_stats
  for all using (auth.role() = 'authenticated');
