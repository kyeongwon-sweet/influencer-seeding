-- screening_metrics에 게시물 유형별 지표 컬럼 추가
-- 인스타그램: reels / feed, 유튜브: longform / shorts
alter table screening_metrics
  add column type_metrics jsonb;
