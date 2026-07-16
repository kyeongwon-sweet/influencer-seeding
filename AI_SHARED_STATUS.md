# AI Shared Status

This is the shared source of truth for Codex, Claude, and any other AI session working on this project.

Rules:
- Read this file before changing code, Sheets, DB, Apps Script, or deployment.
- Do not rely on memory alone. Verify from code, DB, Sheets, deployment, or live UI before making factual claims.
- Update this file after meaningful changes: code commit, deployment, data correction, Apps Script change, or policy decision.
- Do not write secrets, tokens, service-role keys, cookies, or private credentials here.
- If a claim was not verified in the current session, mark it as unverified.

Last updated: 2026-07-16 (refactor branch fully committed & pushed; handoff doc pointer added)

## 2026-07-16 Apps Script Live State (verified in editor via Chrome)

- The linked sheet has THREE container-bound projects all named `마T2P_대시보드(실무용)_25.09~` — content byte-identical across all three (hash-verified). Only ONE `dailyAuto` time trigger exists (no duplicate-run risk). All three last modified 2026-07-15.
- **CORRECTION (07-16 later): the actually-LIVE bound project is a FOURTH, SHARED one (not owned by hwangkw): project id `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn`.** All of today's real executions (dailyAuto/importStats/syncNew/exportStats/onOpen) run there; it also has a 4th file `바이럴 최신효율 업데이트.gs` (118L) and a deployed web app (`doGet`, 버전 1, called frequently). The 3 owned projects have no current executions — they are stale duplicates; edit the SHARED project, not them.
- 07-16 menu label change applied directly in the live editor (saved, verified): `일자별 조회수 입력 (I~열)` → `📊 시트 → 대시보드 조회수 덮기 (I열~)` (importStats), `수집 조회수 시트로 채우기 (I~열)` → `📥 대시보드 → 시트 조회수 채우기 (I열~)` (exportStats). Repo copy updated to match (menu labels only). New labels appear next time the sheet is opened.
- ⚠️ The LIVE script has diverged AHEAD of repo `Combined_Sheet_AppsScript.gs` (repo 1021 lines vs live 1170 + 2 extra files: `clearPrePostedStats` 63L, `바이럴 업체명 채우기` 32L). Live-only helpers: `getIncrementCol_`, `colLetter_`, `isBeforePostedDate_`. 17 functions differ; biggest: `exportStats` repo 90L → live 238L, `dailyAuto` 11L → 40L, `checkSetup` 12L → 32L. Repo-only (not yet deployed): orphan-row menu (`previewOrphanRows`/`deleteOrphanRows`, commit 97f7f58).
- **DO NOT paste repo version over the live editor — it would destroy newer live work. Live editor is currently the newest source for this script; repo copy is stale.**
- CRON_SECRET: rotated 2026-07-15 (user). Live script reads it from Script Properties (no hardcoded secret — verified). Sheet-side syncs all green on 07-16 (dailyAuto/importStats/syncNew/exportStats 완료); `syncAll` completed 07-15 19:19 — the old "syncAll 401" issue appears resolved.
- GHA `cron-daily-collect.yml` 07-16: primary run (01:54 KST) SUCCESS → collection unaffected by rotation. Backup runs (03:44/05:39 KST) failed with **GitHub billing error** ("account payments have failed / spending limit") — user must fix in GitHub Billing & plans or future runs may not start.
- ⚠️ Separate project `팝콘_인지 자동 업데이트`: `pushKpiToVercel` trigger error rate 100% (last run 07-15 11:59, before rotation) — home KPI cards may be stale; needs investigation.

## 2026-07-16 Branch Sync

- All previously uncommitted changes in the canonical worktree (`refactor/monitoring-decompose`) were committed in 5 themed commits and pushed to origin:
  - `6dd8a4b` safeIncrement display recompute (same lineage as main `afeeb5d`/`54a9804`)
  - `e26a2f3` pre-upload stats guards (same lineage as main `29923f9`)
  - `97f7f58` Apps Script orphan-row preview/delete menu
  - `3bb71a4` dead-code cleanup + ESLint unused-vars rule
  - `fb54a0b` docs (shared-status-first rule, same lineage as main `ca3cb72`)
