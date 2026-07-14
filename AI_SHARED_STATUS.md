# AI Shared Status

This is the shared source of truth for Codex, Claude, and any other AI session working on this project.

Rules:
- Read this file before changing code, Sheets, DB, Apps Script, or deployment.
- Do not rely on memory alone. Verify from code, DB, Sheets, deployment, or live UI before making factual claims.
- Update this file after meaningful changes: code commit, deployment, data correction, Apps Script change, or policy decision.
- Do not write secrets, tokens, service-role keys, cookies, or private credentials here.
- If a claim was not verified in the current session, mark it as unverified.

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
