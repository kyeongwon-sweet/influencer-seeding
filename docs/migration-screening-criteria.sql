-- screening_criteria 테이블 (통과 기준 저장 — 단일 행 유지)
create table screening_criteria (
  id                      uuid primary key default gen_random_uuid(),
  updated_at              timestamptz default now(),
  min_followers           bigint,
  min_1m_count            integer,
  min_views_per_follower  numeric,
  min_avg_views           numeric,
  max_ad_ratio            numeric
);

-- 기본 행 삽입 (모든 기준 null = 조건 없음)
insert into screening_criteria default values;

-- RLS
alter table screening_criteria enable row level security;
create policy "authenticated users only" on screening_criteria
  for all using (auth.role() = 'authenticated');

-- screening_metrics에 criteria_snapshot 컬럼 추가
alter table screening_metrics add column criteria_snapshot jsonb;
