-- IG↔Facebook 교차게시 조회수 합산 (2026-09-22)
--
-- 왜 필요한가(실측):
--   인스타 앱이 보여주는 조회수는 **IG + Facebook 교차게시 합계**인데, 우리 수집기는 IG 전용값만 저장한다.
--   그래서 팀이 앱에서 보는 값과 대시보드 값이 달라진다.
--     예) 퐁패밀리 https://www.instagram.com/p/DdeIMT0ynk2/
--         대시보드 414,066 (IG) vs 실제 1,125,552 (IG 414,066 + FB 711,486)
--   IG 게시물 3,675건 전수조사 결과 교차게시는 **148건**(활성 15 · 종료 133), 숨어있던 FB 조회수 합 1,587,351.
--   상위 4건(퐁패밀리·자연님·얌야미·츄베릅)이 전체의 93%이고, 120건은 FB 1,000 미만이다.
--
-- 무엇을 바꾸나:
--   ① sponsored_posts.is_cross_posted  — FB 에도 교차게시됐는지(scripts/detect_cross_posts.py 가 갱신)
--   ② post_daily_stats.fb_play_count   — 그날 측정한 **Facebook 쪽 조회수**
--
--   교차게시로 표시된 글은 오늘부터 `play_count` 에 **IG+FB 합계**가 들어간다(사용자 지시: "합계로 변경").
--   그래야 대시보드·정렬·CPV·시트 역채움이 전부 인스타 앱과 같은 값을 쓴다 — 표시 경로를 20곳 고치지 않아도 된다.
--   `fb_play_count` 는 그 합계 중 FB 몫이 얼마인지 남겨두는 내역이다(증분 계산과 검증에 쓴다).
--   교차게시가 아닌 글은 지금까지와 완전히 동일하다(fb_play_count = NULL, play_count = IG 전용).
--
-- ⚠️ 과거는 채우지 않는다(값을 지어내지 않는다).
--    지금 알 수 있는 건 '오늘 시점의 FB 누적'뿐이고 **날짜별 FB 증분은 복구할 방법이 없다.**
--    과거 일자에 임의 배분하면 그날 성과를 조작하는 것이다. 그래서 fb_play_count 는 오늘부터만 쌓인다.
--
-- ⚠️ 그래서 첫 측정일에 play_count 가 크게 뛴다(퐁패밀리 414,066 → 1,125,552).
--    이 점프가 그대로 '하루 증분 71만'으로 찍히면 리포트·그래프가 망가진다. 그래서 증분 계산
--    (web/app/monitoring/lib.ts safeIncrement)은 fb_play_count 를 빼고 IG 계열로 델타를 잡고,
--    FB 는 **직전 FB 측정이 있을 때만** 그 차이를 더한다(첫 FB 측정 = 증분 기여 0).
--    → 교차게시 글은 의도적으로 **Σ증분 < 최종 누적**이 된다. 없는 과거를 만들지 않기 위한 대가다.
--
-- 되돌리기:
--   ALTER TABLE post_daily_stats DROP COLUMN fb_play_count;
--   ALTER TABLE sponsored_posts  DROP COLUMN is_cross_posted;
--   (play_count 에 이미 합계가 들어간 날짜 행은 되돌려지지 않는다 — 필요하면 fb_play_count 를
--    빼서 복원해야 하므로, 열을 지우기 전에 그 값을 먼저 옮길 것.)
--
-- 실행: Supabase 콘솔 → SQL Editor 붙여넣고 Run. 재실행 안전(IF NOT EXISTS).

ALTER TABLE sponsored_posts
  ADD COLUMN IF NOT EXISTS is_cross_posted boolean;

COMMENT ON COLUMN sponsored_posts.is_cross_posted IS
  'Facebook 교차게시 여부. true 인 글만 일일 수집에서 data-slayer 로 FB 조회수를 추가 조회하고 '
  'play_count 에 IG+FB 합계를 저장한다. scripts/detect_cross_posts.py 가 갱신. NULL = 아직 판정 안 함.';

ALTER TABLE post_daily_stats
  ADD COLUMN IF NOT EXISTS fb_play_count integer;

COMMENT ON COLUMN post_daily_stats.fb_play_count IS
  '그날 측정한 play_count 중 Facebook 교차게시 몫. NULL = 교차게시 아님 또는 미측정(0 아님). '
  'IG 전용값 = play_count - COALESCE(fb_play_count, 0).';

-- 확인용:
--   SELECT count(*) FROM sponsored_posts WHERE is_cross_posted;             -- 탐지 후 148 근처
--   SELECT count(*) FROM post_daily_stats WHERE fb_play_count IS NOT NULL;  -- 적용 직후 0
