-- 무상 노출 유형 분류 컬럼 추가
-- 값: '무가시딩' | '오가닉' | null

ALTER TABLE organic_mentions
  ADD COLUMN IF NOT EXISTS exposure_type text;
