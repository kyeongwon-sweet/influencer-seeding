-- Instagram post-only not_found review state.
-- Never mutates human notes or automatically ends/excludes a post.
ALTER TABLE sponsored_posts
  ADD COLUMN IF NOT EXISTS not_found_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS not_found_last_at date,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sponsored_posts_not_found_streak_nonnegative'
  ) THEN
    ALTER TABLE sponsored_posts
      ADD CONSTRAINT sponsored_posts_not_found_streak_nonnegative
      CHECK (not_found_streak >= 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE sponsored_posts
  VALIDATE CONSTRAINT sponsored_posts_not_found_streak_nonnegative;
