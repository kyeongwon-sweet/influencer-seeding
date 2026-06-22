-- 협찬 모니터링 공유 메모(포스트잇) 테이블
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 1회 실행하세요.
create table if not exists public.memos (
  id         uuid primary key default gen_random_uuid(),
  content    text not null,
  author     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 클라이언트 직접 접근 차단: 메모는 서버 API(/api/memos, service role)로만 읽고 쓴다.
-- RLS on + 정책 없음 → anon/authenticated 키로는 직접 접근 불가, service_role 키는 RLS 우회.
alter table public.memos enable row level security;
