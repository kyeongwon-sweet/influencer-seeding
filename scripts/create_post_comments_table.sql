-- 협찬 게시물 댓글 감시(부정 댓글 슬랙 알림) 테이블 2종
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 1회 실행하세요.

-- 수집한 댓글 원문 + 분류 결과. (post_id, comment_id) 유니크로 중복 알림 방지.
create table if not exists public.post_comments (
  id             bigserial primary key,
  post_id        uuid not null references public.sponsored_posts(id) on delete cascade,
  platform       text,                -- instagram | youtube | tiktok
  comment_id     text not null,       -- 플랫폼측 댓글 ID
  author         text,
  text           text,
  commented_at   timestamptz,         -- 댓글 작성시각(플랫폼 제공값, 없으면 null)
  classification text,                -- negative | issue | normal
  reason         text,                -- 분류 근거(LLM 요약 또는 매칭 키워드)
  alerted_at     timestamptz,         -- 슬랙 알림 발송 시각(정상댓글은 null)
  created_at     timestamptz not null default now(),
  unique (post_id, comment_id)
);

-- 게시물별 댓글 확인 상태: 마지막으로 스크레이프했을 때의 댓글 수.
-- 일일 수집(post_daily_stats.comments_count)과 비교해 '늘어난 게시물만' 댓글을 긁는다(Apify 비용 절감).
create table if not exists public.post_comment_checks (
  post_id         uuid primary key references public.sponsored_posts(id) on delete cascade,
  last_count      integer,
  last_checked_at timestamptz
);

-- 클라이언트 직접 접근 차단: 서버(service role, GitHub Actions 스크립트)로만 읽고 쓴다.
alter table public.post_comments enable row level security;
alter table public.post_comment_checks enable row level security;