- Remote branch had 2 duplicate commits (identical patches, different hashes); merged via `8ee757c`, no content lost (verified by patch-id and blob comparison).
- Verified before push: 26 web tests pass, `tsc --noEmit` clean, `py_compile` clean on both changed Python scripts.
- Working tree is now clean. Note for future merges to main: several refactor commits duplicate main-side work (see lineage notes above) — expect content-identical conflicts that resolve mechanically.

## Current Production State

- Main repo/worktree used by Codex: `C:\tmp\influencer-main`
- Production URL: `https://influencer-seeding-mu.vercel.app/`
- Latest pushed code guard commit: `29923f9 fix: guard monitoring stats attribution`
- Latest shared-status docs commit before this update: `6283605 docs: add shared AI status handoff`
- Vercel production alias verified:
  - `https://influencer-seeding-mu.vercel.app/`
  - points to `https://influencer-seeding-mhchbvk4t-kwhwang-s-projects.vercel.app`
  - status: Ready

## Monitoring Increment Policy

- First valid measurement counts as the full increment for that day.
  - Example: if a post first appears with 200,000 views on upload day, that day increment is 200,000.
- `safeIncrement` and display increment rules are the single source of truth for dashboard increment display.
- Do not switch dashboard display back to stored `increment` columns.
- Stored `post_daily_stats.increment` is vestigial for display and should not be used as the dashboard truth.
- "Today" is treated carefully because same-day collection can be incomplete.
- Overnight KST collection should be attributed to the intended monitoring date, not blindly to the runtime date.

## Upload-Date / Measurement-Date Policy

- A measured date before a post's upload date is invalid.
- Invalid pre-upload stats must not be stored.
- Invalid pre-upload stats must not be exported to the linked Sheet.
- Dashboard display API must ignore pre-upload stats even if old polluted rows remain in DB.

Current code guards:
- `scripts/run_monitoring.py`
  - skips posts whose `posted_at` is after `TODAY`
  - rejects Apify IG responses whose shortcode was not requested
  - rejects Apify IG responses whose response `posted_at` differs from DB/sheet `posted_at` by more than 1 day
- `web/app/api/monitoring/collect-now/route.ts`
  - same requested-shortcode and posted-date mismatch guards
- `web/app/api/apify-webhook/route.ts`
  - skips pre-upload posts
  - ignores non-requested IG response keys
  - rejects posted-date mismatch greater than 1 day
- `web/app/api/sponsored-posts/route.ts`
  - filters pre-upload stats before dashboard latest/all_stats calculations
- `web/app/api/sponsored-posts/stats-import/route.ts`
  - rejects sheet-import stats before upload date
- `web/app/api/sponsored-posts/stats-for-sheet/route.ts`
  - drops pre-upload stats when exporting DB stats to sheet

## 2026-07-13 Data Correction

Reason:
- Some automatic/API collection or later import propagation attached wrong positive cumulative values to posts.
- Example observed: Chubeureup rows had Abapnam values; Promseohee IG/TT had large overcounts.
- `manual=true` alone is not reliable source evidence because later Sheet import can mark already-existing rows manual.

Verified correction source:
- Jjondeuk dashboard memo notes in spreadsheet `1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s`, tab `인지_쫀득바`, cells `V106:V110`.

DB corrections applied and read back:
- `아밥남`
  - 2026-07-08: 100,497
  - 2026-07-09: 102,210
  - 2026-07-10: 104,573
  - 2026-07-11: 105,261
  - 2026-07-12: 106,953
- `츄베릅`
  - 2026-07-08: 65,128
  - 2026-07-09: 154,478
  - 2026-07-10: 169,020
  - 2026-07-11: 173,517
  - 2026-07-12: 183,169
- `프롬서희(IG)`
  - 2026-07-09: 33,788
  - 2026-07-10: 38,687
  - 2026-07-11: 39,675
  - 2026-07-12: 42,219
- `프롬서희(TT)`
  - 2026-07-09: 54,400
  - 2026-07-10: 83,600
  - 2026-07-11: 84,100
  - 2026-07-12: 84,800
- `셍이`
  - 2026-07-10: 360,485
  - 2026-07-11: 404,145
  - 2026-07-12: 438,406
- `복득이`
  - 2026-07-10: 695,164
  - 2026-07-11: 740,117
  - 2026-07-12: 781,556
