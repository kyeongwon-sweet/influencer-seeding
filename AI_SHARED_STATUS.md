# AI Shared Status

This is the shared source of truth for Codex, Claude, and any other AI session working on this project.

Rules:
- Read this file before changing code, Sheets, DB, Apps Script, or deployment.
- Do not rely on memory alone. Verify from code, DB, Sheets, deployment, or live UI before making factual claims.
- Update this file after meaningful changes: code commit, deployment, data correction, Apps Script change, or policy decision.
- Do not write secrets, tokens, service-role keys, cookies, or private credentials here.
- If a claim was not verified in the current session, mark it as unverified.

## 2026-07-14 종료-후 복사 오염 전수조사 + 가드 (Claude)

증상: 협찬(인플루언서)+DB(듬뿍바) 필터·기간필터 없음인데 종료 게시물 증분이 큼(합계 +132,728).
원인: **종료 게시물에 라이브 게시물의 누적 시계열이 복사된 오염**(JD 7/12와 동일 메커니즘). 종료일 이후 measured_at 행에 다른 게시물 값이 박혀 safeIncrement가 가짜 성장을 증분으로 읽음.

전수조사(종료후 성장 + 타 게시물 동일값=복사 확정):
- **DB(듬뿍바) 4건** — 톡톡시아(유튜브)←복득이, 톡톡시아(틱톡)←셍이, 뭐랭하맨(인스타)←셍이, 준맛(인스타)←슈기. 종료 07-07, 종료후 07-08~12행. **14행. 소유 명확(듬뿍바 게시물에 쫀득바 인플루언서 값) → Claude가 정리 예정(백업 `data/output/db-pollution-delete-20260714.json`).** ⚠️ 실행은 안전분류기 차단으로 사용자 명시승인 대기 중.
- **JD/P 상품 5건 = Codex 도메인(JD 7/12 정정)** — 아직 미정리:
  - `smile_life_s2`(JD망, 종료06-10, **28행**, 복사원 요매거진)
  - `니블이`(JD멜, 5행, 복사원 행)
  - `송이`(JD멜, 4행) / `자취생으로 살아남기`(P혼, 4행) — 둘 다 822,210 공유(오하루(IG)·이나와도). **누가 진짜 주인인지 메모(JD_candidate_report) 대조 필요 → 함부로 삭제 금지.**
  - `한입혜원`(JD멜, 1행, 복사원 투데이단) — Codex가 앞서 일부 지웠으나 잔존.
- 의심(종료후 성장, 동일값 없음) 12행: 몽글(JD멜 217,400~229,100), yes__jam_·mamy014·dolkki_daily 등 소액 — 검토 필요.

재발방지(배포됨):
- `stats-import`에 **post_ended 가드** 추가(`b75ad66`): 시트 입력행의 measured_at > 게시물 ended_at이면 저장 거부(종료 게시물엔 신규 측정 유입 불가). 게시일-이전(pre_posted) 가드와 대칭. 응답 `post_ended_skipped` 노출. tsc/build 통과.
- ⚠️ 남은 재발경로 점검 필요(Codex 조율): run_monitoring/apify-webhook/collect-now도 종료후 성장행을 쓸 수 있는지, 표시층 safeIncrement가 measured_at>ended_at 성장행을 무시하도록 할지.

## 2026-07-13 배너 도달수=조회수 표시 경로 전수 정합 (Claude)

배경: d85fc9a는 배너 시트 입력을 `reach_count`로 저장하도록 **저장만** 바꿨고, **표시/집계 경로 전수 점검을 안 해** 회귀가 남아 있었음.
증상: 백필된 배너(play=null, reach=값)의 도달수 열이 `—`, 87 잔존행(play·reach 둘 다)은 열=play인데 카드=reach로 내부 불일치.

단일 규칙 도입:
- `lib.bannerDailyMetric(s) = reach_count ?? play_count`. 배너 지표를 읽는 **모든 표시·집계 경로가 이 헬퍼 하나만** 사용(회귀 재발 방지). `safeIncrement`도 사용.

수정한 경로(전수):
- `PostsTable`: 도달수 열, 도달당비용 분모.
- `page.tsx`: totalPlayCount(KPI 카드), tableTotals(조회수 합계에서 배너 play 제외 + 도달수 합계=일별 도달수), dailyTotals(그래프 증분), companyAnalysis(업체별 누적 — daily-only reach 배너 0 누락 수정), downloadCSV(도달수 열), copyIncrementList(복사 값), patchPlayCount(배너 ×0.8 skip)·updatePostLatestStats(reach 전파).
- Slack 스크립트(notify_increments/notify_status)는 이미 배너=reach 처리 상태.

