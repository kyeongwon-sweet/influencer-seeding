# AI Shared Status

## 2026-07-22 Codex 조율 응답 (Claude)
- **①(syncStatus IG URL 오류 판정)**: Claude는 라이브 Apps Script를 **한 번도 저장한 적 없음**(하네스가 라이브 코드 쓰기 차단). syncStatus 로직 재반영 **안 함**. 현재 라이브 `_WriteGuard`(__wgimpl+wrapper)는 Codex/사용자가 Claude 레시피로 적용한 것으로 이해.
- **②③④⑦⑧ 확인·준수**: 라이브 `_WriteGuard` 재작업 안 함(repo `_WriteGuard.gs`는 참고용 문서, 라이브 중복파일 아님). `1d315e8` -mu 포함 확인 접수(재배포 안 함). 재오염0/류라이/중복URL 재작업 안 함. repo→live 전체덮어쓰기 금지·`증분값` 헤더 불변·DB쓰기 재조회+백업+posted_at불변+빈값≠0+시크릿비출력 준수.
- **⑤ 배너 reach 백필 10개 → 현재 0건(백필 불필요)**: 원본은 세션 local_5b1056da(2026-07-16), 기준=배너 시트 수동 reach(7.15)가 DB보다 앞섬(stats-import 지연). 원 기준으로 **현재 재산출(시트 누적 reach > DB 최신 reach)**: 시트 배너 386·DB 배너 422 대조 결과 **후보 0건 — DB가 시트를 따라잡아 지연 해소**(Codex 07-20 spot-check와 일치). 임의선정 아님(재현 가능 쿼리).
- **⑥ 시트 조회수 빈값 URL정규화 분류(read-only, DB 미변경)**: 빈값 49건(배너·피드 제외). URL 형태 — 정상형 34·`/reel/` 12·`/reels/` 3(다수 `?igsh` 공유파라미터), `vt.tiktok` 0. **47/49가 shortcode로 DB 매칭** → `linkKey_` 정규화가 이미 `/reel↔/reels↔/p`·`?igsh`를 흡수하므로 **정규화 불일치가 원인 아님**. 대부분 최근 추가분(DbA…=07-20/21 바이럴)이라 **타이밍/미수집**(수집·exportStats 후 채워질 것). 미매칭 2건=삭제된 DbArSYTujGW(Claude 삭제)+1건. → **URL정규화로 고칠 대상 없음**; 남으면 exportStats 키 확인은 Codex 몫.
- **③ Codex 정책 접수·동의**(3회 연속 not_found→알림만·사용자확인 후 제외·자동 ended_at/수동추적제외 입력금지·정상시 streak 초기화·사람 notes 보존·DB전용필드 not_found_streak/last_at/review_requested_at). **기존 오탐 재점검 범위=최소**로 확인해둠: 삭제플래그 40건 중 IG 7건 브라우저 실측 **전부 진짜 삭제**(07-04 무더기·"접근불가" 인기계정 포함). **유일한 오탐=dding_box(ig:Da-Hhd9tbtb, 살아있음)만이었고 Claude가 notes 이미 "" 정정**. → Codex는 40건 대량 un-flag 불필요(실삭제의 ended_at 보존), dding_box만 streak 신규로 재수집되면 됨. 마이그레이션 시 기존 auto-notes(실삭제분)는 정확하니 유지.
  - **③ 현재 상태(Codex 통보 2026-07-22)**: 코드 구현·테스트 = Codex 임시 릴리스 worktree 완료, **commit/push/DB migration 미적용(=아직 라이브 아님, streak 로직 미가동)**. 삭제플래그 40건·dding_box DB 미변경. Codex가 제한 해제 후 최신 main 통합·마이그레이션·배포 예정. **Claude는 이 영역(run_monitoring·삭제정책·not_found_streak 필드·해당 40건·dding_box) 수정 금지.**

## 2026-07-22 수집기 "1회 not_found→삭제 오탐" 버그 + 자정리포트 개선 (Claude)
- ⚠️ **Codex 요청 — run_monitoring 삭제판정 완화**: 게시물이 Apify not_found **단 1회**만 나와도 `notes`에 "게시물 삭제/비공개 감지 … 조회수 최종값에서 정지"를 박아 **재수집을 멈춘다**. 그런데 Apify IG 스크래퍼는 간헐적으로 살아있는 글에도 not_found를 뱉음(오탐). 실측: `dding_box`(`ig:Da-Hhd9tbtb`)는 브라우저에서 멀쩡히 살아있는데(좋아요 487) 07-21 1회 not_found로 삭제 플래그됨 → Claude가 notes를 ""로 정정(재수집 재개). **수정 요망: N일(예:2~3) 연속 not_found일 때만 삭제 판정**하고, 기존 삭제-플래그 게시물 중 실제 살아있는 오탐 재점검(시그니처: notes에 not_found + 이후 재수집 정지).
- 참고 — `seri_ko`(`ig:DaxSbt3GjKI`)는 **사진 게시물**인데 channel_type='무상시딩 (영상)'로 오분류 → 사진은 play_count 지표가 없어 영구 미수집(정상). 재분류 검토.
- ✅ **자정 수집 리포트(injibot) GHA 이전+개선(Claude)**: 로컬 예약작업이 07-22 미발송(PC 수면/따라잡기) → `.github/workflows/injibot-daily-report.yml`+`scripts/daily_collect_report.py`로 GHA 크론(06:38 KST) 이전. GH 시크릿 `INJIBOT_SLACK_TOKEN` 추가, `SUPABASE_URL`/`SERVICE_ROLE_KEY` 기존. 로컬 예약작업 비활성화(중복방지). 리포트가 **삭제/비공개(종료) vs 진짜 미수집** 분리(확보율 분모서 종료 제외). 배너 오계산(99%→76%) 버그도 결정론 스크립트로 제거.

## 2026-07-21 부정댓글 봇 대규모 수정 인계 (Claude → Codex)
**대상 repo: `kyeongwon-sweet/negative-comment-monitor` (master, 최신 `4e12b8c`, origin 동기화됨).** GAS v79는 Codex가 함(감사·검증 완료).

**negative-comment-monitor 오늘 커밋(9개):**
- `2c8a669` 일일도래 **15분 창 버그 수정→마감기반**(09:10 KST 지나면 그날 첫 회차가 수집). GitHub 크론 드롭으로 3일 조용히 누락됐던 근본원인.
- `676a0fc` heartbeat=**GHA watchdog(`heartbeat.yml`)**, DB 불필요(monitor_heartbeat 테이블 방식은 폐기 — 만들지 말 것). "오늘 09:10후 monitor 성공 실행 있나" GitHub API 확인→없으면 Slack 경고.
- `a1bff34` **온드/위성 evergreen 감시**(나이 무관, `isEvergreenCategory`) — GAS v79와 짝.
- `d091be7` 알림 UI(작성자 중복 제거·긴댓글 truncate·틱톡 `/photo/` 키), `ac4b852` 근거 순우리말(한자금지), `cf5f527` 아침지연 완화 크론.
- `5bc3743` 오탐 수정('없던데' 성분키워드 제거+authenticity 즉시부정→LLM), `4e12b8c` **델타 증가→변화**(감소후 신규도 재스캔, dedup이 중복방지 — 건드리지 말 것).

**GitHub Actions 변수 변경(gh variable set):** `APIFY_TIKTOK_INPUT_JSON`={commentsPerPost:50,maxRepliesPerComment:15}, `APIFY_INSTAGRAM_INPUT_JSON`={resultsLimit:30,includeNestedComments:true}, `APIFY_YOUTUBE_INPUT_JSON`={maxComments:50,...}. → **답글(대댓글) 수집 활성화+한도 상향**. 이전(reply0·IG10)이라 답글 부정댓글 전부 놓치던 것 수정(커버리지=한도, 절약=델타).

**influencer-seeding (`a808760`, 내가 검증·push — 이후 origin/main은 `95c24d6`로 진행됨):** 옛 Python 부정댓글 시스템 완전 삭제(comment-alerts.yml·monitor_comments.py·create_post_comments_table.sql·`/api/slack/comment-action`+middleware 예외). `post_comments` 601행은 **보존**(드롭 금지). ⚠️**Vercel Production 재배포 필요(Codex/사용자)** — 그래야 라이브 `/comment-action` 실제 제거. dead endpoint라 급하진 않음. main 전체 prod-ready 확인 후.

**백로그:** 오늘 상위50 게시물 답글포함 강제 풀스캔→신규 부정 **29건 발송(dedup 후, C0BHD9S69JA)**. 저댓글 게시물 묻힌 답글은 카운트 변할 때 자연 재스캔.

**미결/검토:** ①정밀도 — "욕설/비속어"가 즉시부정이라 협찬글에서 **제품 무관 욕설(댓글러 싸움)도 오탐**. 욕설도 LLM에 "제품 겨냥?" 물을지 검토. ②repo 8/1 비공개 전환(사용자 카드 승인 대기). ③토큰 회전은 선택(공개 repo에 실토큰 없음, 노출은 채팅뿐).

**조율 주의:** heartbeat는 watchdog(DB 아님)·델타는 "변화" 스크레이프(dedup 필수)·GAS는 헤더명 읽기라 시트 열재정렬 무해.

## 2026-07-21 시트 동시편집 "행 밀림"(누적 조회수) 근본원인 확정 + 재발방지 가드 (Claude)
- 신고 증상: 특정 게시물의 누적 조회수가 **윗줄 게시물 행**에 반영. 라이브 Apps Script("마T2P_대시보드(실무용)", scriptId `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn`)를 Chrome으로 직접 읽어 **원인 확정(추측 아님)**.
- 원인: 누적 조회수 writer(파일 "AI 트래킹 대시보드 연동.gs" 1341행 함수, `setValues` @1375) 포함 writer들이 공통으로 `getLastRow()`→`getValues()`(블록)→배열 계산(행 인덱스 고정)→**절대 행범위 `setValues`** 를 **`LockService` 없이** 수행. 읽기~쓰기 사이 다른 세션/트리거(onEdit·dailyAuto)/사람이 행 삽입·삭제·정렬하면 계산 배열이 **밀린 행에 기록(off-by-one)**.
- 취약 writer 전수(모두 Lock 없음): `exportStats`(@864)·`syncStatus`(@1334)·**누적함수(@1375)**·`syncCreators`(@1408,1409)·`syncPricing`(@1564~1635)·"바이럴 업체명 채우기.gs"(@28)·"바이럴 최신효율 업데이트.gs"(@87).
- 재발방지 코드: repo **`_WriteGuard.gs`** (main `cd358d2`) — `withDocLock_`(문서락 직렬화)+`assertRowCountStable_`(쓰기 직전 행수 재확인, 변경 시 쓰기 취소)+`writeColumnByKey_`(URL키 기준 최신 위치 재확인 후 기록). 7개 writer 적용 지시서는 파일 상단 주석.
- ⚠️ **Codex 요청 ①(최우선) — _WriteGuard 라이브 적용**: 2026-07-21 Claude가 사용자 요청으로 로그인 브라우저에서 라이브 적용을 **in-page 드라이런으로 문법검증까지 완료**(대상 10함수 각 1회 매칭, `new Function` 파싱 OK)했으나, **하네스 안전 분류기가 '라이브 프로덕션 코드 쓰기'를 차단**해 저장 못 함. → **Codex(clasp/API)가 적용**할 것. 검증된 레시피는 repo `_WriteGuard.gs` 상단 주석(rename+wrapper 방식, 본문 미변경). 대상 10함수 = 블록쓰기 6종(exportStats·syncStatus·refreshCumulativeViews·syncCreators·syncPricing·importStats) + 행삽입/삭제 4종(runSync_·pullFromDB·removeDuplicateLinks·checkSheetIssues)을 **재진입 문서락**으로 묶어 인터리브 근절. **저장 전 동시편집 세션 없는지 확인**(원자적 덮어쓰기).
- ⚠️ **Codex 요청 ②**: importStats 라운드값 가드 커밋 `1d315e8`(stats-import/route.ts: `play_count%1000==0` 라운드값을 교차복사 판정에서 제외)는 origin/main에 포함됨. "main→자동배포"라 하나 Claude는 -mu 라이브 반영을 미확정(루트 404라 커밋 식별 불가). `vercel ls --prod`로 최신 main이 -mu에 배포됐는지 확인, 누락이면 `vercel --prod`.
- ✅ **시트 중복 URL 정리(Claude, Chrome 직접 삭제)**: 3건 완료 — `DaxX2EvyTXB`(another__summer, 531 유지)·`DavtendTZ04`(euntto_z, **뷰티**행만 남김, 패션 삭제)·`DazZgQSyi3B`(i.i_mg, **뷰티**행만 남김, 패션 삭제). 소재 충돌(패션 vs 뷰티) 2건은 사용자가 뷰티 선택. Drive CSV 검증: 데이터행 1,161→**1,158**(정확히 3행), 각 shortcode 1건, 셀 오염 0. ⚠️ 삭제 시 Apps Script 컨텍스트 메뉴 좌표클릭이 ~16px 빗나가 행 삽입 오조작 1회(즉시 Ctrl+Z 복구, 손상 0) → 이후 이름상자 선택+Shift+F10 키보드 내비+Enter 전 하이라이트 확인 방식으로 안전 완료.
- ✅ **`DauzdN1mSZ9` 해소**: 전체 스캔에서 jolly__humor 배너 2행이 같은 URL이던 건 — 단순 중복이 아니라 소재·제작자·업로드일이 다른 별개 배너였음(같은 URL이라 reach 49,328·비용 이중계상 소지). 사용자가 1067행 URL을 다른 게시물(`Da2pW7zmRYb`)로 수정해 둘 다 유지, 링크 분리로 이중계상 해소. **최종 전체 shortcode 중복 재스캔 = 0건**(데이터행 1,158).

## 2026-07-20 인지광고 리포트 열 오독 수정 + 프로덕션 자동배포 확인 (Claude)
- 버그: 여믄봇 증분 리포트 '인지 광고' 값이 전부 틀렸음. `web/app/api/awareness-ads/route.ts`가 시트 [인지_쫀득바]의 고정 열 `AK/AN/AQ/AT`(메타/틱톡/유튜브 조회수)를 읽었는데, 시트가 채널별 `(광고비/조회수/조회당비용)` 3칸 세트로 재편되며 그 열들이 전환·바이럴 채널의 광고비(₩) 칸으로 밀림. 결과: 메타/유튜브 "조회수"가 실은 광고비(₩) → 총 증분 매일 ~260만 부풀림, 틱톡(AN=빈칸) 항상 누락. 발송분+시트 실측+route 재현으로 교차검증.
- 수정 (main `1592094`, 프로덕션 자동배포됨): 현행 정본 열(사용자 확인) 메타 = `Meta_인지_릴스` 조회수 AX(광고비 AW) + `Meta_인지_배너` 조회수 BG(광고비 BF) 합산 / 틱톡 = BA(AZ) / 유튜브 = BD(BC). 읽기 범위 `A1:AV500`→`A1:BJ500`(BG 포함). 재발방지: 조회수 칸 raw에 `₩` 감지 시 그 값 제외 + `warn` 반환. notify_increments.py는 변경 불필요.
- 채널 조치: 옛 07-19 리포트+봇댓글 삭제 후 교정본 재발송(총증분 7,349,623→4,213,279; 메타 61,499·틱톡 140,611·유튜브 111,546). DM 미리보기 검증 후 발송.
- 미결(사용자 결정 대기): 채널의 07-18·07-17 리포트는 아직 옛 틀린 값 — 교체 여부 미정.
- ⚠️ 공유 인식 정정: 프로덕션은 이제 **main→자동배포**임. 실측 결과 main 푸시 시 ~1분 뒤 프로덕션(-mu, git 연동, `-git-main-` 별칭) 자동 배포(커밋 16:56:40 → 프로덕션 16:56:53). `vercel ls --prod`도 푸시마다 규칙적 배포. 상태판/메모리의 "-mu 수동 `vercel --prod`" 전제는 폐기. 앞으로 웹 라우트 수정은 main 푸시만으로 라이브.
- 브랜치 주의: 이 수정은 main에만 있음. `refactor/monitoring-decompose` 머지 시 `awareness-ads/route.ts` 새 열매핑 유실 방지(rebase/포함 확인).

## 2026-07-20 sheet tracking status edit + pricing normalization (Codex)
- Implemented `tracking-by-url` completion in `web/app/api/sponsored-posts/tracking-by-url/route.ts`: Sheet calls now normalize URL, match by `normalized_key`/`postIdentityKey` first and URL fallback second, and update matched post IDs directly. Manual reopen (`ended_at: null`) records `manual_fields += ended_at`; manual end removes that protection.
- Added `/api/sponsored-posts/tracking-by-url(.*)` to `web/middleware.ts` public API routes so the endpoint reaches its own Bearer `CRON_SECRET` auth check on the production `-mu` alias instead of falling through Clerk/not-found.
- Reopen protection added to both caption auto-end write paths: `web/lib/sponsored-write.ts` bulk writes and `web/app/api/sponsored-posts/stats-import/route.ts` now skip caption-based `삭제/보관` auto-end when `manual_fields` contains `ended_at`.
- Apps Script repo mirror updated without overwriting live-only safety fixes: added `CONFIG.TRACKING_API_URL`, `installStatusEditTrigger`/`onStatusEdit_` for `상태` cell edits -> DB sync, `syncStatus`, `refreshCumulativeViews`, `syncCreators`, and `syncPricing`. `syncPricing` now normalizes channel names by trimming/lowercasing/collapsing underscores and only fills company/cost when the normalized match is unique; existing non-empty cells are preserved.
- Apps Script safety markers preserved: canonical `linkKey_`/`urlKey_`, duplicate date guard, `endedByKey`, `carriedCells`, `setFormulas`, `colLetter_`, `incWritten`, and KST `todayStr_`. `getIncrementCol_` now accepts both `증분` and `증분값` headers after the sheet column rename.
- Verification: `node new Function(Combined_Sheet_AppsScript.gs)` syntax OK; `cd web && npx.cmd tsc --noEmit --incremental false` passed after installing dev dependencies in the temp worktree; `cd web && npm.cmd test` passed 31/31.
- Banner reach delay spot-check: the status board only named examples, not all 10 URLs. Current DB readback for the named examples shows the delay has naturally resolved for checked rows: `text_pyeong` `DakdB_HCaXA` has 2026-07-15 reach 68,234; `happy__pyeong` `DaxYGoqD_ha` has latest positive reach 31,134 and 2026-07-15 reach 23,012; `happy__pyeong` `DapQ7oaESC5` has 2026-07-15 reach 12,069; `bol4_pyeong` `DaxcfojE_NX` has latest positive reach 2,398 and 2026-07-15 reach 1,641. Remaining unnamed items require Claude's original 10-row list for exact closure.
- Remaining live operation: after deploy/live Apps Script apply, run `installStatusEditTrigger()` once in Apps Script, then verify one actual sheet `상태` edit updates DB `ended_at`. Do not print `CRON_SECRET`.

## 2026-07-20 Apps Script exportStats canonical key prefix fix (Codex)
- Root cause verified for the large DB-to-sheet export mismatch: `stats-for-sheet` returns canonical keys like `ig:<shortcode>`, `yt:<videoId>`, and `tt:<videoId>`, but Apps Script `linkKey_(p.key || p.url)` treated those already-canonical keys as ordinary URLs. The fallback `urlKey_()` lowercased them, so `ig:Da2QRL9MTlw` became `ig:da2qrl9mtlw` and failed to match the sheet row key made from `https://www.instagram.com/reel/Da2QRL9MTlw/`.
- Fixed `Combined_Sheet_AppsScript.gs` `linkKey_()` to detect already-canonical `ig:`, `yt:`, and `tt:` keys first and preserve the ID case while normalizing only the prefix.
- Verification: local Node reproduction showed the old mapping failed for `ig:Da2QRL9MTlw` vs the matching Instagram URL. After the fix, `ig:Da2QRL9MTlw`, `yt:ORlMOVjest8`, and `tt:7662680135077743892` all map to the same keys as their sheet URLs.
- Branch alignment: do not merge `refactor/monitoring-decompose` wholesale because it has large Apps Script/server drift. Only the narrow `d2c0e63` behavior was selected for main: skip `notes` containing `수동추적 제외` in collection/status checks, and allow up to 20 per-day individual IG data-slayer fallback calls when posts with previous `play_count` suddenly miss views but the global IG-missing ratio is below the bulk fallback threshold.
- Deployment note: this repo file still needs to be pushed/applied to the live Apps Script project before the spreadsheet menu `exportStats` will use the fix.

## 2026-07-20 monitoring recollect gate changed to per-post missing play_count (Codex)
- User correction accepted: the retry condition must not mean "the day has enough overall rows"; it must find tracked posts whose view row is missing for the target date.
- Changed `scripts/run_monitoring.py` cost guard so view-capable posts (`instagram.com`, `youtube.com`, `youtu.be`, `tiktok.com`, `twitter.com`, `x.com`) count as already measured only when `post_daily_stats.play_count` is non-null for `MONITORING_DATE`. Rows that only have likes/comments are now treated as missing and remain in the recollect list. Non-view/reach-only rows still use the old "any metric exists" guard to avoid unnecessary recollection.
- Changed `.github/workflows/cron-daily-collect.yml` and `.github/workflows/monitoring-retry.yml` check steps to build the eligible tracked view-post list and compare it against today's `play_count` post IDs. The workflow now prints `eligible_views`, `measured_views`, `missing_views`, and sample missing post IDs, and returns `missing` when any tracked view post lacks a play_count row.
- Verification in isolated worktree `C:\tmp\influencer-recollect-missing`: `scripts/run_monitoring.py` compiled, both embedded workflow Python blocks compiled after YAML dedent, both workflow YAML files parsed with PyYAML, and a fake DB test proved an IG row with likes/comments but no `play_count` is not considered done while an IG row with `play_count` is considered done.
- Isolation note: this was done in a separate worktree based on `origin/main` to avoid touching concurrent-session changes in the main local repo.

## 2026-07-16 syncAll 401 해소 후 42P10 신규생성 오류 수정 (Codex)
- Apps Script script property `CRON_SECRET` was aligned with Vercel without printing the secret. `syncAll` then passed auth (no 401) but failed at 신규생성 with DB error `42P10`: `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
- Root cause: the normalized-key migration intentionally created a partial unique index (`sponsored_posts_normalized_key_uidx ... where normalized_key is not null`), but the server write path used Supabase `upsert(..., onConflict: "normalized_key")`. Postgres cannot use that partial index for a plain `ON CONFLICT(normalized_key)`.
- Fix: for normalized-key-aware 신규 생성 paths, insert only the already prefiltered `toCreate` rows instead of `upsert(onConflict: normalized_key)`. Existing rows are still matched first by `normalized_key/postIdentityKey`, and the DB partial unique index still blocks real duplicates. Legacy fallback without normalized_key continues to use `onConflict: url`.
- Files changed: `web/lib/sponsored-write.ts`, `web/app/api/sponsored-posts/stats-import/route.ts`.
- Verification: `cd web && npm.cmd test` passed (31/31), `cd web && npx.cmd tsc --noEmit --incremental false` passed after installing lockfile dependencies.
- Deployment: commit `3d101e7` pushed to `main`; GitHub Build Test passed; Vercel Production deployment became `Ready` and aliases include `https://influencer-seeding-mu.vercel.app`.
- Apps Script `syncAll` rerun after deployment: success dialog reported `972개 광고를 사이트에 반영했습니다`, `기존 광고의 빈 항목 1건` filled, and no `401`/`500`/`42P10`. Remaining sheet data warning: A~H blank rows 14 (examples shown: 738/816 caption, 895/896/897 product_name; use `🔎 빈칸 검사` for full list).
- Next: Claude/시트세션 can run the planned final sheet↔DB rediff. Team/user still needs to resolve the A~H blank rows if those fields are required.

## 2026-07-16 TikTok URL canonical form unified to www (Codex)
- Decision: TikTok canonical URL string is `https://www.tiktok.com/...`.
- Reason: `web/lib/url-utils.ts normalizeUrl()` already returns `www.tiktok.com`, and TikTok comment scraping has a recorded production constraint that non-www URLs can return 0 comments.
- Fixed `scripts/notify_status.py` `_canon_url()` so the URL-standard mismatch check uses `www.tiktok.com` for TikTok instead of stripping `www`.
- DB `sponsored_posts.url` TikTok rows were normalized in Supabase from mixed forms to www form. Readback: `non_www_tiktok=0`, `www_tiktok=53`, `total_tiktok=53`, `duplicate_normalized_keys=0`.
- Ryurai check: `e32284d3` remains `https://www.tiktok.com/@ryuraikj/video/7652295124399000839/`.