- `새로미`
  - 2026-07-11: 8,155
  - 2026-07-12: 10,000

DB cleanup:
- Deleted 8 `post_daily_stats` rows where `measured_at < sponsored_posts.posted_at`.
- Readback after deletion: `pre_posted_count: 0`.

Linked Sheet corrections:
- Spreadsheet: `10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak`
- Tab: `콘텐츠 대시보드 연동`
- Verified date columns:
  - `BJ=7.7`, `BK=7.8`, `BL=7.9`, `BM=7.10`, `BN=7.11`, `BO=7.12`, `BP=7.13`
- Corrected rows:
  - `아밥남` row 696
  - `츄베릅` row 810
  - `프롬서희(IG)` row 811
  - `프롬서희(TT)` row 812
- Verified readback:
  - `츄베릅`: `7/7 blank`, `7/8~7/12 = 65,128 / 154,478 / 169,020 / 173,517 / 183,169`
  - `프롬서희(IG)`: `7/7~7/8 blank`, `7/9~7/12 = 33,788 / 38,687 / 39,675 / 42,219`
  - `프롬서희(TT)`: `7/7~7/8 blank`, `7/9~7/12 = 54,400 / 83,600 / 84,100 / 84,800`
  - `셍이`, `복득이`, `새로미`: upload-before cells blank and values match DB/memo.

## Latest Apps Script

- Current latest Apps Script file referenced by user:
  - `C:\Users\hwangkw\AI\.claude\wt-company\Combined_Sheet_AppsScript.gs`
- Git-tracked Apps Script canonical file:
  - `Combined_Sheet_AppsScript.gs`
  - Synced from the user-referenced latest file on 2026-07-13 so the upload-date guards are not only in a local worktree.
- Policy expected in Apps Script:
  - `exportStats`: never fill cells before upload date.
  - `exportStats`: may forward-fill only after upload date and only for missing measurement display.
  - `importStats`: never import stats before upload date.
  - `importStats`: do not re-import forward-filled carry values as fake new measurements.

## Claude / Codex Shared Entry Points

- `.claude/skills/influencer-seeding/SKILL.md` must instruct Claude to read this file first.
- `CLAUDE.md` and `AI_SKILLS.md` also point to this file.
- Personal AI memory is background/history only. It must not override this shared status file.

## Handoff Context Document (2026-07-15)

- `HANDOFF_ai_context_20260715.md` (repo root) is a single-file context handoff for any new AI session (Claude/Codex/Chrome).
- It covers: integrity rules, concurrent-session coordination, ownership model, 4 open issues, file/path map, DB access pattern, guards, and a pending-work checklist by owner.
- It contains no secrets (locations only). This shared status file remains the source of truth; the handoff doc is an onboarding entry point that points back here.
- Canonical branch at time of writing: `refactor/monitoring-decompose` (not main). Production deploys are manual Vercel CLI (owned by Codex).

## Known Issues / Not Yet Verified

- Advertising-cost duplicate issue mentioned by the user/Claude, including examples such as "뭐랭하맨", has not been rechecked in the current pass.
- Before changing related data, verify the issue still exists from Sheets/DB and record exact rows/cells here.

## Verification Completed For Commit 29923f9

- `py_compile` for `scripts/run_monitoring.py`: passed
- `npm.cmd test`: 26 tests passed
- `npx.cmd tsc --noEmit --incremental false`: passed
- `npm.cmd run build`: passed after elevated permission for `.next`
- pre-push `tsc --noEmit`: passed
- `git push origin HEAD:main`: succeeded
- Vercel production alias: Ready and points to the new deployment

Not fully verified:
- Direct unauthenticated fetch to `/api/sponsored-posts` returned 404 HTML.
- Direct fetch to `/api/sponsored-posts/stats-for-sheet` with local secret returned 401.
- Therefore live protected dashboard UI/API readback was not completed through a logged-in browser in that session.

## Working Etiquette For AI Sessions

- Before code changes:
  - read this file
  - inspect current git status
  - inspect relevant code
  - decide whether the change is still correct before editing
- After code changes:
  - run relevant tests/build
  - verify actual downstream surface when feasible
  - update this file
  - commit only intended files
- For data changes:
  - dry-run first
  - write only verified target rows/cells
  - read back exact rows/cells afterward
  - record what changed here

