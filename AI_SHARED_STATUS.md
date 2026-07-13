# AI Shared Status

This is the shared source of truth for Codex, Claude, and any other AI session working on this project.

Rules:
- Read this file before changing code, Sheets, DB, Apps Script, or deployment.
- Do not rely on memory alone. Verify from code, DB, Sheets, deployment, or live UI before making factual claims.
- Update this file after meaningful changes: code commit, deployment, data correction, Apps Script change, or policy decision.
- Do not write secrets, tokens, service-role keys, cookies, or private credentials here.
- If a claim was not verified in the current session, mark it as unverified.

Last updated: 2026-07-13 16:45 KST

## Current Production State

- Main repo/worktree used by Codex: `C:\tmp\influencer-main`
- Production URL: `https://influencer-seeding-mu.vercel.app/`
- Latest pushed code guard commit: `29923f9 fix: guard monitoring stats attribution`
- Latest dashboard UI/monthly-goal deploy commit: `02c6ca6 fix: sync dashboard labels and monthly goal tab`
- Latest shared-status docs commit before this update: `6283605 docs: add shared AI status handoff`
- Vercel production alias verified:
  - `https://influencer-seeding-mu.vercel.app/`
  - points to `https://influencer-seeding-8p9eteu5u-kwhwang-s-projects.vercel.app`
  - deployment id: `dpl_54XrVwNXU8No9pJFN8zN7E1TbC9x`
  - status: Ready

## 2026-07-13 Dashboard Deploy

Reason:
- Deploy only the confirmed missing dashboard changes from `origin/main`, without including unrelated dirty local worktree changes from other AI sessions.

Committed changes:
- `web/app/api/monthly-goal/route.ts`
  - changed the monthly goal sheet tab GID to `[인지_쫀득바]` (`1224959784`).
- `web/app/monitoring/page.tsx`
  - changed the daily delta table header from `누적 조회수` to `조회수 증분`.
  - changed selected-post action label from `선택 종료` to `선택 보관 처리`.
  - added `선택 취소` to clear the current selection.

Verification:
- `npm.cmd test`: passed, 26 tests.
- `npx.cmd tsc --noEmit --incremental false`: passed.
- `npm.cmd run build`: passed.
- `npm.cmd run lint`: still fails on pre-existing lint debt; this deploy did not attempt the broader lint cleanup.
- Vercel production alias verified as Ready on `https://influencer-seeding-8p9eteu5u-kwhwang-s-projects.vercel.app`.
- Live UI verified in logged-in Chrome:
  - `/home` shows `7월 목표 현황` and no longer shows `이달 목표 데이터를 불러오지 못했습니다.`
  - `/monitoring` daily delta table contains `조회수 증분` and no old `누적 조회수` table header.
  - Selecting one post shows `선택 보관 처리 (1)`, `선택 취소`, and no `선택 종료`.

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

## 2026-07-13 JD 7/12 Correction

Reason:
- User reported JD 7/12 expected increment from the Jjondeuk dashboard was much higher than dashboard/linked Sheet/DB.
- Claude independently confirmed some rows were flat/manual and that several ended posts contained copied pollution from live influencer rows.
- Do not inject the aggregate `1,562,357` into DB. Dashboard increment must remain per-URL cumulative stats plus `safeIncrement`.

DB correction applied:
- Upserted per-URL cumulative values for `2026-07-10` / `2026-07-11` / `2026-07-12`, with `manual=true`:
  - `슈기` `/p/Dach9JUR1iW/`: `408,411 / 418,385 / 441,152`
  - `시으니네(IG)` `/reel/Dacjht6TrGq/`: `191,980 / 195,538 / 202,896`
  - `이아` `/reel/DaZ6pOnxiXn/`: `87,002 / 88,430 / 90,955`
  - `안현수` `/reel/DaVK4O7iWOZ/`: `630,074 / 640,812 / 658,457`
  - `백독기` `/reel/DaVAfgdJR4H/`: `81,123 / 82,249 / 84,259`
  - `조션` `/reel/DaVDhkQyqXa/`: `48,057 / 48,337 / 48,991`
  - `하요이` `/reels/DaM9QZZxnof/`: `185,325 / 187,679 / 194,516`
  - `가내수제업` YouTube Shorts `XyxNWdZPgJc`: `152,634 / 153,837 / 153,837`
- Deleted copied pollution rows:
  - `투데이단` `/p/DZ9WqkhpjpA/`: deleted `2026-07-09` through `2026-07-12`
  - `한입혜원` `/p/DZpf4SuJS_Z/`: deleted `2026-07-09` through `2026-07-12`
  - `빵토리` `/p/DZO523IPRkv/`: deleted `2026-07-10` through `2026-07-12`; keep ended-before actual `2026-07-07 = 41,229`

Linked Sheet correction applied:
- Spreadsheet: `10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak`
- Tab: `콘텐츠 대시보드 연동`
- Columns: `BM=7.10`, `BN=7.11`, `BO=7.12`
- Updated rows:
  - `가내수제업` row 696
  - `하요이` row 702
  - `안현수` row 725
  - `백독기` row 726
  - `조션` row 727
  - `이아` row 801
  - `슈기` row 802
  - `시으니네(IG)` row 804
- Cleared copied pollution cells:
  - `빵토리` row 149: `BM:BO`
  - `한입혜원` row 361: `BL:BO`
  - `투데이단` row 670: `BL:BO`