재발방지 초크포인트:
- `web/app/api/sponsored-posts/[id]/stats/route.ts`: 배너 게시물의 `play_count` 입력은 **어느 호출자든** `reach_count`로 저장(play는 null). stats-import(d85fc9a)와 동일 규칙 → 시트·대시보드 인라인 편집 **모든 수기 입력 경로 통일**.
- 회귀 테스트 `bannerDailyMetric` 추가(총 27 테스트).

커밋: `48dad32`(표시경로+초크포인트), `9742a43`(합계·업체·CSV·KPI).
검증: tsc/build/test 통과. 라이브(로그인 Chrome) — ho1y_time 배너 도달수 열에 3,795·3,466·4,724… 표시, 조회수 `—`, 도달당비용·증분(+6,496) 정상.

데이터 정정 — 배너 잔존 play 행 90건 (2026-07-14, Claude, 사용자 승인):
- 대상: 배너 `post_daily_stats` 중 `play_count>0` 90행. 연산 `reach_count:=play_count, play_count:=null`. 백업 `data/output/banner-residual-fix-20260714.json`.
- provenance 검증(원장): 예 `lllll_lllli_llll`(/p/DZPXjkoAFXq/)은 06-15~07-12 내내 `reach=122,000 manual=true`(팀 수기 시계열). 07-05·07-06만 값이 `play=122,000`으로, `reach`엔 `8,438`(=post.reach_count 스냅샷 충돌 아티팩트)이 박혀 대시보드가 그 이틀만 8,438 딥을 표시하고 있었음. play=122,000이 진짜 값.
- 전수 검증: play가 같은 게시물 reach 시계열에 존재 87/90(나머지 3=07-13 틱톡 신규, reach null); play가 가짜·reach 진짜인 이례 0건; play≥직전 유효 reach(하락 유발) 0건.
- 읽기검증: 적용 후 배너 `play>0` 잔존 0. lllll 07-05/06 → reach 122,000, play null.
- 효과: 07-05·06·13 등의 잘못된 도달수 표시가 진짜 값으로 정상화. (증분/그래프는 mono 가드로 이미 정상이었고, per-row 도달수 열·CSV·합계가 교정됨.)

## 2026-07-13 Monitoring Updated-Value Tooltip Layer Fix

Commit:
- `9abef47 fix(monitoring): lift updated-value tooltip above totals row`

Reason:
- User reported the red updated-value marker/tooltip was hidden under the sticky totals row.

Changed:
- `web/app/monitoring/components/PostsTable.tsx`
  - updated-value marker wrapper now has `relative z-30`.
  - updated-value tooltip now has `z-[80]`, above the sticky totals row `z-20`.

Verification:
- `npm.cmd test`: passed, 26 tests.
- `npx.cmd tsc --noEmit --incremental false`: passed.
- `npm.cmd run build`: passed.
- Vercel production deploy for the code commit was Ready at `https://influencer-seeding-j8oro6jyj-kwhwang-s-projects.vercel.app`.
- Live `/monitoring` check in logged-in Chrome:
  - current live data had no red updated-value dots at check time, so the exact hover visual could not be reproduced from live data.
  - deployed CSS contains `.z-[80] { z-index: 80; }`.
  - deployed CSS contains `.z-20 { z-index: 20; }` for the sticky totals layer.

## 2026-07-13 Monitoring Label/Button Deploy

Commit:
- `b27a8cd fix(monitoring): update increment labels and archive button style`

Reason:
- User still saw `누적 조회수` in the dashboard and asked for the selected archive action to be blue.

Changed:
- `web/app/monitoring/components/CompanyPanel.tsx`
  - visible header `영상 · 누적 조회수` changed to `영상 · 조회수 증분`.
- `web/app/monitoring/page.tsx`
  - selected archive button now uses blue styling: `border-a-blue bg-a-blue text-white`.
  - visible warning text changed from `누적 조회수가 감소한 날짜...` to `조회수 증분이 음수인 날짜...`.

Verification:
- `npm.cmd test`: passed, 26 tests.
- `npx.cmd tsc --noEmit --incremental false`: passed.
- `npm.cmd run build`: passed.
- Vercel production deploy for the code commit was Ready at `https://influencer-seeding-16o240xsr-kwhwang-s-projects.vercel.app`.
- Live `/monitoring` check in logged-in Chrome:
  - daily table header contains `날짜	조회수 증분	검색량`.
  - no live `누적 조회수` text matches were found.
  - selecting one post shows `선택 보관 처리 (1)` and `선택 취소`, not `선택 종료`.
  - archive button class includes `border-a-blue bg-a-blue text-white`.

Last updated: 2026-07-14 (Claude: 종료후 복사오염 전수조사 + post_ended 가드 b75ad66)

## 2026-07-13 배너 도달수=조회수 합산 정합 (Claude)

