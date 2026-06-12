-- influencers: 썸네일 이미지 전용 컬럼 분리
--
-- 배경: sample_post_url 한 필드를 (1)게시물 permalink(리스트업) (2)썸네일 이미지(스크리닝)
--   두 용도로 써서, 스크리닝이 permalink를 이미지로 덮어씀 → 클릭 시 게시물이 아닌 이미지로 이동.
-- 해결: 썸네일은 sample_thumbnail_url 에 저장, sample_post_url 은 게시물 permalink 전용.
-- ⚠️ 코드 배포 후, 다음 리스트업/스크리닝 실행 전에 실행할 것.

ALTER TABLE influencers ADD COLUMN IF NOT EXISTS sample_thumbnail_url text;

-- 기존에 스크리닝이 sample_post_url 에 덮어쓴 이미지 URL → 썸네일 필드로 이동, permalink는 비움
-- (매칭 게시물 permalink는 덮여서 소실됨 → 리스트업 재실행 시 복구. 비우면 링크는 프로필로 폴백.)
UPDATE influencers
SET sample_thumbnail_url = sample_post_url,
    sample_post_url = NULL
WHERE sample_post_url ~* '(cdninstagram|fbcdn|scontent)'
  AND (sample_thumbnail_url IS NULL OR sample_thumbnail_url = '');
