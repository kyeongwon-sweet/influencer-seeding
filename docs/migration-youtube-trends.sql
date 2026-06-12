-- 유튜브 검색 트렌드 저장 테이블
-- Google Trends(gprop=youtube) 상대값(0~100)을 키워드·일자별로 저장.
-- Apify google-trends-scraper로 수집(/api/youtube-trends/collect), 매 수집 시 덮어씀(upsert).

create table if not exists youtube_search_trends (
  measured_at date not null,
  keyword     text not null,
  value       integer,
  primary key (measured_at, keyword)
);
