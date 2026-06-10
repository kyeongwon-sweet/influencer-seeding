-- brand_daily_metrics: ig_reach(인스타 도달) 컬럼 제거
--
-- 도달 라인을 그래프·코드에서 모두 제거(프로필 방문만 사용)함에 따라 컬럼도 삭제.
-- ⚠️ 코드(collect insert / brand-metrics select / 페이지 타입)에서 ig_reach 참조를 모두 없앤
--    배포가 끝난 뒤 실행할 것 (배포 전 실행하면 구버전 select가 일시적으로 에러).

ALTER TABLE brand_daily_metrics DROP COLUMN IF EXISTS ig_reach;