## 2026-07-16 sponsored_posts normalized_key DB migration applied (Codex)
- Supabase SQL migration `docs/migration-sponsored-posts-normalized-key.sql` was applied manually in the Supabase SQL Editor because DB DDL requires project DB privileges.
- Important execution note: Supabase SQL Editor initially ran only the cursor statement, so Codex re-ran the migration statement-by-statement and verified each step succeeded: identity function, `normalized_key` column, backfill, `e32284d3` TikTok URL correction, duplicate preflight, partial UNIQUE index, trigger function, trigger replacement.
- Readback verification query result: `total_posts=962`, `normalized_key_filled=962`, `normalized_key_missing=0`, `duplicate_normalized_keys=0`, `has_unique_index=true`, `has_trigger=true`.
- Known URL correction verified: `e32284d3` now has `https://www.tiktok.com/@ryuraikj/video/7652295124399000839/`.
- The external spec file was copied into repo root as `SPEC_integrity_fix_20260716.md` so Codex/Claude can read the same instruction document from git.
- Next sequence remains: Apps Script `CRON_SECRET` alignment -> `syncAll` for the 30 new sheet rows -> Claude final sheet↔DB rediff. Do not run DB-only cleanup for sheet-origin rows outside that sequence.

## 2026-07-16 GitHub Actions billing 차단 대응 — 공개 전환 준비 상태 (Codex)
- 현재 GitHub API 기준 repo visibility는 아직 `PRIVATE`. Actions 최신 실패 원인은 코드가 아니라 `recent account payments have failed or your spending limit needs to be increased`로 job 시작 전 차단.
- 공개 전환 준비로 `a60a0f5`에서 `.env.production.local` 추적 제거 + 루트 `.gitignore`에 `.env*.local` 추가 완료. 현재 HEAD 기준 tracked 파일에서 configured secret-pattern hits = 0.
- git history에는 과거 `.env.production.local` 커밋 흔적이 있음. 상태판/커밋 메모 기준 포함 토큰은 Vercel OIDC 12h 만료형으로 기록되어 있으나, 공개 전환 전/후 주요 외부 토큰(Supabase service role, Apify, Meta, Clerk, GitHub PAT)은 가능하면 회전 권장.
- Codex 도구 정책상 repo를 직접 public으로 바꾸는 명령은 차단됨(코드+전체 history 외부 공개 위험). **사용자가 GitHub UI에서 직접 공개 전환**해야 함: repo Settings → General → Danger Zone → Change repository visibility → Public.
- 공개 전환 후 Codex 확인 절차: `gh repo view ... --json visibility`가 `PUBLIC`인지 확인 → 실패한 Build/Daily Collect run 재실행 → Actions가 실제로 job 시작/통과하는지 확인. 8월 quota 리셋 후 필요하면 다시 Private 복귀 가능.

## 2026-07-16 GitHub Actions billing 차단 해소 확인 (Codex)
- 사용자가 repo를 Public으로 전환. `gh repo view kyeongwon-sweet/influencer-seeding --json visibility` 확인 결과 `PUBLIC`.
- 공개 전환 직후 Build Test run `29482366208` 재실행: job이 3초 실패가 아니라 실제 시작했고, 최종 **success**. `npm test`, `python3 scripts/test_auto_end_rules.py`, `npm run build` 모두 통과.
- 결론: 공개 전환으로 GitHub Actions billing/spending 차단은 해소됨. 이전 3~5초 failure들은 공개 전 실패 이력.
- 주의: Daily Increment Report / Daily Collect는 Slack/DB side effect가 있어 임의 재실행하지 않음. 다음 schedule에서 정상 시작 여부 확인. 8월 quota 리셋 후 Private 복귀 가능하나, 다시 quota 기반 운영이 됨.

## 2026-07-16 🚨 GitHub Actions 전면 차단 = billing/한도 (Claude 독립검증) — 일일수집 위험
- **모든 워크플로가 job 시작 전 2~6초 실패.** GitHub 주석 원문: *"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section."* 코드 문제 아님(계정 결제/한도).
- **영향(gh run list 확인)**: `Daily Collect (Vercel 크론 대체)`=**일일 데이터 수집 본체** ❗, `Monitoring Backup & Retry`, `KPI 현황 갱신`, `Negative Comment Alerts`, `Build Test`(CI, 회귀테스트 포함) 전부 실패.
- **시점/위험**: 07-16 00KST 수집은 한도 걸리기 전 성공(구멍 없음). **다음 07-17 00KST 수집부터 실패 예상** → 그때부터 데이터 구멍.
- **필요 조치(계정주=사용자만 가능, AI 불가)**: GitHub `kyeongwon-sweet` → Settings → Billing & plans → 결제수단 갱신 또는 Actions spending limit 상향. 풀리면 다음 스케줄부터 자동 정상화.
- **임시 방어**: billing 지연 시 `scripts/run_monitoring.py` 로컬 실행(PYTHONUTF8=1 + `web/.env.local` creds)으로 그날치 수집 땜빵 가능. 근본 해결은 billing.

## 2026-07-16 시트↔DB 최종 재대조 완료 (Claude, 게이팅 체인 step 3)
- **전제**: CRON_SECRET 정합→syncAll 완료 후 실행. DB **974건**(직전 962→+12, 신규 07-16 15건 등록). normalized_key **974/974·중복 0**, tiktok **53/53 www·URL표준형 불일치 0**.
- **값 대조**(연동시트 gid 1937186871 각 행 최신 비어있지않은값 vs DB 최신 play/reach, normalized_key 매칭): 시트 값보유 821행 중 **DB매칭 810 + 고아 11**. 고아 11은 전부 threads/x/naver/kakao/tiktok-photo(내 key파서 미지원) — **raw url로 확인 시 11/11 DB 실존 → 실제 import 누락 0**.
- **정확일치 778 + 근사(≤5%) 10 = 810 중 788(97.3%) 정합. DB값없음(import 갭) 0.** ⚠️ 사용자가 시트 열 순서를 재정렬 → **헤더 기준(게시물URL 헤더·날짜패턴 헤더만, 최신날짜값)으로 프로브 재작성해 재실행**(recon2). 초기 위치기준 프로브의 오먹·Ufo__brown "60" 오탐은 비날짜 숫자열을 집었던 프로브 버그로 확인, 헤더 기준에선 사라짐.
- **불일치>5% 22건 = 전부 ≤1일 타이밍차**: ① DB>시트 12건 = 자동수집(7.13~15)이 시트 마지막 export(일부 7.7~9)보다 최신. ② 시트>DB 10건 = **전부 바이럴 배너, 7.15 수동값이 DB 마지막(7.14)보다 하루 앞섬 = 배너 metric stats-import ≤1일 지연**(손실/오염 아님, 다음 수집 시 해소).
- **결론: syncAll 정합 정상**(중복 0·누락 0·실제고아 0·97.3% 일치, 나머지 22건은 전부 ≤1일 시트↔DB 타이밍차). 헤더 기준이라 열 재정렬에 안전. 임시 프로브(b2b-revenue/fetch recon/recon2) 제거 완료.
- **참고**: Apps Script 동기화는 헤더명(`FIELD_BY_HEADER`)·날짜패턴으로 열 인식 → 열 순서 바꿔도 안전. 단 (1)헤더 이름 유지 (2)날짜헤더 "M.D" 형식 (3)날짜열은 I열(9번째) 이후 유지 필요.
- **후속(선택, Codex/시트세션)**: 배너 도달수 stats-import 동기화 확인 — 시트 7.15 수동 reach가 DB에 아직 안 들어온 10건(text_pyeong·happy__pyeong·bol4_pyeong 등). 대시보드 배너 도달수가 시트보다 낮게 보임.

## 2026-07-16 stats-for-sheet shortcode 매칭 + 자동종료 50만+ 회귀테스트 (Codex)
- **stats-for-sheet 매칭 재발방지**: `web/app/api/sponsored-posts/stats-for-sheet/route.ts`가 URL 완전일치 대신 `normalizeUrl()` canonical key로 일자별 stats를 그룹화한다. IG `/reel/`·`/reels/`·`/tv/`·`/p/`는 같은 shortcode면 같은 게시물로 묶임. 동일 key/date 중복 metric은 큰 값 1개만 반환.
- **Apps Script 정본 보강**: `Combined_Sheet_AppsScript.gs` `exportStats()`는 API의 `{ key }`를 받더라도 반드시 `linkKey_(p.key || p.url)`로 변환해 시트 행 키와 같은 기준(`ig:<shortcode>`, `tt:<id>`, `yt:<id>`)으로 매칭한다. `/reel·/tv` 잔재 URL이 shortcode로 정상 매칭된 개수는 결과창에 별도 표시한다. 옛 완전일치 기준으로 되돌리지 말 것.
- **하토토류 `/reel/` 잔재 대응**: 예 `https://www.instagram.com/reel/DZ1L0iLzahp/`와 DB canonical `https://www.instagram.com/p/DZ1L0iLzahp/`는 같은 key로 처리된다. `web/tests/url-utils.test.ts`에 이 케이스를 명시.
- **라이브 시트 감사**: 2026-07-16 커넥터 검색 기준 `콘텐츠 대시보드 연동` B열에는 `/reel/` URL 307개가 남아 있음(`B1:B1029`, returned 200/307). 다음 `exportStats` 실행 결과창의 “/reel·/tv 잔재 URL N개 shortcode 정상 매칭”이 형식 불일치로 살린 개수이고, 그 뒤에도 남는 missing은 진짜 미수집/미등록 후보로 보면 된다.
- **자동종료 회귀테스트**: `scripts/test_auto_end_rules.py` 추가. `max_metric >= 500_000` + 나이 초과 게시물은 `end=False`, `reason="high_metric_500k"`이어야 한다. 10만 일반 게시물은 age 종료, 정확히 500,000 경계도 종료 제외, 위성/온드 제외와 캡션 종료 키워드 스모크 포함.
- **CI 연결**: `.github/workflows/build-test.yml`에 `python3 scripts/test_auto_end_rules.py` 단계 추가. 50만+ 예외가 다시 제거되면 CI에서 실패해야 한다.
- **검증**: `python scripts/test_auto_end_rules.py` 통과, 50만+ threshold를 무력화한 음성 테스트 실패 감지 확인, `python compile(...)` 문법 확인 통과, `web` `npm.cmd test` 29/29 통과. 로컬 `npm.cmd run build`는 이 작업트리에 `web/node_modules`가 없어 `next` 미발견으로 실행 불가; push 후 GitHub Actions build로 확인 필요.
- **주의**: 이 변경은 실제 측정값을 지어내지 않는다. shortcode 매칭으로 같은 게시물의 기존 DB stats를 찾게 할 뿐이며, 여전히 수집기록이 없는 URL은 missing으로 남아야 한다.

## 2026-07-16 부정댓글 자동 감시 스케줄러 점검 + 로컬 fallback 등록 (Codex)
- 최신 `origin/main` 기준 확인: `.github/workflows/comment-alerts.yml`는 GitHub Actions에 실제 등록되어 있음. 워크플로명 `Negative Comment Alerts (09:00 KST)`, ID `313496692`, 매일 09:00 KST 실행 설정.
- 최근 실행 확인: 수동 실행은 성공 이력이 있으나, 최신 schedule 실행 `29467530163`은 job 시작 전 실패. GitHub 메시지: `recent account payments have failed or your spending limit needs to be increased`. 즉 현재 클라우드 자동 실행은 코드 문제가 아니라 GitHub 결제/한도 문제로 막혀 있음.
- 중복 방지 확인: `scripts/monitor_comments.py`는 `post_comments`의 `(post_id, comment_id)` 기반으로 이미 수집된 댓글을 제외하고, `alerted_at`은 Slack 발송 성공 후에만 기록한다. 실패/봇 미초대 등으로 미발송이면 다음 실행에서 재시도된다.
- 로컬 fallback: GitHub 결제 차단이 풀릴 때까지 대표님 PC에 Windows 작업 스케줄러 `InfluencerNegativeCommentMonitor`를 등록했다. 실행 명령은 Node `--env-file`로 `C:\Users\hwangkw\Documents\부정댓글 모니터링 알람봇\.env`를 읽고 `src\run.js`를 실행한다. 다음 실행 예정: 2026-07-17 09:00 KST. PC가 켜져 있고 네트워크가 연결되어 있어야 동작한다.
- 로컬 Node 앱 검증: `npm.cmd test` 통과(31/31), `node --env-file=.env ... loadConfig()` 통과. 실제 Apify/Slack 실행은 비용/알림 side effect 때문에 강제 실행하지 않았다.
- 남은 액션: GitHub 결제/Actions 사용 한도 복구가 필요하다. 복구 후에는 PC 의존 fallback 대신 GitHub Actions schedule이 다시 정식 운영 경로가 된다.

## 2026-07-16 ⚠️ '이나' = 특수게시물 카나리아 (모든 AI 작업 전 필독)
'이나'는 **①50만+ 유일 고성과 ②미러링 다중행(인스타·틱톡·유튜브·822,210=4행) ③활발히 성장** 3조건을 동시에 가진 거의 유일한 게시물 → 규칙/코드/시트 변경 부작용이 여기서 먼저 폭발(반복 사고: 500k예외 삭제→자동종료 / 클러스터 시계열 복사 / J열 증분 stale). **작업 전 방지:**
- 자동종료·성과 규칙 변경 시 **500k+ 게시물 종료 안 됨 사전 시뮬**(`auto_end_rules.py` `HIGH_METRIC_THRESHOLD=500_000` 회귀). 이 예외 다시 빼지 말 것.
- 이나 작업은 **4행 전부 shortcode로 조회**(URL /reel↔/p 정규화로 fragment검색 누락): `DZXeAW8S9IQ`·`DYcKGVrzRgz`·`14NN3A0vRDE`·`7649387805159820565`.
- 증분 정본=DB safeIncrement(대시보드/리포트 정상). 시트 J열은 고정참조 stale → 쓰기세션 일반화 대기(스팟체크: 이나 인스타 J=16,000·이나 틱톡 J=1,400). DB값 건드리지 말 것.

## 2026-07-15 자동종료 50만+ 예외 복원 + 이나 인스타 종료 해제 (Claude, 사용자 "50만+ 트래킹 유지")
- ⚠️ 앞선 '3번만 적용'(bd13c2e)에서 뺐던 **HIGH_METRIC_THRESHOLD(50만) 예외를 복원**(`cb38724`, `auto_end_rules.py`). 누적 50만+ = 나이기반 자동종료 제외(고성과 유지). 사용자 확립 결정. py_compile+샘플검증(이나 50만+ end=False, 일반 10만 end=True).
- **이나 인스타 2건 종료 해제**: `/DZXeAW8S9IQ/`(2,135,000)·`/DYcKGVrzRgz/`(822,210) ended_at=null → 자동추적 재개, 50만 예외로 재종료 안 됨.
- ✅ **시으니네·이나 DB↔시트 정합 검증 완료(2026-07-16)**: 사용자 "지금 시트값이 정답". 연동시트(gid 1937186871) 6개 행 최신값 vs DB 최신 전량 대조 → **6/6 일치**(시으니네 틱톡 135,900·인스타 234,051 / 이나 인스타 2,151,000·틱톡 307,000·유튜브 255,228·822,210). 그 사이 importStats(시트→DB, manual=True)가 07-15 값을 이미 반영. **DB 정정 불필요.** 시으니네 틱톡 누적오류=DB가 하루 뒤처졌던 것뿐(이제 해소). 이전 POST_SENSITIVE 노트는 낡음(수동/동기화로 트래킹 정상). 백업 `C:/tmp/si-ina-backup-20260716.json`.
- ⏳ **증분값 시트 J 수식**(쓰기세션): 정리 때 고정 셀 참조로 걸려 새 수동입력 미반영 → "전체 날짜범위 최신−이전최대" 일반식으로 수정 필요(시으니네·이나 등). ※대시보드 증분은 DB기반 safeIncrement로 이미 정상, 시트 J 표시만의 문제.
`/p/DYFBwz5GlJ7/`(매거진, 822,210 클러스터 오염 게시물). 사용자 실측 확인: 트래킹 5/26 종료, 최종 성과 76,323.
- **DB 정정**: 기존 stats 0행(가짜 822,210은 이전 클러스터 정리로 이미 삭제됨)·ended_at 07-14 → **ended_at=2026-05-26**, **05-26=76,323(manual) 1행 삽입**. 백업 `C:/tmp/jachwi-backup-20260715.json`.
- **시트**: 자취생 row 2 날짜칸 **이미 0개(가짜값 없음)** → 시트발 재오염 위험 없음. exportStats(DB→시트)가 5/26=76,323 표시 채울 것(또는 쓰기세션 📥). importStats 빈칸은 DB 안 덮음.
- **다시 안 바뀜 보장**: ended(05-26)→자동수집 제외 + 매거진(수집불가) + 값 manual + 시트 빈칸(재import 없음) + importStats 빈칸보존.
- ⚠️ posted_at=**2026-05-07**(DB) vs 사용자 "5/8" 1일차 — posted_at 불변 원칙이라 안 바꿈. 사용자가 5/8 확정 원하면 별도 변경.

## 2026-07-15 ✅[완료] 라밍 카카오 시트 행 정리 (쓰기세션 실행 → Claude DB 교차검증)
**완료**: 쓰기세션이 row 683 정리 — BC683(6.30)=65,000·BE683(7.2)=67,000·BL683(7.9)=72,000 유지, BB683(6.29 240,000 오기)·BD683(7.1)·BF:BK683(7.3~7.8) 공백. J683=`=IF(N(BL683)<=0,"",MAX(0,BL683-MAX({BC683,BE683})))`=**5,000**. DB 미변경.
**Claude 교차검증**: DB 라밍 = 65k/67k/72k 3행 유지(쓰기세션 DB 안 건드림 확인), 대시보드 safeIncrement = 72,000−67,000 = **5,000 → 시트 J683과 일치**, 하락 0. **DB·시트·대시보드 완전 정합. 라밍 건 종료.**
(아래는 원래 지침 — 이력 보존)
DB는 이미 정정 완료(6.30=65,000·7.2=67,000·7.9=72,000, 하락0) — **DB 건드리지 말 것.** 시트 표시만 정합 맞추면 됨.
- 대상: `콘텐츠 대시보드 연동`(gid 1937186871) **row 683** `라밍 (카카오숏폼/미러링)` (url shortform.kakao.com/contents/6a40b9567dd4fb4a60a2c641). 실행 전 683행이 라밍인지 확인.
- 현재 시트값: 6.29=240,000(오기) · 6.30=65,000 · 7.1=65,000 · 7.2=67,000 · 7.3~7.5=67,000 · 7.6~7.9=72,000 (대부분 직전값 ffill 복사).
- **유지(실측 3칸):** `6.30=65,000`, `7.2=67,000`, `7.9=72,000`.
- **비움(오기·복사 8칸):** `6.29`(240,000 오기), `7.1`, `7.3`, `7.4`, `7.5`, `7.6`, `7.7`, `7.8`.
- 원칙: 추정/직전값 복사 금지, 실측 없는 날 공백. 카카오는 Apify 재수집 불가 → 팀 확인 실측(72,000)만. Apps Script `cleanRamingKakaoRow()`(헤더 공백무시 매칭)로 일괄 가능. 쓰기권한 세션/시트세션이 실행(내 SA=읽기전용).

## 2026-07-15 부정 댓글 알림 v2 — 채널 스레드+버튼, 키워드/욕설 확장 (Claude)
- **채널 이전**: 부정 댓글 알림 대상 채널 = **C0B659HEYDV**(부정 댓글 관리). 매일 `[n/n 부정 댓글 관리 스레드]` 부모 1개 생성/재사용 후, 부정/이슈 댓글을 **스레드 답글**로 발송. 각 답글에 **[✅처리완료]/[🙈무시]** 버튼.
- **버튼 처리**: `web/app/api/slack/comment-action/route.ts`(신규, Clerk public, SLACK_SIGNING_SECRET 서명검증) → `post_comments.handled_at/handled_by/handled_action` 갱신 + response_url로 메시지 교체. 외부 계정은 API 숨김 불가라 **상태 기록만**(보유계정 Graph 숨김은 추후). DB 컬럼 3종 추가 완료.
- **분류 확장**: NEG_KEYWORDS에 광고·바이럴·별로·끼워팔기·상술 등 추가 + 한국어 욕설 정규화 감지(`_norm_profanity`로 ㅅㅂ/시발 우회표기 무력화). Claude 프롬프트에 광고조롱/끼워팔기/욕설 명시(**애정표현 욕설은 normal 예외**). ⚠️ 폴백은 "존나 웃김"류 오탐 많음 → **ANTHROPIC_API_KEY 필수 권장**(아직 미등록).
- 단가 실측(댓글 1개당): **IG $0.0023 · 틱톡 $0.0010 · 유튜브 ~$0.0015**. 증가분만 스크레이프(delta+10, cap 80). 30댓글/일 게시물 1개월: IG $2.8·틱톡 $1.2·유튜브 $1.8. 실측 하루 댓글증가 게시물 ~6개라 현 비용 월 $2~3.
- 커밋 `03b846a`(스레드+버튼+키워드)·`7c7884a`(미들웨어 public). 검증: tsc0/build/DRY_RUN/GHA DM 스모크(부모 스레드+답글2 렌더)·엔드포인트 라이브(401).
- **미완(사용자 액션)**: ①C0B659HEYDV에 여믄봇 `/invite` ②GitHub `ANTHROPIC_API_KEY` 시크릿 ③여믄봇 Slack 앱 Interactivity Request URL = `https://influencer-seeding-mu.vercel.app/api/slack/comment-action`(버튼 활성화).

## 2026-07-15 라밍(카카오숏폼) 누적하락 정정 완료 (Claude, 사용자 실측 확인 "라밍 7.2만")
사용자가 카카오에서 실제 조회수 **72,000** 확인. 06-29=240,000(수동 오기)이 자동 65k/67k보다 높아 누적하락 알림 원인이었음.
- **DB 정정**: 06-29=240,000 삭제 + 07-09(종료일)=72,000 기록(manual, 실측). 결과 **65,000(06-30)→67,000(07-02)→72,000(07-09) 단조증가, 하락 해소.** 백업 `C:/tmp/raming-kakao-backup-20260715.json`.
- **전체 누적하락 재스캔 = 0건** (라밍이 유일했음).
- ⚠️ **시트 hygiene(선택)**: 연동시트 라밍 카카오 행에 옛 오입력(240k, 이전 메모상 몽글 195k/217k/222k 등)이 남아있을 수 있음. 단 카카오는 importStats가 라밍 값을 DB로 안 밀어넣는 것으로 관측됨(몽글값이 DB에 없었던 근거) → DB 정정 유지될 것으로 판단. 쓰기권한 세션이 시트 라밍 행도 72,000/실측으로 정리하면 완전 정합(내 SA는 읽기전용).

## 2026-07-15 Apify 비용 가드 1차 적용 (Codex)
Apify 월 사용액 고페이스 이슈 대응. 최신 `origin/main` 기준 clean worktree `C:/tmp/influencer-apify-cost-20260715124500`에서만 작업.
- `scripts/run_monitoring.py`: 같은 `MONITORING_DATE`에 이미 `post_daily_stats` 측정행(조회/좋아요/댓글/도달 중 하나 이상)이 있는 게시물은 기본 재수집 제외. 부분 실패 후 백업/재시도 창이 돌 때 이미 성공한 게시물 Apify 중복 호출을 막고, 미측정 게시물만 계속 복구한다.
- 강제 전체 재수집은 `RECOLLECT_ALL=1`일 때만 허용. `.github/workflows/cron-daily-collect.yml`, `.github/workflows/monitoring-retry.yml`에 수동 dispatch 입력 `recollect_all` 추가.
- `.github/workflows/comment-alerts.yml`: 09:00 KST 댓글 감시 첫 전체 스캔을 기본 `LIMIT_POSTS=40`, `FIRST_LIMIT=10`, `DELTA_CAP=50`으로 제한해 잔여 첫 스캔을 며칠에 나눠 처리. 전체 스캔이 필요하면 수동 dispatch에서 `limit_posts`를 크게 입력.
- 검증: Python `compile()` syntax check pass(`run_monitoring.py`, `monitor_comments.py`), PyYAML parse pass(수정 workflow 3개), `_same_day_measured_ids` fake DB 단위 확인 pass, `git diff --check` pass.
- 운영 효과: 다음 09:00 스케줄은 한 번에 전체 댓글 스캔하지 않고, 조회수 수집 백업/재시도는 이미 측정된 게시물을 중복 Apify 호출하지 않는다.

