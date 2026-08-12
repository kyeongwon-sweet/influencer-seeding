-- 구글 웹 검색 트렌드 저장 테이블
-- Google Trends(gprop 미지정 = 웹 검색) 상대값(0~100)을 키워드·일자별로 저장.
-- Apify google-trends-scraper로 수집(/api/google-trends/collect), 매 수집 시 덮어씀(upsert).
-- youtube_search_trends 와 동일 스키마(유튜브 검색 vs 웹 검색 = 별도 테이블로 분리 저장).

create table if not exists google_search_trends (
  measured_at date not null,
  keyword     text not null,
  value       integer,
  primary key (measured_at, keyword)
);
