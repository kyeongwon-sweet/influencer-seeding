-- organic_mentions 중복 식별자 교체 — **1단계(안전·추가만)** (2026-09-21)
--
-- 왜 필요한가(실측):
--   인스타 스토리는 영구 링크가 없어 노션·수기 모두 **프로필 주소**(`instagram.com/<계정>/`)로 기록한다.
--   그런데 `organic_mentions.url` 에 단독 UNIQUE(`organic_mentions_url_key`)가 걸려 있어
--   **같은 계정의 서로 다른 날짜 노출을 한 건밖에 저장할 수 없다.**
--   실제로 `운동하는 쩡`(jungyun_diet)의 2023-02-12(파인트)·2023-11-30(초코바) 중 1건만 들어갔고,
--   나머지는 409(23505 duplicate key)로 거부됐다.
--
-- 무엇을 바꾸나:
--   식별자를 `url` 단독 → **`mention_key`** 로 옮긴다.
--     · 게시물 URL(`/p/`·`/reel/`·유튜브·틱톡 등) → `mention_key = url`  (종전과 완전히 동일)
--     · 프로필 URL(인스타 비게시물)              → `mention_key = url || '#uploaded=' || 업로드일자`
--   즉 **게시물의 중복 차단 강도는 그대로 두고**, 프로필 URL만 날짜까지 봐서 구분한다.
--
-- ⚠️ 왜 3단계로 나누나 — 코드와 스키마가 동시에 바뀌면 그 사이에 수집이 깨진다:
--     1단계(이 파일): mention_key 컬럼·트리거·UNIQUE 추가. **url UNIQUE는 그대로 둔다.**
--                     → 이 시점엔 아무 동작도 바뀌지 않는다(기존 업서트 onConflict:'url' 정상).
--     2단계(코드 배포): apify-webhook 업서트를 onConflict:'mention_key' 로 전환.
--     3단계(step3.sql): `organic_mentions_url_key` 제거 → 그때부터 프로필+날짜 중복 허용.
--   순서를 지키지 않으면 ①코드 먼저 → onConflict 대상 없음으로 수집 실패
--                        ②제약 먼저 → onConflict:'url' 실패로 수집 실패.
--
-- ⚠️ 트리거로 채운다(생성 열 GENERATED 아님): `date::text` 캐스트가 DateStyle 의존이라 STABLE 이고,
--    GENERATED ALWAYS 는 IMMUTABLE 식만 허용해 거부된다. 트리거에는 그 제약이 없다.
--
-- 실행: Supabase 콘솔 → SQL Editor 붙여넣고 Run. 재실행 안전(IF NOT EXISTS / CREATE OR REPLACE).

ALTER TABLE organic_mentions
  ADD COLUMN IF NOT EXISTS mention_key text;

-- 프로필 URL 판정은 web/lib/url-utils.ts 의 `isInstagramNonPostUrl` 과 **같은 규칙**이어야 한다.
--   TS:  /instagram\.com/i.test(u) && !/\/(p|reels|reel|tv)\/[A-Za-z0-9_-]+/i.test(u)
-- 한쪽만 바뀌면 앱은 신규로 보는데 DB가 거부하는(또는 그 반대) 어긋남이 생긴다.
CREATE OR REPLACE FUNCTION organic_mentions_mention_key(p_url text, p_uploaded date)
RETURNS text AS $$
  SELECT CASE
    WHEN COALESCE(p_url, '') = '' THEN NULL
    WHEN p_url ~* 'instagram\.com'
     AND p_url !~* '/(p|reels|reel|tv)/[A-Za-z0-9_-]+'
      -- 날짜를 모르면 접미사를 붙이지 않는다 → 종전처럼 URL 하나로 묶인다.
      -- (모르는 채 키를 갈라놓으면 같은 노출이 중복 적재된다. 누락보다 중복이 되돌리기 어렵다.)
      THEN p_url || COALESCE('#uploaded=' || to_char(p_uploaded, 'YYYY-MM-DD'), '')
    ELSE p_url
  END;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION organic_mentions_set_mention_key() RETURNS trigger AS $$
BEGIN
  NEW.mention_key := organic_mentions_mention_key(NEW.url, NEW.uploaded_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_organic_mentions_mention_key ON organic_mentions;
CREATE TRIGGER trg_organic_mentions_mention_key
  BEFORE INSERT OR UPDATE OF url, uploaded_at ON organic_mentions
  FOR EACH ROW EXECUTE FUNCTION organic_mentions_set_mention_key();

-- 기존 행 백필. 값을 지어내지 않는다 — url·uploaded_at 실제값에서만 계산한다.
UPDATE organic_mentions
   SET mention_key = organic_mentions_mention_key(url, uploaded_at)
 WHERE mention_key IS DISTINCT FROM organic_mentions_mention_key(url, uploaded_at);

-- 🔎 적용 전 확인용 — 이 쿼리가 0행이어야 UNIQUE 생성이 성공한다.
--    (0행이 아니면 이미 중복이 있다는 뜻이므로 먼저 사람이 정리할 것)
--    SELECT mention_key, count(*) FROM organic_mentions
--     GROUP BY mention_key HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS organic_mentions_mention_key_uidx
  ON organic_mentions (mention_key);

-- 이 시점에서 url UNIQUE(organic_mentions_url_key)는 **아직 살아 있다**. 3단계에서 제거한다.