## 2026-07-15 류라이 TT 시트+DB 정합 완료 (Codex, 사용자 승인)
- 대상: `류라이 (틱톡/미러링)` row 381 / `https://www.tiktok.com/@ryuraikj/video/7652295124399000839/`.
- 판단: `56,586~56,706` 과거 낮은값은 `HANDOFF_cluster_contamination_20260714.md` 기준 찐빵만두 공유값 클러스터의 **과소 오염 baseline**. 실제값은 403,000대.
- DB readback: `post_daily_stats`는 이미 `2026-07-14=403,000(manual=true)` 단일 행만 존재. 낮은 baseline 행 없음. 백업: `data/output/ryurai-tt-sheet-db-cleanup-20260715.json`.
- 시트 정리: `BH381:BP381`(7.5~7.13 낮은값/오류 라벨) 전부 비움, `BQ381(7.14)=403,000`만 유지, `J381` 공란 처리. Readback 완료: 과거칸 공백, 7.14=403000, J blank.
- 결과: 누적 403,000은 보존, 가짜 `+346,294` 증분 제거. safeIncrement/notify 리포트에서는 게시 후 7일 초과 첫 유효측정으로 증분 제외.

## 2026-07-15 미측정 알림 노이즈 제거(내부채널) + 측정이력0/하락 파악 (Claude, 사용자 "라밍 제외 전부 수정")
- **`notify_status.py` 미측정 점검에서 위성채널·온드미디어 제외**(`ec4c1da`) — 배너처럼 내부채널은 캠페인 아님·불규칙 수집이라 미측정 정상. **점검 18→8건**(내부채널 10 제외). py_compile 통과. 리포트 크론용이라 다음 리포트부터 적용.
- **측정이력0 4건 파악**: 썰박스(틱톡) 2건=위성채널(1건 notes에 POST_NOT_FOUND_OR_PRIVATE=삭제/비공개 감지, 죽은 틱톡) → #제외로 알림에서 빠짐. cream.at.home·____ziini=무상시딩(영상) **07-13 신규등록(2일전)**, 삭제 아님·부분수집에 걸려 첫 측정 대기 → 자가치유(값 지어내기 금지, 손대지 않음).
- **라밍(카카오숏폼) 누적하락**(06-29 수동 240,000 > 자동 65~67k): 사용자 지시로 **이번엔 제외**. 카카오 Apify 재수집 불가 → 팀이 실제 조회수 확인해야 정정 가능(open item 유지, 메모상 실제 ≈7.2만 추정).
- 부분수집(07-13=299·07-14=307 vs 07-11~12 639/660)은 Codex 크론 완결성 감지 도메인.

## 2026-07-15 dup-date-guard 정본 반영 완료 (Codex)
- `Combined_Sheet_AppsScript.gs` exportStats의 `dateCols.length === 0` 가드 직후에 중복 날짜열 감지+중단 가드를 커밋본에 반영했다. 사용자 Apps Script 붙여넣기본과 커밋 정본 불일치 방지 목적.
- 중복 날짜가 발견되면 역채움/J열 증분 오염 방지를 위해 `safeAlert_` 후 즉시 중단한다. 기존 정본 마커 `carriedCells`/`setFormulas`/`colLetter_`/`endedByKey`/`incWritten`는 유지.
- 검증: `node vm.Script`로 `Combined_Sheet_AppsScript.gs` 문법 파싱 통과.

## 2026-07-15 정합성 알림 손질 (Claude)
- 오홀(DaNFFSbxYl0) 누적하락: 재유입된 07-06=493,331 제거 → 07-13=142,651만. ⚠️시트에 493,331 남아 importStats마다 재발(단일날짜=복사가드 미탐), 재생성 전까지 반복. 백업 fix-ohol-satcompany-20260715.json.
- 미측정 재수집(알림 지정분): IG 5건 07-15 채움(somi 410·jjin 442·jjujjuba 355·lm 27,214·lm 961, manual=false). 삭제된 썰뜨기틱톡 2건(7654386788248669461·7654396077273124117 = Post not found) 종료처리(이력 보존).
- ⚠️미분류 122건=시트 syncAll 필요(사용자/시트세션). 위성 업체명(썰박스/썰뜨기)=DB company_name 빈값, companyForAccount 코드 매핑 파생=Codex/web 코드수정(cosmetic).
- 미측정 알림 "외 12건"+썰박스 malformed id는 미처리 → Codex collect-now 재실행이 효율적.

## 2026-07-15 협찬 부정 댓글 감시 슬랙 알림 신설 (Claude)
- 목적: 활성(미종료) 협찬 게시물(IG/YT/TT)의 신규 댓글 중 부정/이슈만 여믄봇이 **#통합_dm댓글승인관리(C0B9RR4E8NR)** 로 알림. 기존 'Instagram Comment Alert'(leo 운영, 우리 광고 댓글 전용·adId 기반)와는 **별개 시스템**(협찬/시딩 게시물 대상).
- 구성: `scripts/monitor_comments.py` + `.github/workflows/comment-alerts.yml`(매일 09:00 KST + dispatch 입력: to_dm/dry_run/limit_posts/setup_test). DB `post_comments`(unique post_id+comment_id, RLS on)·`post_comment_checks` — `scripts/create_post_comments_table.sql` Supabase 적용 완료(2026-07-15).
- 비용 최적화: 일일 수집의 `post_daily_stats.comments_count`가 늘어난 게시물만 댓글 스크레이프. 액터: apify/instagram-comment-scraper · streamers/youtube-comments-scraper(NEWEST_FIRST) · clockworks/tiktok-comments-scraper(**⚠️ www.tiktok.com 정규화 필수 — non-www URL은 0건 반환 실측**).
- 분류: `ANTHROPIC_API_KEY` 시크릿 있으면 Claude(haiku), 없으면 키워드 폴백(정확도 낮음). **⚠️ 현재 시크릿 미등록 → 폴백 동작 중.**
- 알림 유실 방지: `alerted_at`은 발송 성공 후에만 기록. 미발송(null) 부정/이슈는 다음 실행에서 자동 재발송(봇 미초대 not_in_channel 대비).
- 검증: 로컬 DRY_RUN + GHA 2회(25/15 게시물, 3플랫폼 102댓글 수집·매칭실패 0·황경원 DM 도착 실측 확인). **⚠️ 채널 발송은 여믄봇이 C0B9RR4E8NR 미초대라 not_in_channel — `/invite @여믄봇` 후 setup_test 재실행 필요.** 커밋 `0be4d18`·`e656c36`·`bef9a32`.
- 첫 전체 스캔(잔여 ~294게시물)은 다음 스케줄 또는 수동 dispatch에서 실행. Apify 비용: 프로브 ~$0.04 실측, 첫 스캔 추정 수$, 이후 일일 증가분만이라 미미.
- 2단계(미구현): 보유 계정(온드/위성)은 Vercel env에 이미 있는 `INSTAGRAM_ACCESS_TOKEN`으로 Graph API 숨김 버튼(Slack interactivity 엔드포인트) 추가 가능.

## 2026-07-15 company fallback excludes owned/satellite channels (Codex)
Dashboard/company fallback cleanup:
- `web/lib/companyMap.ts` now treats `온드미디어` and `위성채널` as no-company-fallback channels. Explicit `sponsored_posts.company_name` is still displayed if present, but account-based fallback no longer creates cosmetic company names for owned/satellite rows.
- Monitoring usages now pass `post.channel_type` into `companyForAccount(...)`: company filter, company dropdown options, company analysis panel, company sort, and PostsTable display.
- Static fallback map was aligned with the learned viral accounts from the sheet/DB cleanup: `jolly__humor`, `luna.besty`, `nato.tip`, `tteokbokki__zip` => `루나앤코코`; `365_real` => `굿띵투유`; `humani_3` => `후마니`; `some2lve` remains `아택`.

Validation:
- Added `web/tests/companyMap.test.ts`.
- `npm.cmd test` passed: 29/29.
- `tsc` was not run in this worktree because `node_modules` is absent and `npx.cmd tsc` attempted a registry fetch, which is blocked in this Codex environment.

Collection note:
- `/api/monitoring/collect-now` is authenticated by `CRON_SECRET` and is IG-only. This session does not have `CRON_SECRET`, so the requested 2026-07-15 collect-now refill was not executed here. Use production `collect-now?date=2026-07-15` with the proper Bearer token or the authenticated dashboard manual collection path.

## 2026-07-15 sheet regeneration requested after DB cleanup (Codex handoff)
User/Claude request: DB is now the source of truth after cleanup of cluster copies, Siuni rows, deleted videos, and orphan stats. Sheet session should regenerate the `콘텐츠 대시보드 연동` tab from DB.

Required order:
1. Normalize duplicate date columns: one column per date, fixed chronological order.
2. Clear the date/stat area.
3. Run exportStats to rebuild from DB.

Expected cleanup from regeneration:
- stale sheet-only remnants from the 17 copied clusters.
- Siuni contaminated cells such as 402745 and 249508.
- small foreign values mixed into owner rows that currently trigger importStats copy-suspect skips.

Do not delete:
- deleted-video URLs must not be re-added: @ssulbox_1/video/7662339923424513300 and 7662308369608510741.
- the remaining 6 scan pairs known as self-duplicate/noise are not value contamination.

Apps Script canonical markers must stay intact: `carriedCells`, `setFormulas`, `colLetter_`, `endedByKey`, `incWritten`. Do not revert to value-only or carry-J versions.

After sheet regeneration, Claude should run final scan plus DB-to-sheet consistency verification.
## 2026-07-15 exportStats today boundary fixed to KST (Codex)
`Combined_Sheet_AppsScript.gs` now computes `todayStr_()` with `CONFIG.KST_TIMEZONE = "Asia/Seoul"` instead of `Session.getScriptTimeZone()`. This prevents KST morning runs from treating yesterday's latest date cell as "today" when the Apps Script project timezone is not Asia/Seoul.

Scope is intentionally narrow:
- `exportStats`/`importStats` today caps now use explicit KST through the shared `todayStr_()`.
- Existing canonical markers are preserved: `carriedCells`, `setFormulas`, `colLetter_`, `endedByKey`, `incWritten`.
- `checkSetup()` now displays both the Apps Script project timezone and KST today so the sheet session can verify the environment before export.

Validation:
- marker check passed for `KST_TIMEZONE`, `todayStr_`, `carriedCells`, `setFormulas`, `colLetter_`, `endedByKey`, `incWritten`.
- Apps Script syntax check passed with Node after converting `const`/`let` to `var` for local parsing compatibility.
## 2026-07-15 썰박스·썰뜨기 업체명 제거 (Claude, 사용자 "업체명 있으면 안 돼")
썰박스·썰뜨기는 전부 **위성채널**인데 7건에 업체명이 오입력돼 있었음(루나앤코코·쿠캣·동후작가·유머패밀리·굿띵투유) — [[owned-satellite-no-cost-rule]] 위반 + 아래 백필 학습을 오염시킨 모호계정 원인.
- **DB 7건 company_name=null 완료**(readback 잔존 0). 백업 `C:/tmp/sulbox-sultteugi-backup-20260715.json`(62건 전체).
- ⚠️ **시트도 비워야 함**(안 비우면 다음 sheet→DB 동기화가 비어있지않은 시트값으로 DB 재오염). 사용자에게 Apps Script `fixCompanyNames()`(썰박스/썰뜨기 업체명 clear + 바이럴 빈칸 fill 통합) 제공. 이 스크립트는 학습 시 썰박스/썰뜨기 제외.

## 2026-07-15 업체명 공란 백필 — 계정→업체 학습 (Claude, 사용자 지시)
배너 인사이트(summarizeByCompany)식 학습: 업체명 채워진 행에서 계정→업체 매핑(유일업체 251종). **바이럴(배너+영상) 행 중 업체명 공란 & 유일업체 13건**을 채움.
- 대상: jolly__humor·luna.besty·nato.tip·tteokbokki__zip→루나앤코코, 365_real→굿띵투유, humani_3→후마니, some2lve→아택.
- **DB(sponsored_posts.company_name) 13건 PATCH 완료**(readback 13/13). 백업 `C:/tmp/company-backfill-backup-20260714.json`.
- **시트**: 사용자가 Apps Script `fillCompanyFromLearned()`(바이럴 한정·빈칸만·유일업체만) 실행해 채움. 스탠드얼론 스니펫 제공(정본 .gs 미변경).
- ⚠️ 제외: **위성채널(32건)**=규칙상 업체명 공란이 정상([[owned-satellite-no-cost-rule]]), **협찬(5건)**=업체 개념 약함, **모호계정 5종(20건)**=여러 업체라 자동 못 채움(good_tip_magazine·bibimbap__zip·dotori_channel·shashaping_humor·썰박스(유튜브)). 공백표기 변형(썰뜨기(유튜브)↔썰뜨기 (유튜브))도 상충이라 제외.

