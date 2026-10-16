import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const docsSql = readFileSync(
  new URL("../../docs/migration-sponsored-posts-normalized-key.sql", import.meta.url),
  "utf8",
);
const liveMigration = readFileSync(
  new URL("../../supabase/migrations/20261015_sponsored_posts_tiktok_photo_identity.sql", import.meta.url),
  "utf8",
);

test("database identity SQL treats TikTok video and photo URLs as tt:<id>", () => {
  for (const sql of [docsSql, liveMigration]) {
    assert.match(sql, /regexp_match\(path, '\/\(\?:video\|photo\)\/\(\[0-9\]\+\\?\)'\)/);
    assert.match(sql, /return 'tt:' \|\| m\[1\]/);
    assert.match(sql, /18446744073709551615/);
    assert.match(sql, /return null;/);
  }
});

test("live TikTok photo identity migration checks collisions before backfill", () => {
  const exactSetGuard = liveMigration.indexOf("TikTok photo backup set changed");
  const preflight = liveMigration.indexOf("projected sponsored_posts identity keys are not unique");
  const backfill = liveMigration.indexOf("update public.sponsored_posts");
  assert.ok(exactSetGuard > 0);
  assert.ok(preflight > 0);
  assert.ok(preflight > exactSetGuard);
  assert.ok(backfill > preflight);
  assert.match(liveMigration, /lock table public\.sponsored_posts/i);
  assert.match(liveMigration, /v_photo_count <> 268/);
  assert.match(liveMigration, /33044ab2ec6a6e3d01228d5dd798cb7f/);
  assert.match(liveMigration, /71cf390385addb4838e9dbc1369ea571/);
  assert.match(liveMigration, /non-photo normalized_key mismatches found/);
  assert.match(liveMigration, /normalized_key is distinct from public\.sponsored_post_identity_key\(url\)/);
  assert.match(liveMigration, /pg_index/);
  assert.match(liveMigration, /i\.indisunique/);
  assert.match(liveMigration, /i\.indisvalid/);
});

test("bootstrap identity SQL is transactional and locked", () => {
  assert.match(docsSql, /\bbegin;[\s\S]*?lock table public\.sponsored_posts/i);
  assert.match(docsSql, /lock table public\.sponsored_posts[\s\S]*?\bcommit;/i);
});
