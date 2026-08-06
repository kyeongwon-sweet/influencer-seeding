-- organic_mentions.updated_at 추가 (2026-08-06)
--
-- 왜: 오늘 여러 세션이 같은 행을 동시에 편집했는데 **누가 언제 바꿨는지 추적이 불가능**했다.
--     (제품 코드 치환 중 1차/2차 조회 사이에 값이 바뀌어 있었고, 원인 세션을 특정할 수 없었다)
--     이 컬럼이 있으면 최근 편집 순 정렬·동시편집 감지·되돌리기 판단이 가능해진다.
--
-- 안전성: 컬럼 추가 + 트리거만 만든다. 기존 데이터는 손대지 않는다(기본값으로 채워질 뿐).
--         애플리케이션 코드는 이 컬럼을 **쓰지 않아도 동작**한다(트리거가 자동 갱신).
--
-- 실행: Supabase 콘솔 → SQL Editor 에 붙여넣고 Run. 한 번만 실행하면 된다(IF NOT EXISTS로 재실행 안전).

ALTER TABLE organic_mentions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 기존 행은 생성시각으로 초기화(없던 값을 지어내지 않기 위해 created_at을 그대로 쓴다).
UPDATE organic_mentions SET updated_at = created_at WHERE updated_at IS NULL OR updated_at < created_at;

-- 갱신 트리거: 어떤 경로(대시보드·스크립트·자동수집)로 UPDATE해도 자동으로 시각이 남는다.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organic_mentions_set_updated_at ON organic_mentions;
CREATE TRIGGER organic_mentions_set_updated_at
  BEFORE UPDATE ON organic_mentions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 최근 편집 순 조회용(동시편집 감지·감사에 쓴다)
CREATE INDEX IF NOT EXISTS organic_mentions_updated_at_idx ON organic_mentions (updated_at DESC);

-- 확인용:
--   SELECT account_name, updated_at, created_at FROM organic_mentions ORDER BY updated_at DESC LIMIT 10;