- Follow-up Sheet repair for `빵토리` row 149:
  - Re-read DB stats for `/p/DZO523IPRkv/`; DB last actual cumulative remains `2026-07-07 = 41,229`, `ended_at = 2026-07-07`.
  - Updated linked Sheet row 149 `AD:BP` from DB/carry-forward display policy:
    - `AD:AF` (`6.5`~`6.7`) blank.
    - `AG:BP` (`6.8`~`7.13`) filled from DB measured values plus carry-forward after missing/ended dates.
    - Readback confirmed `AG=19,000`, `BJ=41,229`, `BP=41,229`.

Verification:
- DB upsert readback matched all expected cumulative values.
- DB deletion readback showed no remaining polluted dates for the three ended posts.
- Linked Sheet readback matched the corrected rows and showed cleared pollution ranges.
- Production dashboard live UI was checked in logged-in Chrome with product filters `JD망`, `JD멜`, `JD혼` selected:
  - UI `07/12` daily increment: `+590,176`
  - DB recomputation using dashboard `safeIncrement` semantics: `590,176`
  - `2026-07-13` measurement rows remain `0`.
- Note on prior discrepancy:
  - A rough helper total `705,816` did not exactly match dashboard semantics because it did not fully mirror `safeIncrement` and query pagination.
  - Dashboard truth is `safeIncrement`, including banner reach logic and backlog-first-measurement suppression.

Still pending / do not auto-correct yet:
- Jjondeuk memo aliases `굿띵투유`, `유머패밀리`, `루나앤코코`, `동후작가`, `아택`, `업크루` need URL-level alias mapping before any DB/Sheet edit.
- `이나 (IG)` `/p/DZXeAW8S9IQ/` appears as a remaining unique candidate with `2026-07-12 = 249,508`, but it was not corrected in this pass because the memo uses divided manual increments for ended/untracked channels and needs separate review.

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

## Known Issues / Not Yet Verified

(none open — advertising-cost duplicate issue resolved below.)

## 2026-07-13 Advertising-cost duplicate recheck — RESOLVED (no systematic bug)

Rechecked by Claude against DB `sponsored_posts` (839 posts) + user confirmation. Conclusion: **no systematic advertising-cost duplication.** Do not mass-delete/adjust cost.

- Same-cost-repeated groups are overwhelmingly legitimate:
  - Viral accounts (e.g. good_tip_magazine 250k×32, bibimbap 300k×17, luna.humor 250k×19) post many separate pieces at a flat per-post rate — each a real cost, not a duplicate.
  - Different-product campaigns by the same creator = separate deals (오하루 JD멜/P혼, 지지야먹자 JD망/JD멜, 와뜨기, 여원맛집, 골목대장, 오홀). User confirmed.
  - Contract fees intentionally split across platforms are correct (톡톡시아 833,333×3 = 2.5M/3, 준맛 633,333×3 = 1.9M/3).
- Cross-platform same-product/same-date full-fee entries are **intended per-platform costs, not duplicates** — user confirmed for 뭐랭하맨 (5.7M ×2 IG+YT, DB딸, 05-22) and for the remaining group (시으니네 1.1M×2, 프롬서희 1.0M×2, 라밍 500k×3, 류라이 400k×2, 포슬 100k×2).
- Naive heuristic "base account + same cost" over-counted ~85M (31.6%) and is invalid — ignore it.

No data changed. Cost values left as-is.

## 2026-07-13 JD 7/12 증분 보정 (Codex 실행 중, Claude 검증)

증상: 쫀득바 시트 수동합 1,562,357 vs AI 대시보드 ~41~70만 불일치. 해법 = 총합 주입 금지, **URL별 7/10~7/12 누적 보정**(Codex `JD_20260712_candidate_report.md`). Claude가 DB로 독립 검증함.

- Claude 재계산: **JD(product_name JD멜375+JD망119+JD혼4=498) 7/12 증분 = 415,363** (게시물별 합 = 총합의 차, 두 방식 동일). 후보표의 705,816과 다름 — Codex가 사용한 필터/집계 재확인 필요. 7/13은 측정행 0(미수집) 확정.
- 대상 후보 행은 전부 `manual=true`(수동입력이 평평/미달로 박힘). 예: 안현수 DB 10,578 flat vs 메모 658,457; 슈기 493,012 flat vs 441,152. 자동수집이 못 고침 → per-URL 명시 보정 필요.
- ⚠️ **오염이 종료 게시물로 복사돼 있음 — 후보 upsert와 같은 패스에서 반드시 정리(안 하면 2~3배 이중계상):**
  - 투데이단(종료07-08, `/p/DZ9WqkhpjpA/`) = 한입혜원(종료07-07, `/p/DZpf4SuJS_Z/`) = 동일 시계열 `609,615→630,074→640,812→658,457`, 7/12값 658,457 = **안현수 실제값** 복사됨. 안현수 본인은 10,578에 멈춤.
  - 빵토리(종료07-07, `/p/DZO523IPRkv/`) 7/10~7/12 = `695,164/740,117/781,556` = **복득이 값** 복사.
  - 처리: 종료일 이후 오염 날짜행 삭제 또는 종료 직전 실제값으로 되돌림(빵토리 실제 마지막 07-07 41,229).
- 보류(별칭매핑 확정 전 수정 금지): 굿띵투유·유머패밀리·루나앤코코·동후작가 (DB 계정명 매칭 없음).
- 절차: 백업 → per-URL 7/10·7/11·7/12 upsert → 종료오염 정리 → DB합계·연동시트 BM:BO·대시보드 JD필터 재검증 → 이 파일에 결과 기록.

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