증상: 시트 '일자별 조회수 입력'한 배너 값이 대시보드에 안 뜸. 원인: stats-import가 배너도 `play_count`로 저장하는데 배너 지표는 `reach_count` → 도달수 열이 비어 ×0.8 추정으로만 뜨고 조회수 열은 '—'.
설계 합의: 배너는 도달수(reach)를 조회수처럼 합산.

수정(코드):
- `stats-import`: 채널분류가 배너면 daily 값을 `reach_count`로 저장(비배너는 play_count 유지). 응답 `banner_reach_inserted`. (d85fc9a)
- `monitoring/page.tsx` 상단 '조회수 합계' 카드: `totalPlayCount`가 배너는 `reach_count`를 합산하도록 수정 — 카드 툴팁("배너는 도달수 합산")과 코드가 안 맞던 기존 버그 정합. (d3f782a)
- 이미 정상이던 곳(변경 없음): dailyTotals(line 233, 배너=reach를 play누적에 합산), viewIncrement/safeIncrement(배너=reach??play).

데이터 백필:
- 배너 `post_daily_stats` 중 play>0 & reach null 3,696행(05-21~07-12, 전부 manual) → `reach_count=play_count, play_count=null` 이관. 백업 `data/output/banner-reach-backfill-20260713.json`.
- 잔존 배너 play>0 87행: reach가 이미 있어 표시엔 reach 우선(무해) → 미변경.

검증(라이브):
- pink_humor25: reach 3,690(×0.8 없음, 이전 2,952), play null.
- '조회수 합계' 카드 화면값 57,981,546 = 배너 reach 포함(신규), play-only 50,968,499 아님. 배너 reach 합 ~8.6M 합산 확인.

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
- Jjondeuk memo alias URL mapping has been extracted and user-confirmed for `굿띵투유`, `유머패밀리`, `루나앤코코`, `동후작가`, `아택`, `업크루`.
  - Important: `루나앤코코` duplicate-looking candidates are all valid separate URLs whose `2026-07-12` values are coincidentally identical:
    - `63,122`: row 758 `good_tip_magazine` `/p/DaXWsj4kRMS/` and row 830 `good_tip_magazine` `/p/DakaOz4k-ZO/`
    - `41,711`: row 732 `nato.tip` `/p/DaVO5zcEvws/` and row 832 `nato.tip` `/p/DakaaMukq2B/`
  - Next correction may use these confirmed URL mappings, but still must dry-run/backup first and verify DB + linked Sheet + dashboard readback.
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
- 별칭매핑: 굿띵투유·유머패밀리·루나앤코코·동후작가·아택·업크루 후보 추출 완료. 사용자 확인으로 루나앤코코 동일값 후보(`63,122` 두 URL, `41,711` 두 URL)는 모두 정상 별도 URL로 확정됨.
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

## 2026-07-14 여믄봇 증분 리포트: 종료 게시물 제외 (Claude)

사용자 보고: 빵토리(실제 4.2만, 이전 건이라 진작 종료됐어야 함)가 아직 트래킹처럼 보이고 여믄봇 리포트에 우수소재로 선정됨.

진단(DB 직접 확인):
- 빵토리 `/p/DZO523IPRkv/` = posted_at 2026-06-05, ended_at 2026-07-07, 실제 최종 41,229. 이미 종료 상태이고 수집기(run_monitoring)도 종료 글 제외 중 → 실제로는 트래킹 안 함.
- 과거 오염(복득이 누적값 695,164/740,117/781,556가 7/10~7/12에 복사)이 가짜 대형 증분(41,439)을 만들었음. 이 오염 stats 행은 **현재 DB에서 삭제 확인됨**(Codex 정리 완료).
- 그러나 `scripts/notify_increments.py`가 종료(ended_at) 게시물을 걸러내지 않아, 종료 글이 오염값을 달고 급상승 TOP10에 올랐음(오늘 오전 리포트는 정리 이전 시점).

수정(커밋 `b93fd4e`, origin/main push 완료):
- `scripts/notify_increments.py`: meta select에 `ended_at` 추가 + 증분 순위 루프에서 `ended_at < target` 게시물 제외(종료일이 target 당일/이후면 포함). 배너 라인은 이미 `not ended_at` 필터라 일관.
- 검증: 07-12 기준 종료 게시물 3건(yes__jam_ 7,306 / mamy014 1,157·416)이 제외됨(108→105건, 종료 0건). 활성 105건 유지. `py_compile` OK. pre-push tsc는 node_modules 없어 skip(파이썬 변경이라 무관).

미처리(사용자 지시로 Codex 영역에 남김):
- 종료 게시물의 '종료일 이후' `post_daily_stats` 행(전수 2,523건 존재, 대부분 평평한 carry-forward=증분0 무해, 일부만 값 점프 오염)의 DB 정리는 upload-date/carry 정책 영역이라 Codex 담당.

