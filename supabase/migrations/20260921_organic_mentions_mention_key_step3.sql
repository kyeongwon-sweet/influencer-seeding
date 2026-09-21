-- organic_mentions 중복 식별자 교체 — **3단계(마지막)** (2026-09-21)
--
-- ⚠️ 순서 엄수. 이 파일은 **1단계 SQL 적용 + 2단계 코드 배포가 모두 끝난 뒤**에만 실행한다.
--    먼저 실행하면 `apify-webhook` 의 업서트(onConflict:'url')가 대상 제약을 잃어 수집이 실패한다.
--
-- 실행 전 확인(둘 다 참이어야 함):
--   ① 1단계 적용됨:
--      SELECT to_regclass('organic_mentions_mention_key_uidx');           -- NULL 이 아니어야 함
--   ② 2단계 배포됨 — 코드에 onConflict:'url' 이 남아 있지 않아야 함:
--      repo 에서 `grep -rn "onConflict: 'url'" web/app/api/apify-webhook/route.ts` 가 0건
--
-- 무엇이 바뀌나:
--   `url` 단독 UNIQUE 를 제거한다. 그때부터 **프로필 URL + 서로 다른 업로드일자**가 각각 저장된다.
--   게시물 URL 은 mention_key = url 이라 UNIQUE 강도가 종전과 동일하게 유지된다(중복 유입 없음).
--
-- 되돌리기:
--   ALTER TABLE organic_mentions ADD CONSTRAINT organic_mentions_url_key UNIQUE (url);
--   ⚠️ 단, 그 사이에 같은 프로필 URL 이 2행 이상 쌓였다면 먼저 사람이 정리해야 복원된다.

ALTER TABLE organic_mentions
  DROP CONSTRAINT IF EXISTS organic_mentions_url_key;

-- 확인: 게시물 URL 의 중복 차단이 그대로인지(mention_key = url 이므로 동일해야 함)
--   SELECT url, count(*) FROM organic_mentions
--    WHERE url !~* 'instagram\.com' OR url ~* '/(p|reels|reel|tv)/[A-Za-z0-9_-]+'
--    GROUP BY url HAVING count(*) > 1;   -- 0행이어야 정상
