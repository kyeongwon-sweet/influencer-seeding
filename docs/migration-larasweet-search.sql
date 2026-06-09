-- 라라스윗 검색량(절대) 일자별 저장
-- 외부 시트(네이버 데이터랩 상대검색량 × 배율)에서 Apps Script로 푸시 → /api/larasweet-search
create table if not exists larasweet_search_daily (
  measured_at   date primary key,
  search_volume bigint not null,
  updated_at    timestamptz not null default now()
);

alter table larasweet_search_daily enable row level security;

-- 서버 라우트는 Service Role로 접근(RLS 우회). 직접 접근은 인증 사용자만 읽기.
create policy "authenticated read larasweet_search_daily"
  on larasweet_search_daily for select to authenticated using (true);