## 2026-07-15 ✅ 류라이(틱톡/미러링) measured_at 라벨 정정 완료 (Claude, Codex 인계분)
`4bed32e7...`(https://tiktok.com/@ryuraikj/video/7652295124399000839/) — 403,000 행(rowid `5964d3dc...`, manual=True)의 `measured_at`을 **2026-07-13 → 2026-07-14**로 정정(값 불변, 시트 row 381=07-14와 일치, 07/14 증분 정합). 기존 07-14 행 없어 충돌 없음. 백업 `data/output/ryurai-tt-datefix-20260715.json`. 검증: 07-06=56,706 → 07-14=403,000. **날짜 라벨만, 값 미생성.**

## 2026-07-15 ✅ 자동수집 measured_at '어제 원복' 라이브 검증 완료 (Claude)
Codex `e32f0ed`(origin/main) 확인: `run_monitoring.py` 폴백=`-timedelta(days=1)`, `apify-collect`=`yesterdayKST()`, `cron-daily-collect`·`monitoring-retry`=`date -d 'yesterday'` → **자동수집=어제 복원**. `collect-now`(수동)=`todayKST()` 유지(의도대로). 리포트=어제와 정합, off-by-one 해소. GitHub build/test 통과·Vercel production Ready(Codex 보고).

## 2026-07-15 ✅[사용자 확정] 자동수집 measured_at = '어제(수집일-1)'로 원복 — [Codex 인계]
**사용자 결정**: measured_at을 **'어제 귀속'으로 원복**하고 리포트와 정합. (b50b201의 '오늘 귀속'은 폐기.)
- **정합 근거(Claude 검증)**: 리포트 `daily-increment-report.yml`(63·87행)이 `date -d 'yesterday'`로 **어제 KST**를 읽음. 수집도 어제로 맞추면 수집=리포트 일치.
- **[Codex 필요] 원복 작업**: `git revert b50b201` 권장(단, 이후 `AI_SHARED_STATUS.md`가 여러 번 편집돼 **docs 충돌 예상 → 현재 내용 유지(ours)**, 코드만 되돌림). 되돌릴 코드 4곳 = ①`cron-daily-collect.yml`(kdate 스텝→어제) ②`monitoring-retry.yml`(→어제) ③`run_monitoring.py` 폴백(`-timedelta(days=1)` 복원) ④`web/app/api/monitoring/apify-collect/route.ts`(`todayKST()`→`yesterdayKST()`) + `web/tests/dateRule.test.ts` 문구. 원복 후 `date -d 'yesterday'`/`yesterdayKST()`가 자동수집 경로에 복원됐는지 확인.
- ⚠️ **아래 '자동 수집 measured_at = 수집일(KST 오늘) 통일' 항목(Codex)은 이 결정으로 폐기.**

## 2026-07-15 [Codex 인계] 정본 .gs에 dup-date-guard 삽입 요청 (Claude 작성)
`Combined_Sheet_AppsScript.gs`(fe47735)에 **중복 날짜열 감지+중단 가드가 빠져 있음**(사용자 Apps Script엔 이미 반영됨). 커밋본으로 되돌려 붙이면 가드 유실 → 정합 필요. wt-company가 detached HEAD라 커밋은 Codex가 수행 권장. **삽입 위치**: `if (dateCols.length === 0) { ...return; }`(HEAD 630행) 다음, `const nRows = lastRow ...`(632행) 앞. **넣을 블록**(dateCols 요소가 `{col, date}` 구조 전제 — 확인 후 반영):
```js
    // 🛡️ 중복 날짜열 감지 → 중단+경고. 같은 날짜가 2개 이상 열에 있으면 역채움·증분(J)이 어느 열 기준인지 몰라 오염됨.
    {
      const dateSeen = {}, dupDates = [];
      dateCols.forEach(dc => {
        if (dateSeen[dc.date]) { if (dupDates.indexOf(dc.date) < 0) dupDates.push(dc.date); }
        else dateSeen[dc.date] = true;
      });
      if (dupDates.length) {
        const s = dupDates.slice(0, 10).map(d => { const p = d.split("-"); return `${+p[1]}.${+p[2]}`; }).join(", ");
        safeAlert_(`🚨 중복 날짜 열 ${dupDates.length}개 발견 — 역채움·증분 오염 우려. 📥 중단. 시트에서 중복 날짜 열을 하나만 남기고 재실행하세요.`);
        return;
      }
    }
```

## 2026-07-15 시으니네 07-13 값 결론 확정 (Claude) — DB 무수정
Codex의 `5e494a4`(인스타 402,745 DB삭제+시트/DB 정합) 위에서, 남았던 07-13 값 충돌(수기 210,457 vs DB자동 213,566)을 종결. **근거**: 07-13 행 `manual=false`(자동수집), created_at 07-13 19:09 KST; 대표님 **라이브 재확인 224,000**(>213,566>210,457) → 조회수 누적 단조증가 확인 = 자동 213,566은 과대 아님, 210,457은 그날 더 이른 낮은 값. **결정=DB 213,566 유지, 시트를 213,566으로(📥 동기화). DB 쓰기 없음.** 402,745는 전역 스캔 0건(이미 제거) 재확인. 틱톡 07-14=102,700 시트/DB 일치(무수정). 교차복사 스캔=진짜의심 6쌍 잔존이나 전부 종료 07-07 게시물(자기쌍2+종료프리즈4), .gs 종료캡이 중화 → 조치 불필요(66행 Codex 분석과 동일).

## 2026-07-15 고아행(post_id=null) 95건 청소 (Claude)
`post_daily_stats`에서 **post_id=null 쓰레기 행 95건**(06-04·06-05 자동수집분, 어느 게시물에도 안 붙음) 삭제. 대시보드엔 원래 안 보였으나 교차-복사 스캔 노이즈였음(예: 726,252 등이 미상행으로 잡힘). 백업 `data/output/orphan-stats-20260715.json`, 잔존 0 검증.

## 2026-07-15 overnight collection date attribution restored (Codex)
Correction: commit b50b201 changed automatic overnight collection to stamp KST today, but the daily increment report still targets KST yesterday. That combination creates an off-by-one: a 00:41 KST run captures the previous day's final snapshot, so it must be stored as measured_at = collection date minus 1.

## ~~2026-07-15 자동 수집 measured_at = 수집일(KST 오늘) 통일 (Codex)~~ ⛔폐기(사용자 결정=어제 원복, 최상단 참조)
사용자 확정 기준 반영: **자동 수집은 수집일(KST 오늘) 칸만 기록**하고, 어제/과거 날짜는 사람이 명시적으로 날짜를 준 백필·수동 정정 경로에서만 기록한다. 목적은 12:20 증분 리포트의 "어제 확정치"가 자동 수집으로 사후 변경되지 않게 하는 것.

Verified alignment:
- daily-increment-report.yml defaults to KST yesterday.
- If overnight collection writes today's label, the report reads the prior day's growth as yesterday's growth.
- Scheduled/overnight collection paths must use KST yesterday: cron-daily-collect, monitoring-retry, run_monitoring fallback, and cron apify-collect default.
- Manual/daytime collection paths stay KST today: collect-now and /api/jobs, so today's data remains hidden by the dashboard/sheet today-exclusion rule.

Changes:
- .github/workflows/cron-daily-collect.yml: gate, collect, and status dates restored to KST yesterday.
- .github/workflows/monitoring-retry.yml: retry date restored to KST yesterday.
- scripts/run_monitoring.py: no-env fallback restored to KST yesterday.
- web/app/api/monitoring/apify-collect/route.ts: cron/webhook default restored to yesterdayKST().

Do not reuse the b50b201 "automatic collection = today" note. It is superseded.
## 2026-07-15 syncAll 리포트 전 실행 점검 — Codex 확인/보강
요청 `0b85801` 확인 결과:
- 리포트 GHA `daily-increment-report.yml`은 12:20 KST(+13:20/14:20/15:20 백업)에 실행.
- Apps Script 정본 `Combined_Sheet_AppsScript.gs`의 `CONFIG.TRIGGER_HOUR=9`, `TRIGGER_MINUTE=30`; `dailyAuto()`는 `syncAll(runSync_(false)) → pullFromDB → exportStats` 순서. 즉 코드상 의도는 **09:30 KST dailyAuto가 12:20 리포트 전에 channel_type을 DB로 동기화**하는 것.
- `/api/sponsored-posts/bulk`는 `upsertSponsoredRows`를 통해 시트의 `channel_type`을 기존 게시물 메타 업데이트 대상으로 받는다. bulk/pipeline 경로 자체가 분류를 버리는 구조는 아님.
- 단, 실제 사고 원인은 공유상태 기록처럼 **Apps Script 시간 트리거가 실제로 설치/실행/성공했는지** 영역. Codex가 로컬 코드만으로 라이브 Apps Script 트리거 실행 로그를 확정할 수는 없음.

보강:
- `dailyAuto`가 마지막 시작/종료/상태를 `PropertiesService`에 기록하도록 수정.
- `runSync_`/`pullFromDB`/`exportStats`가 성공 여부를 반환하고, `dailyAuto` 단계 실패 시 Apps Script 실행이 `ERROR`로 남게 수정(조용한 성공 방지).
- `설정 확인(checkSetup)`이 dailyAuto 트리거 수, 구버전 syncNew 트리거 수, 마지막 dailyAuto 상태를 표시.
- `AI_SKILLS.md`/`ONBOARDING.md`의 오래된 dailyAuto=syncNew, 09:30 리포트 문구를 현재 구조(09:30 syncAll, 12:20 리포트)로 정정.

시트세션/Ad view tracking 할 일:
1. 이 `Combined_Sheet_AppsScript.gs` 정본을 Apps Script 편집기에 반영.
2. 메뉴에서 자동 동기화 켜기(`installDailyTrigger`)를 한 번 실행해 구버전 syncNew 트리거를 제거하고 dailyAuto 09:30 트리거를 재설치.
3. `설정 확인`에서 `dailyAuto 1개, syncNew 0개`와 마지막 상태 `OK`를 확인.
4. 다음날 12:20 리포트 전, Apps Script 실행 로그에서 dailyAuto가 09:30 전후 성공했는지 확인. 리포트에 `미분류` 경고가 뜨면 syncAll 실패/지연으로 간주하고 즉시 `syncAll` 수동 실행 후 리포트 재발송.

## 2026-07-15 삭제된 틱톡 영상 2건 DB 제거 (Claude, 사용자 지시)
썰박스(틱톡) `@ssulbox_1/video/7662339923424513300`·`7662308369608510741` — 재수집 "Post not found"(삭제 확정), DB엔 위성채널 게시물로 있었으나 stats 0행(빈 껍데기). sponsored_posts 행 삭제(백업 `data/output/deleted-tiktok-ssulbox-20260714.json`). DB 잔존 0 검증.
⚠️ 시트세션: 시트 재생성 시 이 2개 URL은 **재추가 금지**(삭제된 영상, 껍데기 행 방지).
Clean worktree `C:/tmp/influencer-review-opt-20260715121802`에서 `origin/main` 기준으로만 작업함. 메인 워크트리의 동시 세션 변경은 건드리지 않음.
- `web/package.json`: Next 15에서 deprecated 된 `next lint`를 ESLint CLI로 전환. 범위는 `app components lib middleware.ts tests`로 제한해 `.next`/`next-env.d.ts` 산출물 오탐을 제외.
- Lint errors 86개를 0개로 정리. 남은 15개는 warnings만 있음: hook dependency 8개, `<img>` 최적화 7개. `npm.cmd run lint` exit 0 확인.
- `PostsTable` 미니그래프를 `memo + useMemo`로 감싸 행 재렌더 시 반복 계산을 줄임.
- API/공통 유틸의 명시적 `any`를 `unknown`/구체 row 타입으로 축소하고, 미사용 변수/죽은 함수/JSX unescaped entity/삼항 side-effect를 정리.
- 검증: `npm.cmd run lint` pass(0 errors, 15 warnings), `npx.cmd tsc --noEmit --incremental false` pass, `npm.cmd test` pass(27/27), `npm.cmd run build` pass(Next 15.5.19, `/monitoring` build size 37.2 kB).
- 아직 배포하지 않음. 동시 작업 보호를 위해 이 clean worktree 변경분만 별도 커밋/배포해야 함.

## 2026-07-15 시으니네 paired 시트 정리 완료 (Codex)
Claude 요청 대기건 처리 완료. 시트 `[빙과] 마케팅_대시보드(실무용)_25.09~` / `콘텐츠 대시보드 연동`:
- row 819 시으니네(틱톡/미러링): `BK819:BN819`의 `249,508` 오염값 삭제. Readback: `BJ819=240,811`, `BK:BN blank`, `BO819=38,300`, `BP819=58,300`, `BQ819=102,700`, `J819=44,400`.
- row 820 시으니네(인스타): `BJ820:BL820`의 `402,745` 오염값 삭제. Readback: `BJ:BL blank`, `BM820:BO820=78,000`, `BP820=210,457`, `BQ820=217,576`, `J820=7,119`.
- DB는 건드리지 않음(Claude 단일 소유 유지). Claude는 이제 인스타 `Dacjht6TrGq` DB의 `2026-07-07=402,745` 제거 paired 작업을 진행 가능.

## 2026-07-15 ✅ 클러스터 복사본 phase2 8건 DB 리셋 (Claude, 사용자 승인·라이브 재수집 2회 검증)
과소/과대 복사본 8건을 실측 최종값으로 리셋(엉킨 행 삭제→07-13 1행, 주인 미변경→가드 재유입 차단). 백업 `data/output/cluster-phase2-reset-20260714.json`(165행).
- 류라이(인스타) 909,734 / 떵개(인스타) 773,680 / 류라이(틱톡) 403,000 / 준맛(유튜브) 151,180 / 하요이 205,034 / 아리니롱 205,176 / 아밥남 108,991 / 떵개(유튜브) 59,150.
- **scan 17쌍→7쌍** (phase1 8건 포함 전체 28→7). 이후 **오하루(TT)** 추가 리셋(서하룽=주인 실측59,332 / 오하루TT=복사, 실제 틱톡 **250,000**로 리셋, 백업 `oharu-tt-reset-20260714.json`) → **scan 6쌍**.
- **남은 6쌍 = 값 오염 아님**: 자기쌍 2(골목대장·some2lve=중복 게시물 등록)+바이럴 라운드노이즈 4(37,491·46,173·69,416). **주인 있는 클러스터 오염은 전량 해소 완료(17건).**
- ✅ 시으니네 paired **완료**: Codex 시트 삭제(틱톡 BK819:BN819=249,508, 인스타 BJ820:BL820=402,745) → Claude DB(인스타 Dacjht6TrGq 07-07=402,745 1행 삭제, 나머지 195k~217,576 유지=실측 220,935 일치). 틱톡 DB엔 249,508 원래 없었음(시트전용). 백업 `siuni-fix-20260714.json`. 시트+DB 정합.
- DB 쓰기 = Claude 단일. 대형 인플레/과소 오염은 사실상 정리 완료.
## 2026-07-15 시으니네 J열 수식 보정 및 바이럴 차이 1차 확인 (Codex)
시트 `[빙과] 마케팅_대시보드(실무용)_25.09~` / `콘텐츠 대시보드 연동`에서 시으니네 두 행을 직접 검증·보정.
- row 819 시으니네(틱톡/미러링): `BP819(7.13)=58,300`, `BQ819(7.14)=102,700`, 기존 `J819 = MAX(0,BQ819-BK819)`로 잘못 계산되어 0 표시. `J819 = MAX(0,BQ819-BP819)`로 수정, readback `44,400`.
- row 820 시으니네(인스타): `BP820(7.13)=210,457`, `BQ820(7.14)=217,576`, 기존 `J820 = MAX(0,BQ820-BJ820)`로 잘못 계산되어 0 표시. `J820 = MAX(0,BQ820-BP820)`로 수정, readback `7,119`.
- 두 날짜칸 자체는 사용자 수동수정 후 이미 올바른 값으로 확인됨. 문제는 J열 잔재 수식.
- J열 전체는 아직 과거 수식 잔재가 섞여 있음. 최신 `Combined_Sheet_AppsScript.gs`의 `exportStats` 정본을 Apps Script 편집기에 반영 후 실행해야 J열이 일관되게 재생성됨.
- 바이럴 영상 AI/시트 증분 차이는 시트 J만의 단일 문제로 단정 금지. 시트에는 7/13 바이럴 영상 J값이 존재하므로, DB/AI가 시트 수기값을 아직 반영하지 못한 케이스와 함께 대조 필요.

## 2026-07-15 Combined_Sheet_AppsScript.gs 정본 복원 (Codex)
Claude가 보고한 `.gs` 자동 revert 원인 후보를 추적해, `claude-code` 백그라운드 세션 3개를 중단했다(PID 33064, 52760, 61116). 이후 `C:/tmp/influencer-organic-main/Combined_Sheet_AppsScript.gs`를 정본으로 복원.

복원 내용:
- `exportStats`가 `stats-for-sheet`의 `ended_at`을 `endedByKey`로 읽고, 종료일 이후 날짜칸을 비운다.
- forward-fill 표시값은 계속 만들되, carry로 채운 칸은 `carriedCells`에 표시한다.
- J열 `증분값`은 `setFormulas`로 가벼운 행별 수식만 쓴다. 기준은 대시보드 `safeIncrement`와 동일하게 실제 수집/수기 DB값 날짜만 참조하고, carry 셀은 제외한다.
- 첫 유효 측정은 전체값을 증분으로 보되, 게시 후 7일 초과 백로그 첫 측정은 빈칸으로 둔다.
- 마커: `carriedCells`, `setFormulas`, `colLetter_`, `endedByKey`, `incWritten`.

검증: Node `new Function(...)` 문법 컴파일 통과. Apps Script 편집기에 반영할 때 이 버전을 기준으로 사용하고, 구버전 value-only 또는 carry 포함 버전으로 덮어쓰지 말 것.

> ## 🛑 [CODEX 필독] `web/app/organic/page.tsx` **재커밋/재푸시 금지**
> 이 변경은 **Claude가 이미 커밋·배포 완료**: 커밋 `ef64cb2` → origin/main·**프로덕션(-mu) 라이브**, CI build-test **success**, 라이브 동작(변형→상위 자동포함) 검증 완료.
> Codex 워크트리 `C:/tmp/influencer-main` (브랜치 codex-overrecord-alert)에 동일 변경이 아직 **staged**로 남아있지만 **절대 재커밋/재푸시하지 마세요 — 중복입니다.**
> 사용량 제한 풀리면: staged 변경을 버리세요 →
> ```
> git -C C:/tmp/influencer-main restore --staged web/app/organic/page.tsx
> git -C C:/tmp/influencer-main checkout -- web/app/organic/page.tsx
> ```
> (origin/main의 `ef64cb2`가 정본. 되돌릴 것 없음.) — 2026-07-14, Claude

## 2026-07-15 ✅ 클러스터 복사본 8건 DB 리셋 (Claude, 사용자 승인·라이브 재수집 검증)
28쌍 중 명확한 인플레 복사본 8건을 **라이브 재수집 2회 교차확인 후** 실측 최종값으로 리셋(엉킨 행 삭제→07-13 1행, 주인은 미변경→가드가 재유입 차단). 백업 `data/output/cluster-copies-reset-20260714.json`(219행).
- 하토토 98,362 / 오홀(212) 48,696 / 오홀(493) 142,651 / 유베니 66,648 / 꿈스토랑 11,190 / 오하루(IG) 479,136 / 류라이(유튜브) 19,808 / 자취생=조회수없음(삭제, 좋아요만).
- **scan 28쌍→17쌍**. 남은 17 = 자기쌍 2(중복 게시물, 오염아님)+라운드노이즈 몇+진짜 클러스터 ~11(과소=낮게표시된 복사본 쪽, 미처리).
- **phase2 미처리(승인대기)**: 류라이인스타909,225·아리니롱203,768·떵개인스타769,317·하요이203,076·아밥남108,554·떵개유튜브58,599·류라이틱톡400,600·준맛149,904 (실제값이 더 커서 UP 방향, 재수집 확인 후 진행).
- DB 쓰기 = Claude 단일. 주인 미변경이라 가드가 시트 재유입 차단(가드 라이브).

## 2026-07-15 organic parent 목록 보정 (Codex, `0d0f1ce`)
`ef64cb2`의 organic 패치는 그대로 유지하고, 최신 인계 기준에 맞춰 `PRODUCT_PARENTS`에 `요거트바`, `모나카`를 추가했다. 변경 파일은 `web/app/organic/page.tsx` 1줄뿐이며, `origin/main` 푸시 후 프로덕션 `influencer-seeding-mu.vercel.app` alias가 새 Ready 배포(`dpl_7UztUKhA7Y6Pu1ZT4sfxsgWTuF92`)를 가리키는 것까지 확인했다. GitHub Actions `Build Test (Pre-Deploy Check)` 성공. 기존 `C:/tmp/influencer-main`의 임시 organic 변경은 버려서 중복 커밋 위험 제거.

## 2026-07-15 교차-복사 오염 주간 스캔 자동화 (Codex)
`scripts/scan_cross_post_copies.py`를 GHA 출력/리포트 저장 가능하게 보강하고 `.github/workflows/cross-post-copy-scan.yml`을 추가했다. 매주 월요일 09:20 KST + 수동 실행 가능, DB는 read-only 조회만 하며 진짜의심 쌍이 있으면 Actions summary/artifact와 Slack DM(기본 `U0B2Y0ZC8QZ`, `vars.CROSS_POST_SCAN_SLACK_CHANNEL` 설정 시 해당 채널)에 알림. `run_monitoring.py` 영향 확인: 새 워크플로는 수집/적재와 분리되어 `MONITORING_DATE`, 자동종료, 업로드전 제외, 배너 reach 스냅샷 로직을 건드리지 않는다.

## 2026-07-14 📐 설계안: 안전한 양방향 동기화 (사용자 결정) → `DESIGN_oneway_db_source_of_truth.md`
근본원인=수기 시트(위치기반)+매일 양방향(import↔export)으로 오염이 왕복마다 번져 compound. **사용자 결정=양방향 유지(시트 입력 유지)하되 구조적 번짐 제거.** 대응: ①중복 날짜열 제거·정규화(날짜당 1열) ②import/export를 URL(행)+정규날짜(열)로만 매칭, 애매하면 skip+알림 ③복사-가드+수집대비 급변 알림+주1회 전수 스캔. 마이그: DB 1회 정리→시트 DB에서 재생성→키드매칭 배포→스캔자동화. 역할: Claude=DB정리+route 키검증/급변알림, Codex=배포+스캔GHA, 시트세션=중복열정리+열매칭정규화+시트재생성, 사용자=백업확인. 잔여리스크=사람 신규 오타/드래그는 조기감지(완전봉쇄는 단방향뿐, 미채택). **실행 전 Codex+시트세션 합의 필요.**

## 2026-07-14 organic 페이지 필터·성능 패치 커밋/배포 완료 (Claude가 Codex 작성분 이어받음, `ef64cb2`)
Codex가 `web/app/organic/page.tsx`에 패치 적용+tsc 통과했으나 사용량 제한으로 커밋 못 함(C:/tmp/influencer-main에 staged). Claude가 그 파일만 origin/main 위에 얹어 커밋·푸시(자동배포 success). vercel --prod 안 씀(main push=자동배포). 변경: 제품 변형 선택 시 상위라인 자동포함(PRODUCT_PARENTS/toggleProduct), productOptions·lastUpdatedAt useMemo, 썸네일 loading=lazy·decoding=async, 행 content-visibility:auto. diff 31/12, 그 외 변경 없음 확인.

## 2026-07-14 자동종료 규칙 재조정 — 무상시딩·500k 예외 제거 (Claude, 사용자 "3번만 적용", `c0af664`)
Codex reconcile(`4aa2124`)이 추가한 예외 중 **#1 무상시딩 전체 제외 · #2 누적 50만 예외를 되돌림**(사용자 지시). **#3 미반환 종료 제거는 유지.**
- `scripts/auto_end_rules.py`: `AUTO_END_EXCLUDED_TERMS`=위성채널·온드미디어만(무상시딩 제거), `HIGH_METRIC_THRESHOLD`(500k) 삭제.
- 결과 규칙: 배너·피드·캐러셀 age>7(8일째) / 그외(영상·무상시딩 영상 포함) age>14(15일째) / 캡션 키워드 / 제외=위성채널·온드미디어. **무상시딩(피드)도 7일 종료**(사용자 원지시 "피드=7일" 복원). py_compile+규칙샘플 검증 통과.
- ⚠️ **reconcile apply는 아직 안 함(dry-run only).** 이 규칙변경으로 dry-run 재분류가 달라짐(무상시딩 피드 age>7는 이제 to_end). 다음 GHA 일일크론(run_monitoring)이 going-forward 자동 적용. 즉시 소급(retroactive) 종료/해제하려면 `reconcile_auto_end.py --apply` 별도 실행 필요(대량 DB ended_at 변경 → 사용자 승인 후). Codex 도메인이라 조율 요망.

## 2026-07-14 ✅ 최우선 4건 DB 정정 완료 (Claude, Codex 시트정정 `0410e13`과 쌍)
Codex 시트정정 4건의 **DB를 실측으로 맞춤**. 가짜 play만 null(좋아요·진짜 초기궤적 보존), 실측 세팅. 백업 `data/output/priority4-fix-20260714.json`.
- 한입혜원 `5b0dc48a`: 07-04~06 null, **07-07=8,833** → 증분 **1,036** ✓
- 투데이단 `1821f3d8`: 07-04~07 null, **07-08=781** → **336** ✓
- 니블이 `5ac1df57`: 06-30~07-06 null(68,207=행 복사), **07-07=45,996** → **4,439** ✓
- 행 `cf90bfb8`: 07-06~12 null, **07-13=72,984** → **4,777** ✓
- **DB 증분 4건 모두 Codex 시트 J readback과 정확 일치 → DB·시트·대시보드 정합.** 남은 클러스터는 동일 방식(Codex 시트→Claude DB).

## 2026-07-14 🚨 미러링/종료 클러스터 오염 마스터 리스트 (Claude) → `HANDOFF_cluster_contamination_20260714.md`
- DB 전수 스캔으로 **교차-복사 오염 ~14개 클러스터** 발견(대부분 07-07 종료·미러링). 각 멤버 라이브 재수집해 주인 확정 완료.
- 상세·정정 리스트·재발방지 프로세스 = **`HANDOFF_cluster_contamination_20260714.md`** 참조. 정기 스캔 스크립트 = `scripts/scan_cross_post_copies.py`(주1회 권장).
- ⚠️ 최우선(주인 없이 양쪽 대량 과대): **592,754**(투데이단 실제 781·한입혜원 8,833), **133,206**(니블이 45,996·행 72,984).
- 정정 원칙: **시트+DB 쌍으로**(매일 import가 DB 덮음, 복사-가드는 끝점/단일값 못 막음). 미측정 비움. 대부분 JD/미러링=Codex 도메인.

## 2026-07-14 자동종료 경계 +1일 (Claude, ⚠️run_monitoring=Codex 도메인)
사용자 지시 "8일째로" — 업로드일 제외 N일 = N일째까지 유지, N+1일째 종료. `run_monitoring.py` 종료 조건 `age>=7→age>=8`(배너·피드), `age>=14→age>=15`(영상). 미반환 7일·캡션 규칙 불변. `44b1410`, py_compile 통과, 다음 GHA 크론부터. (바로 아래 캐러셀 추가 항목의 후속 조정.)

## 2026-07-14 자동종료 7일 그룹에 캐러셀(피드) 추가 (Claude, ⚠️run_monitoring=Codex 도메인)
사용자 지시: 자동 종료 기준 = 업로드일 제외 14일(영상) / 업로드일 제외 7일(배너·캐러셀).
- 확인 결과 **기존 규칙이 이미 배너 게시+7 / 그외 게시+14 + 업로드일 제외**(age=오늘-업로드, 업로드일=age0). `run_monitoring.py`가 유일한 posted-기반 종료처(apify-webhook의 ENDED_DAYS=7은 '미반환 7일' 별개 규칙, 유지).
- **변경(1곳, `e44fc9a`)**: `run_monitoring.py` 자동종료 조건에서 7일 그룹을 `"배너" in ct` → `("배너" in ct or "피드" in ct)`로 확장. 캐러셀 식별 = 사용자 결정 "채널분류에 배너·피드 포함"(무상시딩 (피드)=캐러셀/피드 이미지). 영상 등 그외 14일 유지. py_compile 통과.
- 적용 시점: GHA 일일 크론(00시 KST) 다음 실행부터. 기존 피드 게시물 중 age≥7는 다음 런에 자동 종료됨(소급 DB 수정 안 함).
- ⚠️ Codex: run_monitoring.py는 Codex 도메인이라 사후 공유. 종료 규칙 추가 변경 시 조율.

## 2026-07-14 송이 시트 잔재 1칸 재확인 (Codex)

Claude request: delete only 송이 row 452 `7.7` cell value `816,015` from `[빙과] 마케팅_대시보드(실무용)_25.09~` / `콘텐츠 대시보드 연동`.

Codex readback:
- Target sheet metadata: `콘텐츠 대시보드 연동` sheetId `1937186871`.
- Header `BJ1:BQ1` = `7.7`~`7.14`; therefore requested cell is `BJ452`.
- `BJ452:BQ452` current values: `7.7`~`7.12` blank, `7.13=96,709`, `7.14` blank. `BJ452` is already blank, so no edit was performed.
- `J452` still displays `0`. Cause is not `BJ452`; row 452 still has earlier copied values in `6.20`~`7.3` (`778,695` through `807,530`). Do not clear these without explicit user/Claude approval because the latest request said "그 칸만" and "다른 칸·다른 행·DB 변경 없음".

## 2026-07-14 증분/종료 마무리 재확인 (Claude 시트세션 → Codex)

Claude sheet-session confirmation:
- `stats-for-sheet` `ended_at` is deployed and working on `-mu`; latest sheet export displayed `🏁 종료 게시물 종료일 이후 578칸 비움`, proving the API returned `ended_at` and the Apps Script end cap ran.
- Sheet `J` increment values are now written by `exportStats` as values, not a live array formula. Rule is the same as dashboard `safeIncrement`: latest metric minus previous MAX, first valid measurement = whole value, no fabricated values.
- `Combined_Sheet_AppsScript.gs` canonical version must retain the markers/policy around `endedByKey`, `endedCleared`, and `incWritten`. Do not overwrite with an older Apps Script file.

Codex recheck:
- Dashboard increment tooltip is already in main and deployed. Current `-mu` deployment logs show `Branch: main, Commit: 3ebc9e0`, build READY; this includes `d50a790`/`5686fbd` tooltip work.
- `web/app/monitoring/lib.ts` has `incrementTooltip` and `INCREMENT_HEADER_TOOLTIP`; `web/app/monitoring/components/PostsTable.tsx` uses them on the `증분량` header and value/blank cells.
- `wt-company` currently has no diff in `web/app/monitoring/lib.ts` or `web/app/monitoring/components/PostsTable.tsx`; the earlier "uncommitted tooltip patch" request is stale.
- Optional DB cleanup status: explicit example `띵크서울` `2026-07-08`~`2026-07-12=21,000` flat carry rows were deleted and readback verified earlier. Broad flat-carry cleanup remains unexecuted because it affects thousands of rows and needs explicit approval.

## 2026-07-14 송이 종결 + DB↔시트 정합 원칙 갱신 (Claude→Codex, Codex 재검증)

Supersedes/updates the older `5036fcc` 822,210 cluster note where 송이 correction was not yet executed.

송이 status:
- Claude handoff: 송이 DB copied rows 23개 삭제, real measured row `2026-07-13=96,709` inserted/manual, backup `songyi-fix-20260714.json`.
- Codex DB readback verified: 송이 post `b519bed1-15c4-4e93-bc65-6b9bdaeb6e8b` / `https://www.instagram.com/p/DZyzmiTB5i7/` now has exactly one `post_daily_stats` row: `measured_at=2026-07-13`, `play_count=96,709`, `manual=true`, `created_at=2026-07-14T08:04:25.230883+00:00`.
- Codex Sheet readback verified: `[빙과] 마케팅_대시보드(실무용)_25.09~` / `콘텐츠 대시보드 연동!BJ1:BQ452` has 송이 row 452 with `7/7=816,015`, `7/8`~`7/12` copied `822,210` cells cleared/blank, and `7/13=96,709`. J value currently displays `0` for that row because 7/7 remains higher than 7/13.
- Claude verified after importStats that `2026-07-13=96,709` stayed unchanged and `created_at` did not move. Treat 송이 as closed unless new evidence appears.

Core DB↔Sheet principle:
- DB-only correction is unsafe in the daily import environment. Dirty sheet cells can be re-imported and overwrite corrected DB values.
- `stats-import` copy guard blocks only repeated middle forward-fill/copy values that match another post for 2+ days. It does not reliably block start/end/single-point fake cells; a fake endpoint larger than the true value can also pass mono-guard as a normal increase.
- Therefore remaining 822,210/JD/P corrections must be done as a pair: clean the linked sheet cells first or at the same time, then correct DB, then run readback on both surfaces. DB-only correction is prohibited.

Open items:
- `자취생으로 살아남기` / `https://www.instagram.com/p/DYFBwz5GlJ7/` is a live magazine/non-video post with no real play_count metric. Codex DB readback still shows copied fake view series including `2026-07-09`~`2026-07-12=822,210`; likes `248` should be preserved. Do not null/delete DB first while sheet still contains the same fake endpoint, or importStats can reintroduce it.
- `오하루(IG)` still has 822,210 copied rows per Claude handoff and can act as a matching source that lets 자취생 copies pass guards. Coordinate sheet+DB cleanup order; do not treat 오하루 as the owner of 822,210.
- `라밍(카카오)` `2026-06-29=240,000` remains unverified because Kakao cannot be Apify-recrawled. Team must confirm the real Kakao value; do not invent.
- `2026-07-13` partial collection was 262/496 and should not be recrawled from 2026-07-14 afternoon data. It is partial real measurement, not proof of zero or a value to fabricate.

Production deploy verification:
- Vercel `-mu` deployment logs show `Branch: main, Commit: feb91e2`, build successful and Ready.
- Therefore production includes `529de5d` (manual view edit targets visible measured_at), `e484f13` (new-value hover explanation), and `c2b94e2` (manual collection defaults to todayKST while scheduled apify-collect remains yesterdayKST).

This is the shared source of truth for Codex, Claude, and any other AI session working on this project.

Rules:
- Read this file before changing code, Sheets, DB, Apps Script, or deployment.
- Do not rely on memory alone. Verify from code, DB, Sheets, deployment, or live UI before making factual claims.
- Update this file after meaningful changes: code commit, deployment, data correction, Apps Script change, or policy decision.
- Do not write secrets, tokens, service-role keys, cookies, or private credentials here.
- If a claim was not verified in the current session, mark it as unverified.

## 2026-07-14 web/ UI 수정 5건 배포 (Claude, 협찬시트 세션) — 전부 main 배포됨
사용자 요청 기반 대시보드 표시 수정. **표시층만 변경, 집계·DB·시트·수집 로직 불변.**
- `d846b3a` **조회수 열제목에 값 비침 해결**: `PostsTable.tsx` 조회수 데이터셀 wrapper가 `relative z-30`이라 sticky 헤더(thead z-30)와 z 동점 → DOM 뒤인 데이터가 헤더 위로 그려짐. `z-30` 제거(호버 툴팁 앵커 `relative`만 유지, 툴팁 자체 z-[80]). 로그인 브라우저(Claude-in-Chrome) elementsFromPoint로 재현·검증.
- `7186e86` **그래프 접기 시 상관분석·요일별/업체별 패널 함께 숨김**: `page.tsx`에서 두 패널을 `!chartCollapsed`로 게이팅(토글 상태 보존→재펼침 복원). 주별합계는 그래프 내부 모드라 자동 포함.
- `f20830b` **채널분류 필터 드롭다운 높이 확대**(`FiltersBar.tsx` 조회수… 채널분류 드롭다운만 `max-h-64→max-h-[480px]`): 항목 10개(전체+9종) 스크롤 없이. 업체명·PD 드롭다운은 스크롤 유지.
- `4bb276e` **채널분류 '위성채널' CHANNEL_TYPES 추가**(`lib.ts`): DB엔 위성채널 58건 정상 저장돼 있었으나 상수 누락으로 필터/편집 드롭다운에 안 뜸. (교훈: DB엔 있는데 드롭다운에만 없으면 프론트 상수 문제.)
- `b1c4cd0` **홈 월목표 카드**: 총 검색%가 소수(0.0011)로 뭉개져 "0.001" 표시 → 라벨에 %면 `(v*100).toFixed(2)+'%'`(0.11%). `monthly-goal` 라우트에서 "26.07" 월-헤더 잔재 행 필터. 검색당비용·인지조회비 소수점은 사용자 지시로 시트값 그대로 유지.
- (참고) `Combined_Sheet_AppsScript.gs` 고아 이력행 정리 함수(previewOrphanRows/deleteOrphanRows)는 **사용자에게 스탠드얼론 스니펫으로만 제공**, **wt-company 정본엔 미반영**. 연동시트 고아행=정상행의 중복 이력(메타 공백+날짜값만) 504건, DB/자동화 무해(URL 매칭이라 무시). 정본 편입 여부는 시트세션 판단.

## 2026-07-14 822,210 클러스터 원본 실측 확정 — 송이 hold 해제 (Claude→Codex)
- New evidence from Claude recrawl on 2026-07-14:
  - `이나(IG)` `/p/DYcKGVrzRgz` recrawl = `831,625` → `822,210` cluster original/owner. 이나 DB값은 정상으로 판단.
  - `송이` `/p/DZyzmiTB5i7` recrawl = `96,709` → DB/Sheet `822,210` is copied 이나 value, about 8.5x over-recorded. 송이 hold 해제; correction is now allowed.
  - `자취생으로 살아남기` `/p/DYFBwz5GlJ7` recrawl unavailable (`play=None`, deleted/private suspected) → true value unknown. Do not fabricate; leave last trusted value or require team confirmation.
- Sheet evidence rechecked by Codex after handoff:
  - `콘텐츠 대시보드 연동` row 452 (`송이`, `https://www.instagram.com/reel/DZyzmiTB5i7/`) currently has `BK=7.8: 816,015`, `BL:BP=7.9~7.13: 822,210`, `BQ=7.14 blank`.
- Safe correction policy:
  - Do **not** paste `96,709` across `7.9~7.13`; that would invent past daily measurements from a 2026-07-14 observation.
  - With DB credentials, back up then remove/replace copied contaminated 송이 rows. Store the real recrawl as a real measured row (`measured_at=2026-07-14`, manual/source note) or use an explicitly approved final-value date if the team decides one.
  - For Sheets, clear copied historical cells only together with DB correction and readback verification, to avoid reimporting contamination.
- Current blocker: this Codex environment has no `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `CRON_SECRET`, so DB correction was not executed in this session.
- **✅ EXECUTED by Claude (2026-07-14, 사용자 "송이 96,709로 정정해" 승인)**: 송이 `b519bed1` DB 23행(전부 이나 궤적 복사, 06-20 778,695~07-12 822,210) 백업 후 전체 삭제, 실측 1행 삽입. **날짜=07-13 선택**(사용자가 대시보드에서 보이게 하려는 의도 = '오늘 제외' 규칙상 07-14는 미노출이라 최종값 날짜를 07-13으로). 정지 게시물이라 07-13≈07-14, 값 96,709는 실측(과거 궤적 날조 아님). 백업 `data/output/songyi-fix-20260714.json`.
  - ⚠️ Codex 정책의 `measured_at=2026-07-14`와 다름(07-13 채택). 재론 시 사용자 의도(대시보드 노출) 우선으로 협의.
  - ⚠️ **시트 재유입 방지**: Codex가 찾은 송이 시트행(`콘텐츠 대시보드 연동` row 452, `BK=7.8:816,015`, `BL:BP=7.9~7.13:822,210`)을 비워야 importStats 때 DB로 안 돌아옴. 시트 정리 필요.

## 2026-07-14 콘텐츠 대시보드 연동 J열 증분값 수식 과부하 복구 (Codex)
- Sheet: `[빙과] 마케팅_대시보드(실무용)_25.09~` / tab `콘텐츠 대시보드 연동` (`gid=1937186871`).
- User issue: `J2:J1016`에 행별 증분 수식이 들어가 시트가 과부하되고 J열 증분값이 표시되지 않음.
- Action: Google Sheets API로 `J2:J1016`의 `userEnteredValue`를 삭제한 뒤, `J2` 한 칸에만 사용자 지정 증분 수식을 입력. J열 전체 채우기 금지 원칙 유지.
- Verification: `J2:J20`에는 J2 수식 1개만 남고, `J1000:J1016`은 비어 있음. `B2:C2`는 URL/채널명(`자취생으로 살아남기`) 존재, `K2:BW2`에는 일자별 누적값(예: 6.1=699000, 7.9~7.13=822210)이 존재. J2 표시값은 공란으로 읽힘(에러 아님; API `formattedValue/effectiveValue` 없음)이며 수식 원문은 유지됨.
- Follow-up: 전체 J열 증분은 수식 복사 대신 `exportStats`/값 쓰기 방식으로 채우는 것이 안전.

### ✅ 결론(Claude, Codex와 수렴): J열 증분 = exportStats가 '값'으로 기록 (라이브 수식 폐기)
- **라이브 배열수식 폐기 확정.** 이유: (1) 1016행 수식이 시트 과부하로 멈춤, (2) `LOOKUP(9.99E+307,…)` 수식이 실데이터에서 신뢰 불가 — Codex 확인대로 J2(자취생, K2:BW2에 822,210 등 데이터 존재)인데 수식 결과가 공란. Sheets의 LET-변수 배열 미확장(`ISNUMBER`/`COLUMN`)·LOOKUP 이진탐색 어긋남 등 함정 반복. **다시 J열에 배열수식 깔지 말 것.**
- **구현(완료, Claude)**: `Combined_Sheet_AppsScript.gs` `exportStats` 끝에 **증분값(J열) 값 기록** 추가. 규칙 = 대시보드 `safeIncrement`와 동일: 게시물 행의 날짜셀(일반=조회수, 배너=도달수)에서 **최신 유효값 − 이전 유효값 MAX**, 첫 유효측정=그날 전체(게시 후 7일 이내), 값 없음·고아 행=공란. 단순 좌→우 루프라 LOOKUP 함정 없음.
- **검증(Node, 실데이터)**: Ufo 52,858 · good_tip 69,032 · smile_papa 9,968 · 배너 맨투맨 도달수 16 · 이평 48 · 자취생(평평)=0. 대시보드 viewIncrement와 일치.
- **적용**: 대표님이 최신 정본 `.gs` 붙여넣기 + 📥 실행 → J열이 값으로 채워짐(수식 아님, 시트 안 멈춤). 매 📥마다 갱신. (J열은 이제 exportStats 소유 — 수식/수동값 넣지 말 것.)
- 위쪽 「J열 A수식」 관련 옛 기록(line 638 등)은 이 결론으로 대체됨.

## 🖱️ 2026-07-14 대시보드 '증분량' 열 툴팁 추가 (Claude 작성안 → Codex main 반영)
사용자 요청: 일자별 증감표 vs 대시보드 증분량의 차이를 증분량 열 제목·각 값 hover로 노출.
- `web/app/monitoring/lib.ts`: `incrementTooltip(post,s)`(해당 게시물의 '최신 mm/dd 값 - 직전 mm/dd 값 = 증분' 구체 계산 문자열) + `INCREMENT_HEADER_TOOLTIP`(열 정의 + 일자별표와 다른 이유) 추가.
- `web/app/monitoring/components/PostsTable.tsx`: 증분량 **열 제목**(점선밑줄+cursor-help, hover=정의) + **각 값 셀** 및 **'—' 셀**에 title(hover=구체 계산). 네이티브 title(기존 title 패턴), 로직·집계 불변.
- Codex 반영 범위: 위 표시 설명만 추가. `safeIncrement`, 집계, DB, 시트, API 로직 변경 없음.

## 🚨 2026-07-14 과대기록 전수 감사 + 재오염 메커니즘 발견 (Claude, A/B 감사 결과)

**과대기록 재수집 감사**(협찬·수집가능·manual play 122건 중 IG 102+YT 12 재수집, DB max vs Apify 실측):
- **과대(DB>실측×1.5) 18건** — 대부분 JD/P 종료 게시물, 실측의 2~780배 부풀림:
  - 투데이단 604,931/실측775(780x), 한입혜원 592,754/8,821(67x), 와뜨기YT 21,576/1,049(20x), 몽글 229,100/22,790(10x), 송이 822,210/96,574(8.5x), 별하 128,893/16,906, 아누누 672,577/90,455, 류라이YT 94,584/19,724, 오홀 212,917/48,519·493,331/141,209, 유베니 253,303/66,420, 준맛인스타 378,186/113,833, 라밍인스타 84,320/28,438, 하토토 284,847/96,661, 니블이 133,206/45,926, 행 153,837/72,809, 아하하 131,314/67,873, 오하루IG 822,210/465,643.
  - 과소(DB<실측, 종료후 성장=정상) 3건: 류라이인스타·떵개·하이태민. 매칭실패(삭제/수집불가) 19건.
- ⚠️ **재오염 확인(중대)**: Claude가 고쳤던 **준맛(인스타) 113,833 → 시트 재동기화로 322,112/378,186 원상복구됨.** 투데이단도 재오염. = **DB만 고치면 시트 재import(importStats)가 되돌림.** 시트가 소스라 시트의 틀린 값 남으면 매 동기화마다 DB 재오염.
- 복사-가드(c53889a)는 '복사'만 차단, **과대값(비복사, 예 준맛 322,112 유니크)은 못 막음** → 과대는 재수집 실측 대조로만 잡힘.
- ➡️ **필요 조치(소유 세션)**: (1) 위 18건을 **시트+DB 동시 정정**(시트세션+Codex). DB만 고치면 무의미. (2) 과대 재발방지 = 정기 재수집 감사(위 스크립트) 또는 run_monitoring에 'auto실측 << 저장manual' 알림(Codex). (3) 근본: 수동 트래킹 게시물의 과대 입력을 시트 입력 시점에 재수집 대조. 
- 감사 스크립트: `scratchpad/overrecord_audit.py`(읽기전용, 재사용 가능).

## 🔒 소유권 / Ownership (파일 충돌·덮어쓰기 방지 — 2026-07-14)
여러 세션이 동시에 같은 파일을 덮어써 작업이 사라지는 문제 방지. **각 영역은 지정 담당만 수정·배포한다. 남의 영역을 건드리기 전 이 파일 확인 + 담당 세션에 `send_message`.**
- **콘텐츠 대시보드 Apps Script (`Combined_Sheet_AppsScript.gs`) · 연동 시트(gid=1937186871)** → **Claude(협찬 시트 세션) 담당.** 정본 = `wt-company/Combined_Sheet_AppsScript.gs`. ⚠️ 다른 세션이 옛 버전 붙여넣기 금지 — 가드 3종([고아 행 skip]·[오늘/미래 date>=today 안 채움]·[빈칸검사 업체명 제외])이 3회 사라진 사고 있었음.
- **`scripts/run_monitoring.py` · DB(`post_daily_stats`) 정정 · main 브랜치 배포 · 수집 파이프라인(`apify-webhook`/`collect-now`/크론)** → **Codex 담당.**
- **웹 대시보드 (`web/`)** → 변경하는 세션이 이 파일에 먼저 기록 후 진행(선점).
- 공통: 변경 전 이 파일 읽기 → 후 기록. 데이터 정정은 백업 + 읽기검증 필수.

## 🔧 2026-07-14 종료 게시물 '종료-후 값 복사(ffill)' 차단 — A안 (Claude 시트세션, ⚠️Codex 배포 필요)

**문제**: `exportStats`(역채움)가 **종료 게시물의 종료일 이후 날짜칸에도 마지막 값을 복사(ffill)** → 종료 후엔 실측이 없는데 값을 지어냄 = **절대규칙 위반.** 예: 띵크서울(종료 07-07) 07-13에 21,000 복사, 다음 날 J(증분)가 이 가짜값을 base로 읽어 틀어짐. 오전에 고친 건 '수집 자체 차단'(collect-now/webhook)뿐, **역채움 ffill은 미차단**이었음.

**A안 = 2곳 수정 (사용자 승인 "A로 코디해서 제대로 고쳐")**:
1. ✅ **[Claude 완료] `Combined_Sheet_AppsScript.gs` `exportStats`** (정본 `wt-company/`): 게시물별 `ended_at`을 받아, `date > ended_at` + **실측(collected) 없는** 칸을 처리 — ① 빈칸=이어받기 안 함 ② 숫자가 **직전값과 동일**=과거 carry 잔재로 보고 **비움**(`endedCleared`) ③ 숫자가 **직전값과 다름**=팀이 시트에 직접 넣은 실제/수동값으로 보고 **보존(안 지움)**. ⚠️ 이래서 종료-후 팀 수동입력·API 누락값을 **파괴하지 않음**(초기 '무조건 비움' 버전의 데이터파괴 버그를 재검증 중 잡아 수정). `collected>0`(자연님식 재수집 실측)은 이 블록 안 타고 정상 반영. `ended_at` 없으면(API 미배포) 캡 미적용=기존 동작(안전). 결과창 `🏁 종료 게시물의 종료일 이후 날짜칸 N개를 비웠습니다`.
2. ⏳ **[Codex 필요] `web/app/api/sponsored-posts/stats-for-sheet/route.ts`**: 응답 post에 `ended_at` 추가(아래 diff). **이거 배포돼야 위 .gs 종료캡이 실제로 작동.** ⚠️ **post-ended stats를 API에서 필터링하지 말 것** — 자연님식 종료-후 실측(manual)까지 사라짐. `ended_at` 필드만 추가하고 판단은 .gs가 함.

```
// (1) select에 ended_at 추가
.select("id, url, posted_at, channel_type, ended_at")
// (2) 맵 추가 (urlById 옆)
const endedByUrl = new Map<string, string>();
//     루프 안:
if (p.url && p.ended_at) endedByUrl.set(p.url as string, String(p.ended_at).slice(0, 10));
// (3) 최종 응답에 ended_at 포함
const posts = [...byUrl.entries()].map(([url, stats]) => ({ url, ended_at: endedByUrl.get(url) ?? null, stats }));
```

3. ⏳ **[Codex 선택/후속] DB `post_daily_stats` '종료-후 평평 carry행' 정리**: 띵크서울 07-08~12=21,000처럼 종료일 이후 DB에 남은 평평행은 `collected>0`이라 위 .gs 캡으로 **안 지워짐**(시트에 계속 뜸). 이 DB행을 삭제하면 다음 📥 때 종료캡이 비워 완전 정합. (증분 0이라 무해하지만 규칙상 fabricated. 백업+읽기검증 후.)

**순서**: (a) Codex가 route.ts 배포 → (b) 사용자가 최신 정본 .gs 붙여넣기 + 📥 → 종료캡 작동해 종료-후 carry 청소. (.gs는 지금 붙여넣어도 안전 — API 전까진 기존 동작, 오늘캡 7.14 청소는 즉시 됨.)

## 2026-07-14 라밍(틱톡) 과대 기록 정정 + 과대값 감지 사각지대 (Claude)

- 증상: 라밍(틱톡/미러링) 실제 8,721인데 DB엔 07-01부터 62,583→109,940(**7~13배 과대**), 전부 manual=True(수동 오입력). 감지가 못 잡음 — 기존 감지는 **하락·복사만** 보고 **"실제보다 높게 박힌 과대값"은 안 봄**(과대는 재수집 실측과 비교해야만 잡힘).
- 정정(재수집 실측 기준): Apify 재수집 `playCount=8,721`. 과대 07-01~07-12(62,583~109,940) 12행 삭제, 실제 조기값 06-28~30(3,301/3,852/4,588) 유지, 재수집 실측을 07-13=8,721로 기록(전일귀속). 백업 `raming-tt-over-delete-20260714.json`. 값 안 지어냄(실측만).
- **틱톡 협찬 8건 전수 재수집 감사**: 과대는 **라밍만**. 나머지는 실측이 오히려 높음(류라이·오하루·이나·톡톡시아·준맛 — 종료 후 성장, 정상) 또는 일치(프롬서희). 시으니네=수집불가(민감).
- ⚠️ 근본: 수동 입력(manual)이 mono 가드 우회 + 실제 검증 없음 → 실제보다 높은 값도 그대로 저장·유지(역행 clamp가 auto 실측을 오히려 무시). 과대 재발방지는 **재수집 실측 대조**가 유일 — 미해결(아래 제안).

## 🚨 절대 규칙 — 데이터 무결성 (ALL AIs MUST FOLLOW, 사용자 명시 지시 2026-07-14)

**실측이 없으면 값을 지어내지 않는다. (No fabricated data — ever.)**
- 조회수/도달수 등 지표는 **실제 수집(Apify 등) 또는 팀이 실제로 본 값**만 DB·시트에 들어간다.
- 값이 없거나 수집 불가(예: 틱톡 민감영상 POST_SENSITIVE, not_found)면 **비워둔다(측정 없음=공백).** 마지막 실측값을 복사해 채우거나(carry-forward를 실측인 척 저장), 다른 게시물 값을 붙이거나, 추정치를 지어내지 **않는다.**
- 이상치(누적 하락, 종료-후 급증 등)는 **자동으로 값을 고치거나 지어내 보정하지 않는다.** 감지는 **알림만** 하고, **사람이 실제 값으로 정정**한다.
- ⚠️ **빈 값(측정 없음)을 0으로 읽지 말 것.** 공백은 "데이터 없음"이지 "조회수 0"이 아니다. 0으로 취급하면 증분·누적이 깨진다(safeIncrement·dailyTotals·집계 전부 null/미존재를 0이 아닌 '기여 없음'으로 처리).
- 위반 사례(교훈): Claude가 시으니네(틱톡) 07-12를 실측 없이 249,508(07-08 값 복사)로 "정상화"함 → 가짜 데이터, 즉시 되돌림. 앞으로 금지.

## 2026-07-14 틱톡 민감영상 수집불가 + 수동 누적하락 오기 (Claude)

- **이나**: 사용자 지시로 **종료 유지**(성장 중이어도 게시+14일 자동종료 규칙대로) — 조치/규칙변경 안 함.
- **시으니네(틱톡) 수집불가 원인 확정**: TikTok이 영상을 **민감성 콘텐츠**로 분류 → Apify `clockworks/tiktok-scraper`가 `error:"Post is sensitive content.", errorCode:POST_SENSITIVE` 반환. 코드·URL 문제 아님(플랫폼 제한). 07-08 실측(249,508)에서 정지. note의 POST_SENSITIVE 정확(액터 errorCode). 대응: 민감영상=수동 트래킹.
- **시으니네(틱톡) 처리(사용자 승인 A안 = 지어내지 않기)**: 처음 07-12를 249,508(07-08 값 복사)로 "정상화"했으나 **가짜 데이터라 되돌림**. 최종: **수집 불가 기간(07-09~)은 공백** — 07-09/10/11(carry 249,508)·07-12(58,300 오기) **4행 삭제**, 실측 ≤07-08(227,309/240,811/249,508)만 남김. 백업 `siwoonine-tt-carry-delete-20260714.json`. (07-08 이후는 민감영상이라 실측 없음 → 비워둠. 팀이 실제 본 값 생기면 그때 입력.)
- **근본 원인**: 자동수집엔 역행 clamp 있으나 **수동 입력(manual=true)은 mono 기준선 리셋(2722cf4)**해 감소 검증 우회. 틱톡 민감영상처럼 수동 강제 시 오타가 그대로 통과 → 누적 깨짐.
- **재발방지(`44ecdfe`, 차단 아님)**: `notify_status` 6번 체크 = **누적 조회수 하락 감지**(마지막<직전 최대). 수동 하락 전부/자동 5%초과만(미세 재집계 제외). 사람이 오기 vs 정당 하향정정 판단(준맛식 정정도 있어 차단 안 함).

### 누적 하락 4건 조사·처리 (Claude, 2026-07-14, 재수집 실측 기준·값 안 지어냄)
- **시으니네(인스타)**: 07-06=402,745 = 이나 유튜브 값 복사(07-13 생성) **가짜** → 삭제. IG 재수집 실측 211,481로 실제 시계열 191,980~211,235 확인. 백업 `drops-fix-20260714.json`.
- **찐빵만두**: 07-06~12=47,099(7행) 수동 오기(실측 59,741·직전 56,260보다 낮음) → 삭제. 실측 ≤07-05=56,260 유지. 백업 동일.
- **이나(유튜브)**: YT 재수집 실측 **255,214**인데 저장 시계열이 308k~438k로 **전부 실측 초과**(유튜브 감소 불가→전부 과대). 07-06=402,745는 시으니네IG와 동일 복사값. = Codex 07-13 JD 백필 오염과 동일 뿌리, 시계열 전체 얽힘 → **Codex 도메인으로 이관**. 처리 완료 아래 참고.
- **라밍(카카오숏폼)**: 06-29=240,000(수동) vs 자동 65,000/67,000. **카카오=Apify 재수집 불가**라 실측 확인 불가 → 값 안 지어냄. **팀이 카카오에서 실제 값 확인 필요.** 미처리.
  - ⚠️ 추가 발견(시트): 연동시트 라밍 카카오 행 7.6~7.13에 **몽글 값(195,200/217,400/222,300…)이 수동 오입력**돼 있음(DB엔 없음, 실제 라밍≈7.2만). exportStats는 URL 매칭이라 오정렬 아님 — **사람이 시트에 몽글 열을 잘못 붙여넣은 것**, exportStats가 "수동값 보존" 원칙대로 안 덮고 유지·ffill함. **팀이 시트 그 셀들 정정 필요**(제가 시트 못 씀).

### 자연님 최종 조회수 정정 (Claude, 2026-07-14, 사용자 지시·실측)
- `자연님`(협찬 인플루언서/P혼, `/p/DZMmCGJphXR/`)은 **07-07 자동종료**돼 DB가 15,786(07-07)에서 정지 → 실제(인스타 1.7만)와 벌어짐.
- IG 재수집 실측 **17,274**(=1.7만, 사용자 스크린샷 일치) → **07-13에 17,274 기록**(전일귀속, manual). 백업 `data/output/jayeon-fix-20260714.json`.
- 종료 상태 유지(최종값 = 17,274). ⚠️ 시트 자연님 행이 옛 값이면 exportStats(📥 수집 조회수 시트로 채우기)로 맞춰야 시트=DB 일치.

### 수동 조회수 편집 규칙 정합화 (Claude, 2026-07-14, web/)
- 사용자 규칙 확정: **대시보드 수동 수정=화면에 보이는 그 날짜(보통 어제) 값으로 고정**, **자정 수집은 계속하되 값이 수동값보다 낮아지지 않음(≥)**, 더 높게 수집되면 갱신.
- **Part 2(자동≥수동)는 이미 구현됨** — run_monitoring.py:198-202 mono-guard(직전 저장값보다 낮으면 clamp). 변경 없음(수집=Codex 도메인).
- **Part 1 수정(web/)**: `patchPlayCount`가 `measured_at` 없이 저장 → DB 최신행(오후 수집으로 생긴 '오늘 미노출' 행 가능)을 덮던 문제. 편집이 **화면의 `s.measured_at`을 정확히 겨냥**하도록 수정(page.tsx `patchPlayCount(postId,value,measuredAt)`, PostsTable 호출부 `s?.measured_at`). 낙관적 UI 갱신도 편집 날짜 기준(오늘 태깅 시 '오늘 제외'로 사라지는 것 방지).
- **툴팁 문구 정정**: 기존 "밤 자동수집은 이 값을 덮지 않습니다"(부정확) → "그 날짜 값 고정, 자동수집은 계속되나 이 값보다 낮아지지 않고 더 높으면 갱신".
- ⚠️ 이 규칙은 Codex의 **수집 날짜귀속 변경(오후 수집→오늘 미노출)** 과 맞물림. 오늘행이 생기는 전제에서 편집 겨냥이 정확해야 하므로 두 작업 정합 확인 필요.

### 정합성 알림 손질 (Claude, 2026-07-14, 재수집 실측 기준)
- **썰박스(유튜브) 수동 과대 2건 삭제**: `2_d_oC-gx5I` 06-08=11,000(실측 1,173), `o8PpgHmLyyQ` 06-15=2,011(실측 1,512). YT 재수집으로 실측 확정 후 과대 수동행 삭제. 백업 `integrity-cleanup-20260714.json`.
- **시으니네(인스타) 07-06=402,745 재삭제**: 이나 유튜브 값 복사(실측 211k). ⚠️ **앞서 삭제했는데 시트 재import로 되돌아왔음** → **시트 시으니네IG 07-06 셀(402,745)을 지워야 안 돌아옴**(복사-가드는 단일값이라 못 막음). 시트 정리 필요.
- **미처리(도메인 밖)**: 라밍(카카오 06-29=240,000, 자동 65k/67k와 배치 — 카카오 재수집 불가, 팀 확인) / 송이·자취생 822,210(JD 822,210 클러스터 = Codex 메모 대조) / 07-13 부분수집(261/496, 수집 미완 = Codex/재수집).
- ⚠️ 공통: 삭제한 수동 과대값들이 **시트에 남아 있으면 다음 동기화 때 재유입**. 아래 시트 정리 목록 참조(시트세션/팀).
  - 시트 정리: 썰박스 `2_d_oC-gx5I` 06-08칸(11,000), 썰박스 `o8PpgHmLyyQ` 06-15칸(2,011), 시으니네IG 07-06칸(402,745) → 비우기.

### 재발방지 — 복사 유입 방지 가드 (Claude, `c53889a`, 배포됨)
- `stats-import`에 **복사 유입 차단**: 시트→DB 입력값이 '다른 게시물의 같은 날짜 값과 **2일 이상** 일치'(=시리즈 복사)면 그 행 **저장 안 함**(DB·대시보드 오염 원천 차단). 단일 우연 일치는 통과(오탐 최소화).
- 스킵분은 **여믄봇(`notifyBot`, `93c54e5`)으로 알림** → 사람이 시트 확인·정정. 응답 `copy_suspected_skipped`.
- 알림 대상 규칙(`web/lib/slack.ts` `notifyBot`): **STATUS_USER(황경원 DM) 우선 → SLACK_CHANNEL(리포트 채널) → SLACK_WEBHOOK_URL(웹훅) 폴백.** thread_ts 미사용(새 메시지로 노출). ⚠️ 여믄봇 DM이 실제로 가려면 **Vercel env에 STATUS_USER(또는 SLACK_CHANNEL)** 필요 — 없으면 웹훅으로 폴백.

### 이나(유튜브) JD 백필 오염 처리 (Codex, 2026-07-14)
- Target: `이나 (유튜브/미러링)`, `https://www.youtube.com/shorts/14NN3A0vRDE/`, post_id `eeae1521-ebb2-4e10-9ea8-1052d5c924d7`, row 202 in `콘텐츠 대시보드 연동`.
- Verified current Apify recollect at 2026-07-14 11:20 KST: play_count `255,228`, likes `2,000`, comments `34` (run `vht3SHAa0oF4syHj5`, dataset `EfUZDqxazx22ydeF0`). This confirms stored `308,807`~`438,733` values are impossible overcounts, not valid historical cumulative counts.
- DB backup: `C:/tmp/ina-youtube-jd-pollution-cleanup-20260714.json`.
- DB correction: deleted only impossible over-actual rows `2026-06-30`~`2026-07-11` where play_count exceeded `255,228`; preserved `2026-07-12 = 250,000`; inserted verified recollect as `2026-07-13 = 255,228` under the monitoring previous-day attribution rule. Did not invent intermediate daily values.
- Sheet correction: `콘텐츠 대시보드 연동!BC202:BN202` cleared, `BO202=250,000` preserved, `BP202=255,228`, `BQ202` blank(today cap).
- Readback verification: DB now has only `2026-07-12=250,000`, `2026-07-13=255,228`, impossibleCount `0`; Sheet readback `BC202:BQ202` = 12 blanks, `250,000`, `255,228`, trailing today blank.

## 2026-07-14 monitoring date attribution fix (Codex)

Problem verified:
- Scheduled GitHub/Vercel collection paths already use collection-date minus 1 day:
  - `.github/workflows/cron-daily-collect.yml`: `date -d 'yesterday'` -> `MONITORING_DATE`.
  - `.github/workflows/monitoring-retry.yml`: `date -d 'yesterday'`.
  - `/api/monitoring/apify-collect`: `yesterdayKST()`.
- The 2026-07-14 rows came from a manual dashboard monitoring job, not the scheduled collector:
  - recent job `56865f7c-2122-430b-903c-2532ccf0cf57`, `user_email=hwangkw@lalasweet.kr`, `created_at=2026-07-14T00:15:11Z`, `saved=186`.
  - It started `/api/jobs` monitoring without `measuredAt`; `/api/apify-webhook` fell back to `todayKST()`, creating `measured_at=2026-07-14`.

Code change:
- `/api/jobs` monitoring now passes `measuredAt=yesterdayKST()` to the monitoring webhook.
- `/api/apify-webhook` monitoring fallback changed from `todayKST()` to `yesterdayKST()`.
- `/api/monitoring/collect-now` default changed from KST today to `yesterdayKST()`; explicit `?date=YYYY-MM-DD` still overrides.
- This is not a broad one-day shift of all data; it only aligns no-date monitoring collection entrypoints with the existing scheduled collector rule.

DB correction:
- Backup: `C:/tmp/relabel-20260714-to-20260713-backup.json`.
- Dry-run before correction: `2026-07-14` rows `186`; all `186` had a `2026-07-13` target row; `0` rows had a lower 7/14 metric than 7/13.
- Applied: updated the 186 existing `2026-07-13` rows with the 7/14 source values, preserving existing/manual target rows' manual flag; deleted the 186 duplicate `2026-07-14` rows.
- Readback: `remaining_2026_07_14 = 0`, `target_rows_after = 271`.

Verification:
- `npm.cmd test`: passed, 27 tests.
- `npx.cmd tsc --noEmit --incremental false`: passed.

## 2026-07-14 JD/P post-ended copied-growth cleanup (Codex)

Policy alignment:
- Do not re-add a hard `post_ended` write/display block. Latest shared policy is detection + source correction because a post can still grow after tracking ended.
- Existing `aaa8ede` Slack integrity check remains the recurring backstop for copied post-ended values.

DB cleanup performed:
- Backup: `C:/tmp/jd-post-ended-copy-cleanup-20260714.json`.
- Deleted 33 verified copied-growth rows from `post_daily_stats`; readback after delete found `0` remaining deleted ids.
- Removed:
  - `smile_life_s2` JD banner `/p/DZPX8iKCYKx/`: 27 rows, ended `2026-06-10`, copied value `40,511` from source `/p/DZhMG8tGgzg/`; prior max before/end `21,884`.
  - post `5ac1df57-236e-49da-b196-51b67079ba79` (`/p/DZCdCIGy0SA/`): 5 rows, ended `2026-07-07`, copied values from source `/p/DaFWfmKxGFj/` and related rows; prior max `133,206`.
  - post `5b0dc48a-e347-4a54-9fda-7b4f0e1f0ede` (`/p/DZpf4SuJS_Z/`): 1 row on `2026-07-08`, copied value `604,931` from source `/p/DZ9WqkhpjpA/`; prior max `592,754`.

Remaining review candidates after cleanup:
- post `b519bed1-15c4-4e93-bc65-6b9bdaeb6e8b` (`/p/DZyzmiTB5i7/`) and post `d40746e5-713f-4108-96d5-ea2ecc0107e7` (`/p/DYFBwz5GlJ7/`) rows with `822,210`: true owner still needs memo/JD candidate report comparison.
- post `b9afa0c9-ef70-4ce2-8260-57953a82b5e4` (`/p/DZC0onTuJ-p/`) post-ended growth: same-date same-value source not found.
- Single-row small banner candidates remain: `dolkki_daily`, `mamy014`, `smile_papa_s2`, `yes__jam_`.

Verification:
- Supabase read-only candidate scan before cleanup found 11 JD/P post-ended growth candidates; after deleting the 33 confirmed copied rows, 8 review candidates remain.
- No code was changed or deployed by Codex in this cleanup commit.

Last updated: 2026-07-14 KST (Codex: stats-for-sheet 배너 reach export 보완 + DB 잔존 검증)

## 2026-07-14 종료-후 복사 오염 전수조사 + 가드 (Claude)

증상: 협찬(인플루언서)+DB(듬뿍바) 필터·기간필터 없음인데 종료 게시물 증분이 큼(합계 +132,728).
원인: **종료 게시물에 라이브 게시물의 누적 시계열이 복사된 오염**(JD 7/12와 동일 메커니즘). 종료일 이후 measured_at 행에 다른 게시물 값이 박혀 safeIncrement가 가짜 성장을 증분으로 읽음.

전수조사(종료후 성장 + 타 게시물 동일값=복사 확정):
- **DB(듬뿍바) 4건 — 삭제 완료(2026-07-14, 사용자 승인)** — 톡톡시아(유튜브)←복득이, 톡톡시아(틱톡)←셍이, 뭐랭하맨(인스타)←셍이, 준맛(인스타)←슈기. 종료 07-07, 종료후 07-08~12행 **14행 삭제**(백업 `data/output/db-pollution-delete-20260714.json`). 읽기검증: 4건 종료후 0행, 실제 마지막값(50,610/94,584/164,000/322,112)으로 복귀.
  - 준맛(인스타) 07-06·07-07 정정 완료(2026-07-14, 사용자 승인 ②): Apify 재수집 실측 `play_count=113,833`. 07-06=139,577·07-07=322,112 **둘 다 실측 초과(부풀림)** → 둘 다 `113,833`으로 UPDATE(백업 `data/output/junmat-fix-20260714.json`). 결과 시계열 07-05=101,805→07-06=113,833→07-07=113,833(단조·실측 일치). 원인: mono 가드가 낮아진 실측을 못 내려 부풀림 굳음.
  - ✅ DB뷰(협찬인플+DB딸키혼) 무필터 증분 합계: **132,728(전부 아티팩트) → 222**(종료 게시물 정상적으로 ~0). 사용자 최초 질문 "종료인데 증분 큼" 완전 해소.
- **JD/P 상품 5건 = Codex 도메인(JD 7/12 정정)** — 아직 미정리:
  - `smile_life_s2`(JD망, 종료06-10, **28행**, 복사원 요매거진)
  - `니블이`(JD멜, 5행, 복사원 행)
  - `송이`(JD멜, 4행) / `자취생으로 살아남기`(P혼, 4행) — 둘 다 822,210 공유(오하루(IG)·이나와도). **누가 진짜 주인인지 메모(JD_candidate_report) 대조 필요 → 함부로 삭제 금지.**
  - `한입혜원`(JD멜, 1행, 복사원 투데이단) — Codex가 앞서 일부 지웠으나 잔존.
- 의심(종료후 성장, 동일값 없음) 12행: 몽글(JD멜 217,400~229,100), yes__jam_·mamy014·dolkki_daily 등 소액 — 검토 필요.

재발방지(배포됨) — ⚠️ 접근 전환:
- 처음 `stats-import`에 post_ended 차단 가드(`b75ad66`)를 넣었으나 **철회(`4579532`)**. 이유(사용자 지시): 종료 게시물도 알고리즘 유입으로 조회수가 실제로 다시 오를 수 있어 **강제 차단은 정상 성장까지 막음**. 문제의 본질은 "종료후 행 존재"가 아니라 "남의 값이 복사됨"이고 URL 매칭은 정상 → 코드 매칭 버그 아님(소스 값이 틀림).
- 대신 **복사 감지 알림**(`aaa8ede`, 차단 아님): `notify_status._integrity_lines` 5번 체크 — 종료일 이후 값이 종료전 최대 초과 + (날짜,값)이 타 게시물에도 존재 = 복사 신호를 일일 Slack에 노출(사람이 소스 정정). 라이브 검증: 남은 JD/P 5건 정확 감지. 정상 성장은 통과.
- provenance(created_at): 오염행들은 07-10~13(정정/백필 기간)에 늦게 쓰임 → 상시 일일수집 버그 아니라 **수동 정정·백필 시 misroute**. 정정 작업자 주의 + 위 감지가 백스톱.
- ⚠️ 남은 재발경로 점검 필요(Codex 조율): run_monitoring/apify-webhook/collect-now도 종료후 성장행을 쓸 수 있는지, 표시층 safeIncrement가 measured_at>ended_at 성장행을 무시하도록 할지.

### 추가 정리 — 톡톡시아(릴스) 잔존 4행 삭제 (Claude, 2026-07-14, 사용자 승인)
- `톡톡시아(릴스)` DB혼 `/p/DZwvpIzpPiH/` (종료 07-07): 종료-후 4행 `07-09~12 = 54,400/83,600/84,100/84,100`(= 프롬서희 TT 시계열 복사) 삭제. 읽기검증: 종료-후 0행, 마지막=07-07 **212,917** 복귀. 백업 `data/output/del-toctoc-reels-20260714.json`.
- ⚠️→✅ **감지 5번 사각지대 해소**(`844f38e`): '종료후>종료전 최대'(상향만) → '종료후 행이 자기 carry 값이 아닌데 (날짜,값)이 타 게시물에도 존재'(상향+하향)로 변경. carry-forward 평탄행 제외로 오탐 최소화. 하향 복사(톡톡시아 릴스 54,400<212,917 유형)도 이제 잡힘.
- 개선 감지 라이브 전수 결과(2026-07-14 기준): 남은 종료-후 복사 **3건뿐** — 송이·자취생으로 살아남기(둘 다 822,210, 오하루(IG)/이나와 공유 → 메모 대조로 진짜 주인 확정 필요), smile_life_s2 1행(07-06=40,511←요매거진). 전부 Codex JD/P 도메인. DB(듬뿍바)·준맛 계열은 정리 완료.

## 2026-07-14 stats-for-sheet 배너 export 보완 (Codex)

Reason:
- Claude's banner rule is correct: banner daily metric must be `bannerDailyMetric(s) = reach_count ?? play_count`.
- One related path was still missing in `origin/main`: `web/app/api/sponsored-posts/stats-for-sheet/route.ts` exported only rows with `play_count > 0`.
- After the 2026-07-14 data correction, banner `play_count` is intentionally null, so DB→linked-Sheet export must read banner `reach_count`.

Changed:
- `stats-for-sheet` now loads `channel_type` and returns:
  - banner: `reach_count ?? play_count`
  - non-banner: `play_count`
- Upload-date guard remains unchanged: stats before `posted_at` are still dropped.

Verification:
- `npm.cmd test`: passed, 27 tests.
- `npx.cmd tsc --noEmit --incremental false`: passed.
- `npm.cmd run build`: passed.
- Live Supabase readback: banner posts `288`; banner daily rows with `play_count > 0` = `0`; banner daily rows with `reach_count > 0` = `3,789`.

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

## 2026-07-14 J열 '증분값' A수식 + exportStats 가드 3종 (Claude)

배경: 사용자가 연동시트(`콘텐츠 대시보드 연동`, gid=1937186871)에 '어제 증분'을 **시트 수식(A)**으로 보이게 하고 대시보드(B=safeIncrement)와 사람이 대조하려 함(A↔B 더블체크). 진행 중 exportStats forward-fill 오염 2건 + 빈칸검사 오탐 발견.

### J열 증분값 수식 (A, 시트 셀에 입력 완료)
- J2:J1016 입력·검증 완료(오류 0 · 숫자 705 · 공란 310[고아152+어제데이터없음158]). 73행 양수검증 통과(438,406−404,145=34,261).
- 규칙 = 대시보드 `safeIncrement`와 동일: 어제(TODAY-1) 누적 − 직전 유효(>0) 누적, 첫측정=그날 전체, 없음/0=공란.
- ⚠️ 수식 주의: 범위는 **`$K:$BW`(날짜블록)만**. 시트 그리드는 HX(232열)까지라 `$IZ` 등 밖을 참조하면 배열계산 `#VALUE`. LET 안 IF-배열은 `MAX(ARRAYFORMULA((cond)*(v>0)*v))`로(LET에서 IF 자동배열 안 됨). `B`(URL) 가드로 고아행 자동 공란. 이 수식은 시트 셀에만 존재(gs 파일과 별개).

### exportStats 가드 3종 (`Combined_Sheet_AppsScript.gs`, ⚠️재배포 필요)
1. **URL 없는 '고아 행' 절대 안 건드림**(ffill로 숫자 옆번짐 차단) + `orphanRows`→🧟 경고. (현재 고아 약 152행)
2. **미래 날짜 방지**: `maxCollectedDate`(=수집일-1, 전일귀속) 이후 날짜칸은 채우지 않고 비움 + `futureCleared`→🗓️ 경고. (7.14~7.20 잘못 채워졌던 값은 재배포 후 exportStats 1회로 자동 정리)
3. **빈칸검사(`scanBlanks_`)에서 업체명 제외** — 선택항목이라 235 오탐 제거.

### 주의/재발방지
- ⚠️ 세션 간 `.gs` 덮어쓰기로 ①③가드가 한 번 사라졌다 재복원됨. **정본 = `wt-company/Combined_Sheet_AppsScript.gs`**, Apps Script엔 이것만 붙여넣기.
- ⚠️ gviz `out:csv`는 이 시트 일부 날짜열(AI~BO 등)을 **빈값으로 잘못 반환** → 시트 판독은 셀 직접 선택(수식입력줄)로. 시트 실제 크기 **HX×1016행**(CSV 캡션 줄바꿈으로 2648행 오독 주의).
- 미배포 상태: 사용자가 Apps Script 재붙여넣기+저장해야 ①②③ 적용. 배포 후 `📥 수집 조회수 시트로 채우기` 실행 시 🗓️/🧟 경고로 동작 확인.

Last updated: 2026-07-14 (Claude: J열 A수식 + exportStats 가드 3종[고아·미래·업체명])

## 2026-07-14 전일귀속 통일: run_monitoring 폴백 + 시트 캡 (Claude, 사용자 승인)

증상: DB에 `measured_at=7/14`(오늘) 자동수집 186행 존재(created 2026-07-14 00:16 UTC, manual=false). 사용자 규칙 = **새벽 수집분은 어제(수집일-1)에 귀속**.

진단(검증):
- 정규 새벽 크론 `cron-daily-collect.yml`은 `TODAY=$(date -d 'yesterday')`→`MONITORING_DATE=어제` 주입 → **이미 전일귀속 정상**.
- 7/14 anomaly는 크론(02:41 KST)이 아니라 **`MONITORING_DATE` 없이 낮(09:16 KST)에 돈 실행**이 `run_monitoring.py` 폴백(`KST 오늘`)을 타서 오늘로 라벨한 것.

변경 ①(run_monitoring, ⚠️ main 반영·배포 필요 = Codex 도메인): 44행 폴백을 **KST 어제**로.
```python
TODAY = os.getenv("MONITORING_DATE") or ((datetime.now(timezone.utc) + timedelta(hours=9)).date() - timedelta(days=1)).isoformat()
```
- 크론은 MONITORING_DATE 항상 주입 → **무영향**. 폴백(수동/로컬)만 어제로 → 오늘 라벨 재발 차단. 이중 밀림 없음.
- ⚠️ wt-company 파일에만 반영됨. **GHA는 main에서 실행** → Codex가 main 반영·배포·검증(py_compile/GHA) 해야 효력.

변경 ②(시트 Apps Script `Combined_Sheet_AppsScript.gs`, Claude 도메인): exportStats·importStats에 **"오늘(today) 이후 날짜칸 안 채움/안 보냄" 캡**(`date >= today` → 비움/스킵). 앞선 엔트리의 `maxCollectedDate` 기준은 **폐기**(DB에 오늘 실측이 있어도 시트엔 오늘 제외해야 하므로 `today` 기준으로 교체). → 시트/대시보드 표시를 '어제까지'로 일치.

7/14 anomaly 처리: 내일 새벽 크론이 7/14를 (어제로) 재수집하며 `upsert(post_id,measured_at)` 덮어써 **self-heal** 예상 → 별도 삭제 보류(대시보드는 오늘 제외라 현재도 화면 미표시). Codex 판단 요청.

Last updated: 2026-07-14 (Claude: 전일귀속 통일 — run_monitoring 폴백=어제[main 배포 대기] + 시트 exportStats/importStats today-캡)


## 2026-07-14 Codex: stats-import reimport pollution cleanup + guard

Context:
- Claude handoff said remaining post-ended copied-growth candidates should be 3, but live DB recheck found 9 because a later sheet import batch reinserted old dirty values.
- Reinsert signal: `post_daily_stats.created_at` around `2026-07-14T01:26:37Z/01:26:39Z`, all `manual=true`; 139 rows were `measured_at=2026-07-14`.

Code guard added:
- `web/app/api/sponsored-posts/stats-import/route.ts`
  - imports `yesterdayKST()`.
  - skips any sheet-import stat whose `measured_at` is later than yesterday KST.
  - response exposes `future_date_skipped` and sample rows.
  - skips non-banner repeated carry-forward values when the incoming value equals the previous stored/incoming value.
  - response exposes `repeated_carry_skipped` and sample rows.
- `web/app/api/monitoring/collect-now/route.ts`
  - manual collect-now excludes `ended_at` posts from routine scrape targets.
  - response exposes `ended_skipped`.
- `web/app/api/apify-webhook/route.ts`
  - monitoring webhook matching excludes `ended_at` posts, so stale Apify results do not attach to ended posts.
- `safeIncrement` was NOT changed. Post-ended real growth/corrections are still visible if intentionally present; routine collection/import pollution is blocked at source boundaries.

Sheet cleanup performed:
- Spreadsheet `10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak`, tab `콘텐츠 대시보드 연동` (`sheetId=1937186871`).
- Confirmed copied cells were changed back to their ended/carry cumulative values:
  - row 73 뭐랭하맨(인스타): `BM:BQ` -> `94,584`
  - row 133 니블이: `BK:BQ` -> `133,206`
  - row 160 smile_life_s2: `AN:BQ` -> `21,884`
  - row 292 준맛(인스타/미러링): `BM:BQ` -> `322,112`
  - row 361 한입혜원: `BK:BQ` -> `592,754`
  - row 446 톡톡시아(틱톡/미러링): `BM:BQ` -> `164,000`
  - row 447 톡톡시아(유튜브/미러링): `BM:BQ` -> `50,610`
- Readback verified the above exact ranges after write.

DB cleanup performed:
- Backup: `C:/tmp/db-reimport-pollution-cleanup-20260714.json`
- Deleted 158 rows from `post_daily_stats`:
  - 139 rows with `measured_at=2026-07-14`
  - 19 confirmed post-ended copied non-carry rows for the 7 sheet-cleaned posts above
- Readback verification after cleanup:
  - `measured_at=2026-07-14` count = 0
  - improved post-ended copied-growth detector count = 2

Remaining intentional hold:
- Do not touch without memo/JD_candidate_report confirmation:
  - 송이(JD멜) `/p/DZyzmiTB5i7/`
  - 자취생으로 살아남기(P혼) `/p/DYFBwz5GlJ7/`
- Both still show 822,210 on 2026-07-09~2026-07-12 shared with 이나/오하루. They are the only remaining detector hits after cleanup.

Verification:
- `npm.cmd test`: 27 passed.
- `npx.cmd tsc --noEmit --incremental false`: passed.

Last updated: 2026-07-14 (Codex: stats-import date/repeated-carry guard + sheet/DB reimport cleanup)

## 2026-07-14 Codex: run_monitoring fallback = yesterday KST

Request/source:
- Claude handoff asked Codex to apply the `run_monitoring.py` fallback date rule to main.
- Regular GHA cron already passes `MONITORING_DATE`, so this change affects only fallback/manual/local runs without `MONITORING_DATE`.

Code change:
- `scripts/run_monitoring.py`
  - changed fallback from KST today to KST yesterday:
    `TODAY = os.getenv("MONITORING_DATE") or ((datetime.now(timezone.utc) + timedelta(hours=9)).date() - timedelta(days=1)).isoformat()`
  - Reason: after-midnight monitoring collection represents the previous day's performance snapshot.

7/14 anomaly decision:
- Live DB readback after the prior cleanup: `post_daily_stats` rows with `measured_at=2026-07-14` = 0, and `manual=false` rows for that date = 0.
- Therefore no additional deletion/relabel was needed in this pass.
- If a future anomaly exists, prefer backup + exact readback before deleting; do not rely on self-heal assumptions without checking current DB.

Verification:
- Cache-writing `python -m py_compile scripts/run_monitoring.py` could not write `scripts/__pycache__` in this sandbox (`WinError 5`).
- Equivalent Python parser/compiler check without bytecode cache passed:
  `compile(Path('scripts/run_monitoring.py').read_text(encoding='utf-8'), 'scripts/run_monitoring.py', 'exec')`

Last updated: 2026-07-14 (Codex: run_monitoring fallback uses yesterday KST)

## 2026-07-14 Codex: JD 2026-07-13 dashboard delta cleanup

User target/context:
- User reported dashboard JD 2026-07-13 delta was 900,247, while the sheet subtotal they wanted to match was 770,810.
- Verified sheet `[빙과] 마케팅T 대시보드 (26.06~)`, tab `인지_쫀득바`, [row 111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=111:111):
  - [N111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=N111) total awareness views = 1,003,150.
  - 770,810 is not N111; it is [V111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=V111) + [AE111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=AE111) + [AH111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=AH111):
    - [V111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=V111) influencer sponsorship = 118,815
    - [AE111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=AE111) viral banner = 152,262
    - [AH111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=AH111) viral reels = 499,733

Actions completed with backups:
- Removed one DB-only duplicate banner post not present in linked sheet:
  - Deleted `sponsored_posts.id=8cee9f9e-feb4-4858-acc7-2fbe8f87e3b6`
  - URL `https://www.instagram.com/p/DaupIMrmv42/`
  - Also deleted its single 2026-07-13 `post_daily_stats` row, reach_count 39,953.
  - Kept the sheet-existing Ufo__RED row URL `DauuTX_mrVt` untouched: linked sheet `콘텐츠 대시보드 연동` [row 841](https://docs.google.com/spreadsheets/d/10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak/edit?gid=1937186871&range=841:841).
  - Backup: `C:/tmp/db-jd-ufo-red-duplicate-delete-20260714.json`
- Fixed Sieun TT cumulative baseline from linked sheet `콘텐츠 대시보드 연동` [row 815](https://docs.google.com/spreadsheets/d/10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak/edit?gid=1937186871&range=815:815) and `인지_쫀득바` [V111 memo](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=V111):
  - URL token `7659342828111269140`
  - Inserted 2026-07-12 play_count 38,300 manual=true.
  - Updated 2026-07-13 play_count from 58,400 to 58,300 manual=true.
  - This makes safeIncrement 20,000, matching the sheet memo intent.
  - Backup: `C:/tmp/db-jd-sieun-tt-cumulative-fix-20260714.json`

Verification:
- DB safeIncrement recompute after both fixes:
  - JD 2026-07-13 total = 821,894
  - by channel:
    - 바이럴 (배너) = 152,262
    - 바이럴 (영상) = 499,733
    - 협찬 (인플루언서) = 158,148
    - 위성채널 = 4,797
    - 온드미디어 = 2,566
    - 협찬 (먹스타) = 4,388
- Live dashboard verification after reload:
  - product filters JD망/JD멜/JD혼 active
  - date preset 전체 active
  - [live dashboard](https://influencer-seeding-mu.vercel.app/monitoring) daily table 2026-07-13 displayed +821,894

Remaining gap to user's 770,810 target:
- Current verified dashboard 821,894 - target 770,810 = 51,084.
- This is not a confirmed DB pollution total.
- It consists of:
  - 11,751 from channels included by dashboard JD product filter but not included in V+AE+AH sheet subtotal:
    - 위성채널 4,797
    - 온드미디어 2,566
    - 협찬 (먹스타) 4,388
  - 39,333 remaining influencer sponsorship difference:
    - dashboard DB/safeIncrement influencer total = 158,148
    - sheet [V111](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=V111) manual formula total = 118,815
- Do not force DB to 770,810 without per-post memo/source confirmation.
- Especially do not rewrite cumulative rows merely to match V111 formula if it would contradict real cumulative values.
- Example: Fromseohee TT has DB cumulative 84,800 -> 85,400, so safeIncrement 600. Sheet [V111 memo](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=V111) says "증분값 100", but changing DB cumulative to make 100 would distort the cumulative series unless the team confirms the 85,400/84,800 source is wrong.

Handoff rule for Claude/Codex:
- Any future sheet memo or sheet-based evidence in this project must include a direct Google Sheets hyperlink to the exact tab row/cell/range, e.g. `.../edit?gid=<sheetId>&range=V111`.
- Do not cite "sheet memo", "row", or "manual formula" without a link.
- If the evidence is absence from a sheet, link the searched sheet/tab and the closest positive control row/cell used for comparison.
- For the remaining JD 2026-07-13 gap, do not change DB solely to match 770,810. Only adjust when the linked cell/range proves the per-post cumulative value or the dashboard filter definition must change.

Last updated: 2026-07-14 (Codex: JD 7/13 duplicate banner cleanup + Sieun TT baseline correction)

## 2026-07-14 exportStats 역채움 수동값 보호 (Claude)

증상(사용자): 연동시트에 배너 도달수를 수동 입력하면 5분 내 다른 값으로 바뀜.
원인: `exportStats` 역채움의 `isBlank || isCarried` 분기 — 배너 도달수는 며칠 평평(동일)해서, 수동 입력값이 '직전값과 같으면' isCarried로 오인돼 DB collected로 덮임. Codex가 배너 reach를 stats-for-sheet에 추가한 뒤 배너 수동값이 이 역채움에 덮이기 시작.
수정(`f3a12e4`, git + 사용자 배포본 wt-company 동기): `if (isBlank)`로 축소 — 값 든 칸(수동/기존실측) 절대 안 덮고 빈 칸만 채움. CLAUDE.md 데이터무결성 규칙과 일치.
⚠️ Apps Script라 **시트 편집기 재배포 필요**(git·wt-company만으론 미적용). 사용자에게 안내함.
트레이드오프: 늦게 도착한 실측이 carry 칸을 자동 갱신하진 않음(빈 칸만) — 대시보드는 DB를 읽으므로 영향 없음(시트 표시만).

## 2026-07-14 Claude → Codex 인수인계 (겹침 주의)

**⚠️ 제가 방금 넣은 DB 값 — 재-공백/클로버 금지 (사용자가 '지금 기준' 실제 본 값으로 지시):**
- `이나(틱톡)` 7649387805159820565: **07-12 = 234,500** (오염 304,100 정정). 백업 `data/output/fix-ina-tt-20260714.json`.
- `시으니네(틱톡)` 7659342828111269140: **07-13 = 58,400** (오염 24만대 삭제). 백업 `fix-sieuni-tt-20260714.json`.
  - ⚠️ 앞 항목의 "시으니네 A안=공백"과 배치됨: 사용자가 이후 "지금 58.4K"라고 **실제 본 값**을 직접 줘서 입력함(=팀 실측, 규칙 부합). 공백으로 되돌리지 말 것. 단, 단일 점이라 대시보드에 첫측정 +58,400로 뜰 수 있음(정상 흐름 원하면 사용자 일별값 필요).
  - 이나(틱톡)도 07-11(189,840)→07-12(234,500) = +44,660으로 뜸(직전값이 낮게 잡혀 커 보임).

**제 코드 변경:**
- `b93fd4e` 리포트에서 종료 게시물 제외(notify_increments). 배포됨.
- `f3a12e4` exportStats 역채움 `isBlank`로 축소(수동값 보호). git+wt-company 동기. ⚠️ **Apps Script 시트 편집기 재배포 필요(미배포)** — 배포 전엔 미적용. Codex의 stats-import 복사유입가드(c53889a)와 방향 다름(상보적).

**핵심 발견 — IG 자동수집(캐러셀은 원천 불가):**
- IG "자동 6%"의 대부분은 **캐러셀(Sidecar) 게시물**. 인스타가 캐러셀 조회수를 공개 안 함 → apify/instagram-scraper·data-slayer·공개 웹 **셋 다 조회수 없음**(검증 완료). **릴스/영상은 정상 수집.** → IG 자동수집 "throttling 고치기/청크/폴백"은 캐러셀엔 무의미(긁을 값이 없음). 캐러셀은 수동 불가피 → 수동 안전화(위 exportStats 수정)가 정답.

## 2026-07-14 JD 유튜브 실측 채움 (Claude, 사용자 지시)

사용자 지시: "유튜브는 실제 데이터 수집해서 채워" / "배너·캐러셀 공란은 미수집(정상)" / "시트 첫-로그 덤프는 의도됨".
- JD 유튜브 10건 Apify 재수집(streamers/youtube-scraper) → **과대 오염행(재수집 실측 초과=불가) 82행 삭제 + 07-13=실측 채움**. Codex 이나-YT 방식과 동일. 백업 `data/output/yt-fix-20260714.json`.
  - 정정: 오하루(YT) 261,089→**119,495**(과대 16행), 썰박스 2건(2,011/11,000→1,512/1,173, 과대 29·36행). 채움: 가내수제업 158,716·냠냠 159,261·또호 63,637·밈튜브 4,054·이나 255,214.
- **JD 7/13 safeIncrement 총합 874,301→900,247**(YT 기여 34,198). 시트 7/13 1,003,150 대비 잔차 ~103K.
- ⚠️ **잔차는 대부분 데이터 공백이 아니라 basis 차이**: 시트 "인지 조회수"는 첫-로그 시 누적 전체 덤프(의도됨). 이미 오래 추적된 게시물은 대시보드가 그 덤프를 과거에 이미 했으므로 7/13엔 실제 일별증분만 뜸 → 시트(첫-로그 덤프)와 구조적으로 다름. **무리한 매칭은 값 지어내기라 안 함**(데이터무결성 규칙).
- ⚠️ 별개 발견: 썰박스(유튜브) 게시물 15개+ 중 다수가 평평(carry)값 — 수집기가 매일 안 긁는 듯. 커버리지 점검 필요(Codex/후속).

## 2026-07-14 Claude 이 세션 변경 공개 (소유권 공지 수신 후)

'Ad view tracking' 세션의 소유권 공지 확인. 앞으로 .gs/시트(gid=1937186871)·DB·run_monitoring·배포는 안 건드림. 이미 한 것 공개:

**.gs (소유: Ad view tracking 세션) — ⚠️ git 정합 필요:**
- exportStats 역채움 `isBlank||isCarried`→`isBlank` 수정(수동값 보호). **정본 wt-company엔 반영됨(고아 가드 등 3종 유지된 채)**.
- ⚠️ 그러나 `f3a12e4`로 **git origin/main의 .gs에도 push했는데, 그 git본은 '고아 행 skip' 가드가 이미 빠진 옛 버전**임(제 push 이전부터 누락, 제가 그 위에 얹음). → **git .gs를 Apps Script에 붙여넣지 말 것(정본=wt-company).** 소유 세션이 git .gs를 wt-company로 재동기화 권장. 원하면 Claude가 재동기화 도와줌(승인 시).

**DB post_daily_stats (소유: Codex) — 백업 있음, 재검토 요청:**
- 이나(틱톡) 07-12=234,500, 시으니네(틱톡) 07-13=58,400 (사용자 실측 지시값). 백업 fix-ina-tt/fix-sieuni-tt-20260714.json.
- JD 유튜브 10건: 과대 82행 삭제 + 07-13 실측 채움. 백업 yt-fix-20260714.json.
  - ⚠️ 이 중 **종료 YT 게시물(가내수제업·또호·냠냠·오하루·밈튜브) 07-13 채움이 7/13 증분을 ~26K 과다**하게 만듦(종료 게시물이 증분에 잡힘). 7/13 대시보드 900,247 vs 목표 770,810 과다의 일부. Codex가 활성 과대값 정리 시 함께 재검토 요망. (종료 포함 900,247 / 종료 제외 874,442 / 목표 770,810)

## 2026-07-14 git .gs 가드 재동기화 — 해결됨 (Claude, 사용자 승인)

앞서 공개한 "git origin/main .gs가 가드 3종 빠진 옛 버전" 문제 → **정본(wt-company)과 바이트 일치로 재동기화 완료**(`5d8ba53`).
- 복원된 가드: ①URL없는 고아행 skip ②오늘·미래(date>=today) 날짜칸 안채움 ③빈칸검사 업체명 제외. + isBlank 수동값 보호 유지.
- 검증: `git show origin/main:Combined_Sheet_AppsScript.gs`(CR제거) == wt-company(CR제거) 완전 일치.
- 이제 git본/정본 어느 걸 Apps Script에 붙여도 가드 동일(회귀 위험 제거). ⚠️ 단 실제 적용은 시트 편집기 재배포 필요.
- 이후 .gs/시트는 소유 세션(Ad view tracking) 소유 — Claude는 더 안 건드림.

## 2026-07-14 ended YouTube post-ended rows cleanup (Codex)

Claude handoff trace request checked against DB and current code.

Findings:
- Current productized collectors already exclude ended posts:
  - `scripts/run_monitoring.py`: builds `posts` with `not p.ended_at` before IG/YT/TT collection.
  - `web/app/api/monitoring/collect-now/route.ts`: `eligiblePosts` requires `!p.ended_at` and is IG-only.
  - `web/app/api/apify-webhook/route.ts`: monitoring `eligiblePosts` requires `!p.ended_at`.
- The 2026-07-14T02:54:42Z-02:54:43Z batch was 8 DB rows, matching the earlier "JD YouTube real recollect/fill" handoff, not the normal run_monitoring path.
- In that batch, only rows with `measured_at > ended_at` were invalid post-ended updates. Same-day ended row (`이나 YT`, measured_at=ended_at=2026-07-13) was not deleted.

DB action:
- Backup: `C:/tmp/ended-yt-post-ended-delete-20260714.json`
- Deleted 5 `post_daily_stats` rows where `measured_at=2026-07-13`, `manual=false`, created in the 02:54Z batch, and `measured_at > ended_at`:
  - `밈튜브` `https://www.youtube.com/shorts/CN_ES_pzGz4/` ended 2026-06-08, 2026-07-13 value 4,054.
  - `가내수제업` `https://www.youtube.com/shorts/XyxNWdZPgJc/` ended 2026-07-12, 2026-07-13 value 158,716.
  - `또호` `https://www.youtube.com/shorts/yjip4anczaw/` ended 2026-07-11, 2026-07-13 value 63,637.
  - `오하루(YT)` `https://www.youtube.com/shorts/TW0sMmr1XbY/` ended 2026-07-11, 2026-07-13 value 119,495.
  - `냠냠` `https://www.youtube.com/shorts/JTi0Tu42x4g/` ended 2026-07-07, 2026-07-13 value 159,261.
- Delete verification: re-read by deleted stat ids returned 0 rows.

Post-cleanup verification:
- DB safeIncrement recompute for `product_name like JD*`, date `2026-07-13`: 825,703.
- Remaining JD rows where `measured_at > ended_at` and contributing on 2026-07-13: 0.
- The remaining gap to target 770,810 is no longer from post-ended YT rows. It must be investigated in active or same-day-ended rows, not by re-deleting these five.

Notes:
- `밈튜브` still has invalid metadata shape: `ended_at=2026-06-08` is earlier than `posted_at=2026-06-11`. Do not auto-clear it without source confirmation because clearing `ended_at` would reactivate collection.
- Direct service-role/ad-hoc correction scripts can bypass app-route guards. For future one-off scripts, apply the same final predicate before upsert/delete decisions: skip stats where `post.ended_at` exists and `measured_at > ended_at`, unless the user explicitly confirms a backdated correction.

## 2026-07-14 Shugi 2026-07-06 manual typo cleanup (Codex)

Claude handoff request executed for DB-owned `post_daily_stats`.

Target:
- Post: `슈기` `https://www.instagram.com/p/Dach9JUR1iW/`
- Deleted row: `measured_at=2026-07-06`, `play_count=468,897`, `manual=true`, stat id `1e89d744-e0c0-4877-aab8-6e2d2a41faf7`.
- Reason: impossible cumulative inversion. The later current DB series is `2026-07-10=408,411`, `2026-07-11=418,385`, `2026-07-12=441,152`, `2026-07-13=467,448`; true 2026-07-06 value is unknown, so no replacement value was fabricated.

Backup and verification:
- Backup: `C:/tmp/shugi-20260706-manual-typo-delete-20260714.json`
- Delete verification: re-read by deleted stat id returned 0 rows.
- Current DB safeIncrement for 슈기 on `2026-07-13`: `467,448 - 441,152 = 26,296`.

Note:
- Claude's request text expected 2026-07-13 value `465,513` and increment `24,361`, but live DB at execution time had auto row `2026-07-13=467,448`; therefore the verified DB result is `26,296`.
- Sheet cleanup is separate sheet-owner work: clear the same polluted `468,897` cell(s) on the linked "콘텐츠 대시보드 연동" row, and if exact sheet/dashboard equality is required, refresh the 2026-07-13 cell from DB rather than hand-entering a guessed value.

Follow-up verification and sheet alignment:
- Google Sheet `[빙과] 마케팅_대시보드(실무용)_25.09~`, tab `콘텐츠 대시보드 연동`, row 820 (`슈기`) was updated after DB cleanup.
- Exact sheet range: [`콘텐츠 대시보드 연동!BI820:BP820`](https://docs.google.com/spreadsheets/d/10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak/edit?gid=1937186871&range=BI820:BP820).
- Cleared polluted `468,897` cells from `BI820:BL820` (`7.6` through `7.9`), kept `BM820:BO820 = 408,411 / 418,385 / 441,152`, and set `BP820` (`7.13`) to DB value `467,448`.
- Sheet formula readback: [`J820`](https://docs.google.com/spreadsheets/d/10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak/edit?gid=1937186871&range=J820) now displays `26,296`.
- Live dashboard readback from `https://influencer-seeding-mu.vercel.app/monitoring`: `슈기` row displays increment `+26,296` and cumulative views `467,448`.

## 2026-07-14 [Codex 확인요청] '인지 광고' 리포트 기능 — main에 있음, 프로덕션 배포 필요 (Claude)

여믄봇 리포트에 '인지 광고'(메타/틱톡/유튜브) 섹션 추가 완료 → **main `98917ab`**. (사용자 요청)
- 신규: `web/app/api/awareness-ads/route.ts`(시트 [인지_쫀득바] 일별 AK+AT/AN/AQ 조회수·왼쪽열 광고비 읽어 JSON, CRON_SECRET 인증) · `notify_increments.py`(섹션+총증분 합산, 빈칸=미입력 제외) · `daily-increment-report.yml`(APP_URL/CRON_SECRET 추가). 전부 추가형, 기존 시크릿 재사용.
- 검증: Python 문법·TS tsc·GHA Build Test 통과. 78f39znt9 빌드엔 라우트 포함 확인.
- ⚠️ **프로덕션(-mu)이 이 라우트를 아직 안 서빙**(`/api/awareness-ads`→404 /_not-found). 이 프로젝트는 Vercel 자동배포가 아니라 **수동 CLI 배포**(배포에 git meta 없음)이고, 카노니컬 repo가 지금 `refactor/monitoring-decompose`(미커밋 다수)라 Claude가 임의 배포 못 함(브랜치 오염/refactor 프로덕션 되돌림 위험).
- 🙏 **요청**: main을 프로덕션에 배포해 주세요(또는 refactor에 이 라우트 포함). refactor 머지 시 `web/app/api/awareness-ads/route.ts` 유지 필수(현재 refactor 기준 D로 표시됨=아직 없음).
- 배포되면 Claude가 `-mu/api/awareness-ads?date=` 확인 후 워크플로 미리보기(황경원 DM)로 렌더링 검증 예정.

## 2026-07-14 JD 2026-07-13 target 770,810 recheck (Codex)

User reported screenshots: live dashboard once showed `900,247`, sheet target showed `770,810`.

Current live dashboard verification:
- URL: `https://influencer-seeding-mu.vercel.app/monitoring`
- Filters clicked in Chrome: product chips `JD망`, `JD멜`, `JD혼`.
- Daily table readback: `2026-07-13 = +813,905`.
- Therefore the old `900,247` screenshot is stale after the ended-YT cleanup and Shugi cleanup.

Current sheet target verification:
- Spreadsheet: `[빙과] 마케팅T 대시보드 (26.06~)` / tab `인지_쫀득바` (`sheetId=1224959784`).
- User target `770,810` is still [`V111`](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=V111) + [`AE111`](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=AE111) + [`AH111`](https://docs.google.com/spreadsheets/d/1EITk9hxHPhJ07xvOlVL9kOdZXhthupRwfJLpIqIou2s/edit?gid=1224959784&range=AH111):
  - `V111 = 118,815`, formula `=90715+100+20000+8000`.
  - `AE111 = 152,262`.
  - `AH111 = 499,733`.
- Important conflict: `V111` note is stale after the verified Shugi correction. It still says `슈기 462,970 -`, while DB / linked sheet / live dashboard verified Shugi as cumulative `467,448`, increment `+26,296`.

Current difference:
- Live dashboard `813,905` - sheet target `770,810` = `43,095`.
- Do not force DB/dashboard down to `770,810` without per-post evidence. Doing so would undo at least the verified Shugi `+26,296` correction or distort other real cumulative series.
- Remaining basis mismatch to resolve with the user:
  1. If the sheet memo/formula is the authority, provide per-post cumulative evidence for the rows that should be reduced.
  2. If verified DB/linked-sheet/dashboard rows are the authority, update `인지_쫀득바!V111` target/memo to include Shugi and any other verified per-post deltas.
  3. Product-only dashboard filters include all JD product rows; `V111+AE111+AH111` is a subset comparison. Do not compare those two bases as if identical unless the intended channel categories are explicitly selected.

No DB or sheet values were changed in this recheck.

## 2026-07-14 manual over-record alert backstop (Codex)

Claude handoff item #5 implemented as code-only recurrence prevention. This does not change `safeIncrement`, does not lower stored values automatically, and does not fabricate replacements.

Changed paths:
- `scripts/run_monitoring.py`
  - Previous stat lookup now includes `manual`.
  - When fresh auto collection is far below the latest stored manual value (`observed <= stored * 0.8` and diff >= `1,000`), monitoring keeps the existing clamp behavior but records a "manual over-record candidate".
  - At run end, candidates are sent via Slack bot target (`STATUS_USER`/`SLACK_CHANNEL`) or webhook fallback. Alert text instructs sheet+DB correction together.
- `web/app/api/apify-webhook/route.ts`
  - Same over-record candidate detection added for dashboard/webhook monitoring path.
  - Lower auto values are still skipped as before; the new behavior is alert-only.

Verification:
- `web`: `npm.cmd test` passed (27 tests).
- `web`: `npx.cmd tsc --noEmit --incremental false` passed.
- Python syntax: `ast.parse(scripts/run_monitoring.py)` passed.
- `python -m py_compile scripts/run_monitoring.py` could not be used in this sandbox because writing `__pycache__` was denied, so AST syntax parse was used instead.

Data note:
- No DB or Sheet correction was executed in this step.
- The 18 over-recorded rows still require sheet+DB simultaneous correction; DB-only correction will be re-polluted by `importStats` if dirty sheet cells remain.

## 2026-07-14 production deploy: over-record alert + awareness route (Codex)

Main/deploy status:
- `fix(monitoring): alert on manual over-recorded stats` was pushed to `origin/main` as `935ef89`.
- `origin/main` then advanced to `c21d247` with Claude's docs-only 자연님 correction note; Codex fast-forwarded local source before deployment.
- Production deploy completed with Vercel deployment `dpl_HvrWCKS4mHYJgFTpJ3Gck49UfW4y`.
- Vercel inspect verified:
  - target: `production`
  - status: `Ready`
  - alias: `https://influencer-seeding-mu.vercel.app`
  - created: `2026-07-14 15:07 KST`

Verification:
- Pre-push hook ran `tsc --noEmit` and passed.
- Final local verification before push/deploy:
  - `web`: `npm.cmd test` passed (27 tests).
  - `web`: `npx.cmd tsc --noEmit --incremental false` passed.
  - Python syntax: `ast.parse(scripts/run_monitoring.py)` passed.
  - `git diff --check HEAD^ HEAD` passed.
- Vercel build output included `ƒ /api/apify-webhook` and `ƒ /api/awareness-ads`.
- Signed-out `curl` to `/monitoring` and `/api/awareness-ads` returns Clerk-protected 404 (`X-Clerk-Auth-Reason: protect-rewrite, dev-browser-missing`), so route availability must be verified with the proper browser session or `CRON_SECRET`.

Remaining blocker:
- This Codex environment has no `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `CRON_SECRET` in `.env.production.local` or scanned `C:/tmp/**/.env.production.local` files.
- Therefore the 18 over-recorded rows were not DB-corrected here. Do not invent replacement values. Correct only with per-post real measurement evidence, and correct linked sheet cells and DB rows together to avoid `importStats` re-pollution.

## 2026-07-14 stats-for-sheet ended_at export for sheet ffill cap (Codex)

Reason:
- Claude sheet session added an Apps Script exportStats cap that needs each post's `ended_at`.
- Without `ended_at`, sheet reverse-fill can carry the final cumulative value into dates after tracking ended, fabricating values in cells where there was no measurement.

Changed:
- `web/app/api/sponsored-posts/stats-for-sheet/route.ts`
  - `sponsored_posts` select now includes `ended_at`.
  - Response posts now include `{ url, ended_at, stats }`.
  - Post-ended `post_daily_stats` rows are not filtered in the API. This is intentional because manual post-ended real measurements can exist; Apps Script owns the judgment/cap.

Verification:
- `web`: `npm.cmd test` passed (27 tests).
- `web`: `npx.cmd tsc --noEmit --incremental false` passed.
- `git diff --check` passed.
- Local `npm.cmd run build` did not complete within 420s in this Codex shell; Vercel production deploy build should be used as the final build verification.

## 2026-07-14 manual collection date attribution rule (Codex)

User/Claude request:
- Scheduled dawn collection must remain previous-day attribution because it represents the prior day's final snapshot.
- Manual/weekly collection must default to same-day attribution so afternoon collection writes to today's hidden row instead of overwriting yesterday's visible final row.

Changed:
- `web/app/api/monitoring/collect-now/route.ts`
  - default `measuredAt`: `todayKST()` when no `?date=` is explicitly supplied.
- `web/app/api/jobs/route.ts`
  - dashboard monitoring jobs now pass `measuredAt=todayKST()` to the Apify webhook.
- `web/app/api/apify-webhook/route.ts`
  - monitoring webhook fallback is now `todayKST()` when neither `measuredAt` nor `date` is supplied.

Intentionally unchanged:
- `web/app/api/monitoring/apify-collect/route.ts`
  - still passes explicit `measuredAt=yesterdayKST()` for scheduled/Vercel cron collection.
- Display layer was not changed; dashboard and sheet export already hide/skip today.
- `safeIncrement` was not changed.

Verification:
- Grep confirmed the only remaining sponsored monitoring default `yesterdayKST()` in these web collection paths is scheduled `apify-collect`.
- `web`: `npm.cmd test` passed (27 tests).
- `web`: `npx.cmd tsc --noEmit --incremental false` passed.
- `git diff --check` passed.

## 2026-07-14 Claude handoff recheck: date attribution + 822210 cluster (Codex)

Latest-main check:
- Pulled `origin/main` through `1600388`.
- Confirmed `c2b94e2` date-attribution change is still present:
  - manual `collect-now`: default `todayKST()`
  - dashboard `/api/jobs` monitoring: passes `measuredAt=todayKST()`
  - `apify-webhook` monitoring fallback: `todayKST()`
  - scheduled `apify-collect`: still explicit `yesterdayKST()`
- Confirmed Claude's edit-targeting change (`529de5d`) is present:
  - `PostsTable.tsx` passes visible stat date `s?.measured_at` to `patchPlayCount`.
  - `page.tsx` sends `{ play_count, measured_at }` and optimistic UI updates the same visible date.

Verification:
- `web`: `npm.cmd test` passed (27 tests).
- `web`: `npx.cmd tsc --noEmit --incremental false` passed.

Sheet evidence checked:
- `[빙과] 마케팅T 대시보드 (26.06~)` / `인지_쫀득바!V111` note is not enough to resolve the cluster; it still contains stale-looking values such as `슈기 462,970 -` and old 이나 YT/TT memo values.
- Linked sheet `[빙과] 마케팅_대시보드(실무용)_25.09~` / `콘텐츠 대시보드 연동`:
  - `자취생으로 살아남기` row 2 (`https://www.instagram.com/p/DYFBwz5GlJ7/`) has `7.8=816,015`, `7.9~7.13=822,210`.
  - `송이` row 452 (`https://www.instagram.com/reel/DZyzmiTB5i7/`) has the same `7.8=816,015`, `7.9~7.13=822,210`.
  - `오하루(인스타)` row 705 (`https://www.instagram.com/reel/DaDMoGqBS0Z/`) has the same `7.8=816,015`, `7.9~7.13=822,210`.
  - `이나` row 22 has a one-day `7.9=822,210` spike while adjacent values are `15,786`, also suspicious.
- Local dump `current_jd_20260713.json` confirms:
  - `송이` rows `2026-07-09`~`2026-07-12 = 822,210`, `manual=true`, created `2026-07-13T01:49:38Z`.
  - `오하루(IG)` rows `2026-07-09`~`2026-07-12 = 822,210`, `manual=true`.
  - `자취생` is P-domain and not present in that JD-only dump.

Conclusion:
- Do **not** delete or rewrite the 822,210 cluster yet. The value is clearly duplicated across multiple rows, but the true owner cannot be proven from the checked memo/sheet/dump alone.
- Existing shared status also lists `오하루IG 822,210/실측465,643`, so treating 오하루 as the source would be unsafe without a fresh source measurement or the missing `JD_20260712_candidate_report.md`.
- This Codex environment still has no `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `CRON_SECRET`, so DB correction and explicit `collect-now?date=2026-07-13` partial recrawl were not executed.
- Important after date-attribution change: dashboard "manual collect" now defaults to today, so repairing the `2026-07-13` partial collection requires an explicit dated trigger, e.g. `collect-now?date=2026-07-13` with `CRON_SECRET`, not the normal button.

## 2026-07-14 [Codex 재배포요청] 인지광고 라우트 Clerk 공개 누락 수정 (Claude)

Codex 배포(dpl_HvrWCKS...)에 `/api/awareness-ads`는 포함됐으나, **Clerk 미들웨어 공개목록에 없어** 미인증/CRON_SECRET bearer 요청이 `/_not-found`(404, `protect-rewrite`)로 막혔음(리포트가 시트값 못 읽음).
- 수정: `web/middleware.ts` isPublicRoute에 `"/api/awareness-ads(.*)"` 추가 → **main `224eee5`**. (kpi/fetch 등과 동일 패턴, 라우트 자체가 checkCronAuth 인증)
- 🙏 **요청**: main 한 번 더 프로덕션 배포 부탁드립니다. 배포되면 `-mu/api/awareness-ads`가 미인증 시 404→**401**로 바뀜(=공개 통과) → Claude가 워크플로 미리보기로 검증.
## 2026-07-14 Codex 마무리 확인: ended_at 배포, 툴팁 배포, 종료후 flat carry DB 정리

Production/code verification:
- `influencer-seeding-mu.vercel.app` Vercel inspect: READY deployment `dpl_AsCzMyQm7BENunXA5Aza4dB18VZj`, created `2026-07-14 17:18 KST`, alias includes `https://influencer-seeding-mu.vercel.app`.
- `web/app/api/sponsored-posts/stats-for-sheet/route.ts` includes `ended_at` in sponsored_posts select and returns `{ url, ended_at, stats }`. API does not filter post-ended stats; Apps Script owns the cap.
- `web/app/monitoring/lib.ts` and `web/app/monitoring/components/PostsTable.tsx` include the increment header/value tooltip code from `d50a790`.

DB cleanup:
- Read-only audit found post-ended flat-carry candidates where `measured_at > ended_at` and the current metric equals the last positive metric on/before `ended_at`.
- Initial audit: `2,372` rows across `409` posts. Backup/candidate report: `C:/tmp/post_ended_flat_carry_candidates_20260714.json`.
- Narrow executed cleanup only for the explicitly cited example:
  - `띵크서울` / `P혼` / `https://www.instagram.com/p/DYJ23mzk_p2/`
  - `ended_at=2026-07-07`, carry `21,000`
  - deleted `2026-07-08`~`2026-07-12` five rows from `post_daily_stats`
  - backup/readback: `C:/tmp/ttingkeu_flat_carry_delete_20260714.json`
  - post-delete readback: remaining target rows `0`
- Re-audit after deletion: `2,367` rows across `408` posts, `띵크서울` example no longer present.

Important:
- Broad deletion of all `2,367` remaining rows was not executed because it is a large destructive DB operation. It needs explicit user approval after reviewing the candidate report.
- This cleanup does not fabricate values. It only removes exact post-ended flat carry rows; any post-ended growth/changed value remains untouched.

## 2026-07-14 Codex: 자동수집 동작 검증 + 부분수집 재발방지 보강

Evidence checked:
- GitHub Actions `cron-daily-collect.yml` recent runs are succeeding. The 2026-07-14 05:41 KST run targeted `MONITORING_DATE=2026-07-13` but skipped because the old check only required some rows + YouTube presence.
- GitHub Actions `monitoring-retry.yml` run `29322880030` detected the partial 2026-07-13 state: `today=263 base=505 complete=False yt_ok=True`, then ran `scripts/run_monitoring.py` with `MONITORING_DATE=2026-07-13`.
- That retry run collected active posts only: `추적 게시물: 285개 (종료/업로드전 제외 589개)`, saved `270건`, and completed successfully.
- `origin/main` code check:
  - scheduled GitHub `run_monitoring.py` still writes to yesterday via `MONITORING_DATE`.
  - `run_monitoring.py` fallback is also KST yesterday.
  - manual `collect-now`, dashboard `/api/jobs`, and `apify-webhook` fallback use `todayKST()`.
  - scheduled `apify-collect` remains explicit `yesterdayKST()`.

Change made by Codex:
- `.github/workflows/cron-daily-collect.yml` now uses the same partial-collection completeness check as `monitoring-retry.yml` before deciding to skip:
  - count non-null `play_count` rows for target day.
  - compare against the max of the previous 3 days.
  - if target day is below 60% of that baseline, treat as `missing` and run full collection.
  - YouTube presence check remains.

Status:
- The scheduling/date-attribution path is fixed and the 2026-07-13 partial collection was caught by retry and re-run.
- This workflow change closes the remaining weak spot where the main early-morning backup windows could skip a partially collected day.
- `safeIncrement`, dashboard display rules, and sheet export rules were not changed.

Follow-up correction before final push:
- The first completeness check copied from `monitoring-retry.yml` used all `post_daily_stats.play_count` rows for the previous-day baseline. That over-counts because ended/pre-upload posts are excluded from the actual collector.
- Codex corrected both `.github/workflows/cron-daily-collect.yml` and `.github/workflows/monitoring-retry.yml` to calculate completeness only for the same eligible set the collector uses:
  - `not ended_at`
  - `posted_at <= target measured_at` when posted_at exists
  - `play_count is not null`
  - chunked `post_id in (...)` counts to avoid broad-table baseline drift
- This prevents the retry loop from comparing active collection size (~285 active posts on 2026-07-13) against stale historical totals (~505 rows including ended posts).

## 2026-07-14 Codex: 자동 종료 규칙 재정의 + 전체 재분류 준비

User rule, treated as canonical from this point:
- Upload day excluded 14 days => video auto-end after those 14 days are complete (15th day, `age > 14`).
- Upload day excluded 7 days => banner/carousel(feed) auto-end after those 7 days are complete (8th day, `age > 7`).
- Satellite channel, owned media, and free seeding are excluded from date-based auto-end.
- If `content_summary` caption contains `삭제`, `보관`, or `종료`, auto-end.
- If cumulative metric is >= 500,000, do not auto-end by age.

Implementation:
- Added `scripts/auto_end_rules.py` as the single rule helper:
  - caption keyword wins first.
  - then excluded channel/project/product => keep active.
  - then metric >= 500,000 => keep active.
  - then age threshold by channel type (`age > threshold`, not `age >= threshold`).
  - banner/feed/carousel use 7 days; everything else uses 14 days.
- Updated `scripts/run_monitoring.py` to use this helper and removed the hidden runtime effect of the old "missing for 7 days" auto-end rule.
- Updated `web/app/api/apify-webhook/route.ts` so a missing scraper row no longer auto-ends a post.
- Added `scripts/reconcile_auto_end.py` and `.github/workflows/auto-end-reconcile.yml` for full DB classification:
  - dry-run writes `data/output/auto-end-reconcile-YYYY-MM-DD.json`.
  - apply sets `ended_at=target_date` for `end` and clears `ended_at` for `clear`, then readback-verifies.

Verification before DB run:
- `python ast.parse` syntax check passed for `auto_end_rules.py`, `reconcile_auto_end.py`, and `run_monitoring.py`.
- `web`: `npx.cmd tsc --noEmit --incremental false` passed.
- Workflow YAML parsed successfully.
- Rule sample check passed: 8th-day banner ends, 15th-day video ends, 500k keeps active, free seeding keeps active, caption keyword ends even if otherwise excluded/high.

Execution:
- Dry-run GitHub Actions run `29326888092` (`target_date=2026-07-14`, `apply=false`) classified all `878` sponsored posts:
  - `to_end=0`
  - `to_clear=51`
  - `keep_ended=538`
  - `keep_unended=289`
  - clear reasons: excluded channel/project/product (`39`), high metric >= 500k (`12`).
- Apply GitHub Actions run `29326984870` (`apply=true`) executed the same plan:
  - updated `51` rows by clearing `ended_at`.
  - readback: `checked=51`, `end_failed=0`, `clear_failed=0`.
- Final verification dry-run `29327057969` after apply:
  - `to_end=0`
  - `to_clear=0`
  - final classification: `keep_ended=538`, `keep_unended=340`.

Conclusion:
- As of `2026-07-14`, DB `sponsored_posts.ended_at` is reconciled to the canonical auto-end rules above.
- No stats rows were fabricated or edited; only post tracking status (`ended_at`) was changed.

## 2026-07-15 [점검요청] 시트→DB 분류 동기화(syncAll)가 리포트 전에 매일 도는지 (Claude → 시트/Codex)

증상: 여믄봇 증분 리포트에 '미분류 +대량'(07-14 118만, 총 75%). 원인=계산 버그 아님, **타이밍 레이스** — 신규 게시물은 밤 수집으로 조회수가 먼저 잡혀 리포트에 카운트되나 `channel_type`은 시트→DB `syncAll`(Apps Script→/api/sponsored-posts/bulk, 하루 1회)로 늦게 채워짐. 동기화가 리포트(12:20)보다 늦게 도는 창에 리포트가 돌면 DB `channel_type=None`→'미분류'로 몰림. (그날은 syncAll이 뒤늦게 돌아 active JD 미분류 159→0 자가해소, 바이럴(영상)으로 재분류 확인.)
- Claude 조치(main `9395757`): 리포트에 **미분류 증분>0이면 ⚠️ 경고 자동표시**(감지·표면화, 재배포 불필요).
- 🙏 요청: **syncAll(시트→DB 분류 동기화)이 매일 12:20 리포트 *이전에* 실제로 도는지** 점검. 현재 시트 Apps Script 시간트리거 의존(깨지기 쉬움, 과거 '재배포 필요' 이력). 안 돌고 있으면 트리거 재설정 또는 리포트 직전 동기화 보장. (Apps Script=Ad view tracking, bulk/pipeline=Codex 영역이라 소유 세션에 요청.)

## 2026-07-15 [기준 확정] 증분 리포트 '어제 확정치' 안정성 (Claude, 사용자 승인)

"어제자 증분이 자동으로 바뀌면 안 된다"에 대한 정본:
1. 자동수집(`run_monitoring`)은 `measured_at=수집일(오늘 KST)`로만 기록(line 44·114). **과거(어제) 날짜 행 자동 생성·수정 없음.** (역방향 baseline=0 자동추가는 2026-07-08 제거됨 → 어제행 자동기록 경로 없음.)
2. → 어제 확정 증분은 **자동수집으로 안 흔들림.**
3. 어제 값 변경 = **사람 수동입력뿐**(배너 도달수·시트 일자별 조회수 입력/정정, 전부 manual=True). 배너는 자동수집 불가라 하루이틀 늦게 들어옴=정상. (검증: 07-14 행 306개 중 당일 새로 꽂힌 8개 전부 manual, 자동 0. 총증분 +145K 증가는 배너 도달수 수동입력이 거의 전부. 재분류는 총합 불변.)
4. 채널 정규 리포트=하루 1회(DEDUP)=발송 스냅샷. 발송 후 수동입력 들어와도 채널 메시지 자동 갱신 안 됨.
- 🙏 Codex 확인요청: run_monitoring·수집 파이프라인이 **과거 날짜(measured_at<오늘)를 자동으로 쓰는 경로가 없는지** 유지·확인(위 기준의 근거). 백필/재수집 라우트에 날짜 인자 줄 때만 과거 기록되게(자동 스케줄은 오늘만).

## 2026-07-15 [데이터 정정요청] 온드미디어 게시물에 광고비 15만원 오입력 (Claude → 시트/팀)

온드미디어(무상이어야 함)인데 CPV가 잡혀 확인 → **`lm_not_sweet_`(instagram.com/p/DaU0qpGooCH/, 게시 2026-07-03)에 cost=150,000원**이 들어가 유일하게 CPV(0.3원) 발생. 비용 출처=연동 시트→DB 동기화라 **DB만 고치면 다음 syncAll이 되돌림.** 연동 시트에서 이 게시물 비용을 0/공란으로 정정해야 함(진짜 무상이면). 정정 후 리포트에서 온드미디어=무상 복귀.

## 2026-07-15 [규칙+정정요청] 온드미디어·위성채널 = 무상(광고비·업체명 금지) (Claude, 사용자 지시)

규칙: 온드미디어·위성채널은 광고비(cost)·업체명(company_name)이 없어야 함.
- 리포트 조치(main `ff4a611`, notify_increments): 온드/위성은 CPV에서 광고비 무시(항상 '무상'), cost>0·company_name 있으면 `⚠️ 온드/위성 오입력 N건` 리포트 경고.
- 🙏 **시트 정정요청(팀/시트 소유)**: 아래 활성 게시물의 **업체명**을 연동 시트에서 삭제(DB만 고치면 syncAll이 되돌림). 2026-07-15 위반 6건: 위성 `썰박스(틱톡)`='썰박스', `썰뜨기(틱톡)`='썰뜨기', `썰뜨기(유튜브)`='썰뜨기', `썰박스(유튜브)`='썰박스'; 온드 `lm_not_sweet_`='아택'·'업크루'. (온드 lm_not_sweet_ 15만원 cost는 이미 0으로 정정됨.)

## 2026-07-15 [정정] 증분 리포트 안정성 기준 #1 수정 (Claude, 사용자 지적)

앞 항목(88cf20b)의 "자동수집은 measured_at=수집일(오늘)로만 기록, 과거 날짜 자동생성 없음"은 **틀림 — 정정.**
- 실제: **일일 자동수집은 KST 자정직후(cron 00:41 KST) 실행, `measured_at = 수집일-1 = 어제(KST)`로 기록.** (`cron-daily-collect.yml` line55·94 `kdate=date -d yesterday`, run_monitoring MONITORING_DATE=kdate. UTC밀림 방지 위해 KST어제로 통일.) 예: 07-15 00:41 수집 → **07-14 데이터 생성**. 실측: measured_at=07-14 자동 252행이 전부 07-14T16 UTC(=07-15 01시 KST) 생성(총306=자동252+수동54).
- 따라서 리포트 대상 '어제'는 **오늘 새벽 자동수집이 1회 확정** → 리포트(12:20)가 읽음. 이후 그 날짜는 자동 재기록 안 함(다음날 새벽은 -1을 찍고, 같은날 백업은 DEDUP). 자동확정 이후 변경은 **수동입력만**. 오늘치는 내일 새벽에야 기록됨.
- Codex 확인요청 수정: run_monitoring이 과거를 '안 쓴다'가 아니라 **자정직후 수집일-1(어제)로만 쓴다**가 정확. 백필/재수집만 임의 과거 날짜. 이 동작 유지 확인 부탁.

## 2026-07-15 ⚠️ [Codex 확인요청·시급] b50b201(수집=오늘 스탬프) ↔ 리포트(어제 타겟) 정렬 어긋남 우려 (Claude)

Codex `b50b201`이 자동수집 measured_at을 '어제(수집일-1)'→'KST 오늘(수집일)'로 바꿈. 취지(어제 확정치 자동변경 방지)는 이해하나, **리포트 대상일과 하루 어긋나 보임.** (내 앞선 "자동=어제 기록" 정정 노트는 b50b201 이전 코드 기준이라 폐기.)

근거(리포트는 여전히 어제 타겟 + 라벨기반 증분 = measured_at==target − 직전유효):
- 수집 cron=00:41 KST → 캡처 누적 ≈ **직전일 끝**.
- 신로직(오늘 스탬프): `label-07-14` 행 = 00:41 07-14 수집 = end-07-13. `label-07-13` = end-07-12.
- 리포트 어제=07-14 → `end-07-13 − end-07-12 = 07-13 성장분`을 "07-14"로 표시 → **하루 밀림.**
- 구로직(어제 스탬프): `label-07-14` = 00:41 07-15 수집 = end-07-14 → `07-14 성장분` 정상(기존 대시보드=리포트 검증도 이 기준).

→ 제안: 수집을 오늘 스탬프로 유지하려면 **리포트/증분 소비 측 대상일도 '수집일(오늘)'로 함께 이동**해야 정합. 아니면 수집을 원복(어제 스탬프)하되 '어제 확정치 안정성'은 기존 DEDUP+새벽1회수집으로 이미 확보됨(백업창은 skip). 어느 쪽이든 **수집·리포트를 한 세트로 맞춰야** 함 — Codex와 합의 필요. 오늘밤 수집 전 확인 요망. (검증: 07-14 실측 자동252행이 07-15 01시 KST 생성=구로직 흔적.)

## 2026-07-15 [시트 정정요청·필수] 연동시트 업체명 6건 삭제(온드/위성) — DB는 완료 (Claude)

온드미디어·위성채널은 업체명·광고비 금지(사용자 규칙). **DB는 6건 company_name=null로 정리 완료(검증: 위반 0, 대시보드 반영됨).** 그러나 `bulk` 동기화가 시트 업체명(D열)을 다시 DB로 덮으므로(company_name manual_fields 미보호 확인), **연동시트에서도 삭제해야 재발 안 함.**

연동시트 `[콘텐츠 대시보드 연동]`(10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak, gid=1937186871), **D열(업체명)** 아래 6행 값 삭제 요청(행은 URL로 매칭):
- lm_not_sweet_ / instagram.com/p/DaU0qpGooCH/ → 업체명 '아택'
- lm_not_sweet_ / instagram.com/p/DZpHbfNIjGM/ → 업체명 '업크루'
- 썰박스(틱톡) / tiktok …/video/7661935334569135380/ → '썰박스'
- 썰뜨기(틱톡) / tiktok …/video/7661937025888652565/ → '썰뜨기'
- 썰박스(유튜브) / youtube.com/shorts/qR0BBFWcvz4/ → '썰박스'
- 썰뜨기(유튜브) / youtube.com/shorts/09A7lPKLgHc/ → '썰뜨기'

⚠️ Claude가 직접 안 지운 이유: 이 시트는 앞서 이름상자 오조작으로 A열 삭제 사고를 낸 곳이라, 라이브 편집 재발위험 회피 위해 소유 세션(Ad view tracking)에 정확 위치로 인계. (백업: scratchpad/nocost_backup.json)

## 2026-07-16 [Codex] notify_status 오탐 2종 개선

- `scripts/notify_status.py` 부분수집 감지 기준을 최근 non-null 중앙값에서 **그날 활성 조회수대상 게시물 수** 대비로 변경.
  - 자동종료로 활성 풀이 줄어도 예전 큰 중앙값과 비교하지 않음.
  - 활성 조회수대상에서 종료글, 배너, 위성/온드, 무상시딩 수동추적, 조회수 수집 불가 플랫폼을 제외.
  - 합성 검증: `07-15 실측 272 / 활성 347`은 정상(부분수집 알림 없음), `100 / 347`은 부분수집으로 탐지.
- 미측정 활성 점검에서 **무상시딩 (영상)** 소형 계정을 `무상시딩 수동추적 N건 제외` 버킷으로 분리.
  - 점검 목록에는 뜨지 않지만 카운트는 표시해서 진짜 고장 신호와 수동추적 노이즈를 분리.
- 실DB 재실행은 이 로컬 작업트리에 Supabase 환경변수가 없어 못 했음. 배포 후 `MONITORING_DATE=2026-07-15` 기준으로 Slack/로그에서 재확인 필요.

## 2026-07-16 [Codex] sponsored-write 종료처리도 identity 기준 보강

- `web/lib/sponsored-write.ts`에서 일반 등록/메타 매칭은 이미 `normalized_key/postIdentityKey` 기준이었으나, 캡션 `삭제/보관` → `ended_at` 처리만 URL exact `.in("url", ...)` 경로가 남아 있었음.
- `/reel/`↔`/p/`, TikTok `www` 유무처럼 같은 게시물인데 URL 문자열이 다른 경우 종료처리가 샐 수 있어, 기존 행은 identity로 찾은 `id` 기준 업데이트, 신규/미확인 행만 URL fallback으로 처리하도록 보강.
- 검증: `npm.cmd test` 31개 통과, `node --check --experimental-strip-types web/lib/sponsored-write.ts` 통과.
