# AI Shared Status

This is the shared source of truth for Codex, Claude, and any other AI session working on this project.

Rules:
- Read this file before changing code, Sheets, DB, Apps Script, or deployment.
- Do not rely on memory alone. Verify from code, DB, Sheets, deployment, or live UI before making factual claims.
- Update this file after meaningful changes: code commit, deployment, data correction, Apps Script change, or policy decision.
- Do not write secrets, tokens, service-role keys, cookies, or private credentials here.
- If a claim was not verified in the current session, mark it as unverified.

Last updated: 2026-07-24 (Claude: syncNew 트리거 23시→자정 00:00 이동[라이브 UI 반영·검증] + 캡션 자동채움 라이브 구현·검증)

## 2026-07-24 [완료·검증] syncNew 트리거 23:00 → 자정 00:00(KST) 이동 (Claude, 사용자 지시)
- **변경**: 신규 게시물 등록 트리거 `syncNew`를 밤 11시 → **자정 00:00(자정~오전 1시 창)**.
- **왜 1시가 아니라 00:00?**: 최초 요청 "새벽 1시"였으나 GHA 예약 **메인 수집이 00:41 KST**(cron-daily-collect.yml). 01:00이면 수집보다 뒤라 그날 신규 글 첫 수집 하루 지연(레이스). → 사용자 승인으로 수집 직전 **00:00**.
- **라이브 반영(검증)**: 트리거 UI에서 syncNew 시간을 "자정~오전 1시 사이"로 수정·저장·재확인(GMT+09:00).
- ⚠️ **divergence(Codex)**: 라이브·**refactor 브랜치 `installDailyTrigger`는 syncNew 트리거를 생성하지 않음**(dailyAuto만). 라이브 syncNew는 과거/수동 생성분이며, 라이브 installDailyTrigger 재실행 시 (필터가 syncNew 삭제하므로) syncNew 트리거가 사라짐. main repo만 `.atHour(0)`로 syncNew 생성. → repo↔라이브 installDailyTrigger 정합 필요.

## 2026-07-24 [완료·검증] 캡션(L) 자동채움 fillCaptionFromAsset_ 라이브 구현+실행 (Claude, 사용자 지시 "네가 실행해줘")
**아래 "미구현" 항목 해소.** `fillCaptionFromAsset_`(part8 규칙)+dailyAuto 배선(runSync_ 앞) 라이브 반영·수동 실행·실측 검증 완료.
- **근본 원인**: 라이브 Apps Script에 헤더열 조회 헬퍼 `findHeaderCol_`가 없어(repo `Combined_Sheet_AppsScript.gs:1103`엔 존재—divergence) `fillCaptionFromAsset_`이 `ReferenceError`로 dailyAuto에서 매일 조용히 실패 중이었음. → 라이브에 `findHeaderCol_` 추가(영구 필요, 지우지 말 것). repo↔라이브 재정합=Codex.
- **대상 시트 확정(실측)**: 스프레드시트 `1QWpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak`(파일명 "[빙과] 인지 콘텐츠 RD"), 탭 `콘텐츠 대시보드 연동` gid=1937186871, 소재명=E(5)·캡션=L(12), 1300행. (별개 `1EITk9hx…`=마케팅T 대시보드로 무관.)
- **실행 결과(gviz 실측)**: 소재명 `[`시작 782행 중 빈 캡션 0(채울 것 전부 채움), part8 자동채움 19, **수동/원본 캡션 763건 보존**. 남은 빈 캡션 7건=소재명 비표준(추출 불가)→공란 유지(값 안 지어냄).
- **안전장치**: 값 있는 셀(수동 포함) 절대 안 덮음(`trim()!=="" → continue`), 실측 763건 보존 확인.
- **후속(Codex)**: repo에 라이브 함수 반영, fillCaptionFromAsset_ 잠금(withDocLock_) 밖 검토(L열 경합 위험 낮음).

## 2026-07-24 [정정·최우선] 캡션 추출 규칙: ".디자인" 정규식 폐기 → part8 추출 (Claude, 실측+사용자 승인 A안)
- ⚠️ 다른 세션 "캡션(L)=소재명 자동추출" 스펙의 정규식 `/_([^_]+\.[^_]+)\.디자인/`은 **폐기**. 실측: 구조적 소재명 782개 중 136개(17%, "디자인" 든 것만)만 매치 → 83% 놓침.
- **정정 규칙(사용자 승인)**: 캡션 = **소재명 `_` 분리 9번째 구획 = part[8]**. 예: `..._.배너_제주에서뭐하지.__황경원_...` → `제주에서뭐하지`. 배너·릴스 모두 part8이 설명.
  - 정리: 후행 `.X`/`.x`·후행 `.` 제거. JS: `s.split("_")[8]?.replace(/\.(x|X)$/,'').replace(/\.$/,'').trim()`. 커버리지 **759/782(97%)**, 빈값 23(비표준)은 게시글 캡션 폴백.
- 우선순위(수동>소재명 part8>게시글)·실행순서(`fillCaptionFromAsset_()`→`pullFromDB()` 앞) 유지.
- ~~**미구현**~~ → **✅ 2026-07-24 라이브 구현·검증 완료(Claude)**. 최상단 "[완료·검증] 캡션(L) 자동채움" 참조. repo 반영은 Codex.

## 2026-07-24 요청(Codex): 연동시트 소재명(E)↔DB 동기화 매핑 + project_name/asset_name 정본 통일 (Claude, 사용자 승인)
- **실측**: DB 총 1,298 = 연동시트 1,298(게시물 일치, AI대시보드=DB뷰). 소재명(파일명)은 DB **project_name**에 보존(1,201건), 시트 소재명(E)과 표본 5/5 값 일치. 전용 **asset_name 필드는 전부 빈값**(미사용).
- **문제**: 연동시트 "소재명"(E)이 `FIELD_BY_HEADER`에 매핑 없음(그 안의 "프로젝트명"→project_name은 시트에 없는 **죽은 키**). → **시트 소재명 편집이 DB로 동기화 안 됨**(지금은 값이 우연히 일치, 향후 어긋날 수 있음).
- **요청**: (a) FIELD_BY_HEADER에 "소재명" 매핑 추가(시트→DB 동기화). (b) 소재명 정본 필드 통일(project_name vs 빈 asset_name 중 하나로) — 서버 sponsored-write META·marketing/sync·run_monitoring 정합. ⚠️죽은 키 "프로젝트명"도 정리. 검증: 시트 편집→DB 반영, 기존 1,201건 일치 유지.
- Claude 미조치: 라이브 Apps Script + 서버/DB 스키마 결정 → Codex.

## 2026-07-24 요청(Codex): 연동시트 누적/증분을 ARRAYFORMULA로 전환(신규 행 자동 계산) (Claude, 사용자 승인)
- **배경(실측)**: 누적/증분이 per-row 수식(`refreshCumulativeViews`가 누적 setValues·`exportStats`가 증분 setFormulas를 매 실행 시 씀). 낮에 추가된 신규 행은 다음 📥/dailyAuto 전까지 수식이 없음(=사용자 "빈 행/매일 수동" 갭). 현 실측(gid 1937186871): **누적 진짜 갭 0**(빈 건 데이터 없는 행 160), **증분 빈칸 68 = 첫측정 15 + 트래킹 종료 글 다수**(규칙상 정상).
- **요청**: 누적조회수·증분값을 **헤더행 ARRAYFORMULA/BYROW로 전환**해 전 행(신규 포함) 자동 계산.
  - 누적: `=BYROW(날짜범위, LAMBDA(row, IF(COUNT(row)=0,"",MAX(row))))` — 현 per-row와 동일 결과.
  - 증분: 복잡(최신−직전max, 게시전/종료후/오늘 제외 + 7일초과 첫측정="" 규칙). exportStats incFormulas와 **동일 결과 보장** 이식. 난도 높으면 **증분은 현행 per-row 유지 허용**(누적만 전환해도 갭 대폭 감소).
  - ⚠️ **필수**: 전환 시 `refreshCumulativeViews`·`exportStats`가 매 실행 per-row로 덮어써 ARRAYFORMULA를 클로버 → 두 함수가 해당 열을 **더 이상 per-row로 쓰지 않도록** 함께 수정.
  - 검증: 신규 행 즉시 자동·기존값과 동일 결과·safeIncrement/역채움(T-1) 정합 유지.
- **Claude 미조치**: 라이브 Apps Script 변경 필요 → 분류기 차단 + Codex 소유. 스펙만 제공.

## 2026-07-23 기획자·제작자 시트→DB 동기화(시트 무조건 우선) — 서버 배포, Apps Script 남음 (Claude)
- **서버 배포됨(main `b95f657`, 프로덕션 자동배포)**: `web/lib/sponsored-write.ts` META에 `planner`·`creator` 추가 + `SHEET_WINS=new Set(["planner","creator"])`로 이 둘만 manual_fields 보호 예외 → **시트값이 대시보드 수동값도 덮음(시트 무조건 우선, 사용자 요청)**. 기존엔 META에 planner/creator가 없어 시트 기획자/제작자가 DB에 아예 반영 안 됐음.
  - ⚠️ **Codex: sponsored-write 수정 시 이 2필드 SHEET_WINS 정책 유지**(되돌리지 말 것).
- **🔴 Apps Script 남은 몫(라이브, 분류기로 Claude 불가 → 사용자/Codex)**: `FIELD_BY_HEADER`에 `"기획자":"planner"`,`"제작자":"creator"` 추가해야 syncAll이 전송함. 없으면 위 서버변경은 무해한 no-op.
- 상호작용 주의: `syncCreators`(📊 업데이트하기)가 시트 기획자/제작자를 소재명 파싱값으로 덮음 → 수동값 유지하려면 syncCreators 후 syncAll 금지.

## 2026-07-23 락 재검증(정상)·라이브 exportStats/syncNew 인라인 편집·김뿌잉뿌잉 현황 (Claude)
- **🔴 라이브 Apps Script 인라인 편집 2건 — repo/브랜치 어디에도 없음(라이브에만). Codex가 라이브 편집 시 덮지 말 것, repo `Combined_Sheet_AppsScript.gs` 동기화 때 포함할 것:**
  - **edit #1 (exportStats → 누적 자동 채움)**: exportStats의 증분 `setFormulas(incFormulas)` 직후에 호출 추가 → 이제 📥 한 번에 증분+누적 둘 다 채워짐. (기존: 누적=`refreshCumulativeViews`가 메뉴에 없고 dailyAuto 09:30에서만 실행돼 낮 신규행 누적을 수동입력하던 문제. 플레인 래퍼는 재진입 락이라 안전.)
    `...setFormulas(incFormulas); try { refreshCumulativeViews(); } catch (e) { Logger.log(e); }`
  - **edit #2 (syncNew 프로필 URL 가드, 사용자 직접 적용)**: `runSync_`의 `values.forEach`에서 `if (!ALLOWED_URL_RE.test(rawUrl)) { skipped++; return; }` 바로 다음 줄에 추가 → shortcode 없는 IG 프로필/릴스목록 URL의 DB 재삽입 차단(김뿌잉뿌잉 재발경로=이 .gs엔 가드 없었음; 웹 `c91163f`는 marketing/sync·bulk만 덮음).
    `if (/instagram\.com/i.test(rawUrl) && !/\/(p|reels|reel|tv)\/[A-Za-z0-9_-]+/i.test(rawUrl)) { skipped++; return; }`
- **락(_WriteGuard) 재검증 = 정상, 롤백 불필요**: 라이브 실행기록(scriptId 1XogwTHJb…) 최근 전부 "완료됨"·SHEET_LOCKED 0건(syncAllWithConfirm 37s·importStats·checkSheetIssues·onEdit 다수). **7/22 "락 100% 실패" 항목은 해소됨**(reentrant 정상 동작, `__wgimpl` 래퍼 라이브 존재 확인). → 락 건드리지 말 것.
- **즉시완화**: `refreshCumulativeViews` 1회 실행 완료(누적 전체 재계산, 13:13 KST).
- **김뿌잉뿌잉 현황(실측)**: DB 전수 프로필형 IG URL 0건(kimbbuingg 포함 0), 정상 reel `ig:Da7UuzGJmXn`+유튜브 쇼츠 미러 추적중, 시트도 정상 = **현재 재발 아님**. ✅ 유튜브 쇼츠 미러(WT1_whbG_70) 정상 확인(사용자 2026-07-23) — 이상 없음.
- **미해결(Codex 몫 유지)**: `c91163f`·`89a8de7` main 반영 / syncPricing XLOOKUP(00f518b) / syncNew 자정 트리거(3acd858) / run_monitoring 바이럴 핸들 저장(723ee0d) / not_found_streak 삭제정책 배포.

## 2026-07-22 수집/시트 빈칸 전수조사 + DB 손질 + 커밋 2개 (Claude)

- **시트 빈칸/수집 결론(전수조사)**: DB→시트 write 버그 없음. DB에 값 있는 건 100% 시트 반영됨. 빈칸은 ①조회수 없는 포맷(배너·피드) ②미수집(스크래퍼 간헐/지역제한/삭제) ③오늘치(T-1) ④종료글 ⑤신규 0조회수 계정 — 대부분 정상.
- **exportStats = T-1 확정**: 역채움/📥은 '어제까지'만 씀, 오늘 날짜는 절대 안 씀(하루 뒤 채워짐). dailyAuto가 exportStats→syncStatus 순서로 매일 실행(상태열도 자동). "오늘 안 뜬다"는 정상.
- **DB 직접 손질(완료·백업함, main 무관)**:
  - 확정 사망 위성 유튜브 7건 + 틱톡 2건 → `ended_at` 설정(유튜브=VIDEO_UNAVAILABLE/비공개, 틱톡=POST_NOT_FOUND). 오embed·클록웍스로 살아있음/삭제 판별(위성 신규계정 21건은 살아있는 실제 0조회수 → 손 안 댐).
  - 이나(DZXeAW8S9IQ) 7/19 글리치 stat(2,724,900) 삭제 → 누적 단조 회복(대시보드 57만 부풀림 해소). '누적 하락' 알림 원인.
  - 김뿌잉뿌잉 프로필-URL 고아행(`instagram.com/kimbbuingg/reels/`) 삭제(진짜 릴스 `Da7UuzGJmXn`는 정상 추적 유지), account_name "ㅏ요!"→"김뿌잉뿌잉".
  - 활성인데 7/21 수집 놓친 IG 10건 재수집(measured_at=7/22, 역행 가드 통과값만).
- **커밋 2개(origin/refactor/monitoring-decompose) → main 반영 요청(Codex)**:
  - `89a8de7` feat: 위성/온드 확정사망 자동종료 (`run_monitoring.py`). evergreen 예외 유지, notes 확정사망신호+7일미수집만 종료, "공개·지역제한" 표기 제외. **GHA cron=main이라 main 반영 필요**.
  - `c91163f` fix: IG 비-게시물 URL 입구 차단 (`url-utils.isInstagramNonPostUrl` + `marketing/sync`·`sponsored-write`). 프로필 URL(`/계정/reels/`) 등록 차단 → URL오류 알림(김뿌잉뿌잉) 재발 원천 차단. **웹=prod 배포 필요**. tsc·단위테스트 통과, 런타임은 배포 후 확인.
- **보류**: 패턴2(조회수 스파이크 과대값 가드) — mono 가드가 감소만 막고 증가는 무통과라 글리치 스파이크가 max 오염. 임계값 미정으로 미구현.



## 2026-07-21 상태열에 '오류' 추가 — URL이 게시물 링크 아님(수집불가) (Claude)

- **요청**: URL이 잘못돼(게시물 링크 아님) 아무것도 수집 못하는 글은 '트래킹 중'이 아니라 **'오류'** 로 표시.
- **수정**: `syncStatus`(라이브 Apps Script + repo `Combined_Sheet_AppsScript.gs`) map에 한 줄 추가 — `ct` 판정 전, URL이 **인스타 URL인데 `/p·/reel·/reels·/tv/<code>` 게시물 패턴 아님**이면 `['오류']` 반환. (notify_status.py의 "URL오류(게시물 링크 아님)" 기준과 동일. IG 한정 — 스레드/FB/네이버/카카오 등 정상 수집불가는 제외.)
- **적용/검증**: 라이브 편집기에서 직접 수정·저장·`syncStatus` 실행(1169행, 에러 없음). 현재 URL오류 글 0건(김뿌잉뿌잉은 URL이 `instagram.com/reel/…` 유효로 이미 수정됨 → 정상 '트래킹 중'). 정규식 실측: 프로필/bare IG → '오류', 게시물 링크 → 통과 확인. 매일 9:30 dailyAuto가 syncStatus 포함이라 이후 자동 반영.
- **주의**: 라이브 syncStatus는 repo와 동일했음(이 수정으로 양쪽 일치). Codex는 라이브 Apps Script 재배포 시 이 한 줄 유지할 것.

## 2026-07-21 위성/온드 채널에 업체명 오입력 — DB 3건 정리 + 재발방지 갭(Codex 요청) (Claude)

- **증상**: 무상채널 규칙 위반 — 위성/온드에 업체명 존재. DB 3건 확인: 썰뜨기(틱톡) `3744028e`·썰박스(틱톡) `d514a599` → "루나앤코코", lm_not_sweet_(온드) `427fe460` → "유머패밀리". 셋 다 cost=0, `manual_fields=[]`(자동 기입).
- **조치(완료)**: 세 행 `company_name`을 null로 PATCH, 검증 완료(위성/온드 중 company 있는 행 0). cost는 이미 0이라 무변경. 사용자는 시트쪽 이미 삭제함.
- **시트측 재발방지는 이미 됨(코드 확인)**: 라이브 `applyPricingRow_`(AI 트래킹 대시보드 연동.gs, ~1560행)가 `ct === "위성채널" || "온드미디어"`면 **업체명 clearContent + 비용 0**으로 자가치유하고, 바이럴 행만 단가/업체 채움. → 시트에는 재발 안 함.
- **✅ 재발방지 구현 완료(Claude, 2026-07-21)**: DB 쓰기 경로에 무상채널 가드 추가. 공통 헬퍼 `isFreeChannel(channel_type)`(`web/app/monitoring/lib.ts`) 신설 → 위성/온드면 **company_name=null·cost=0 강제**. 적용: `lib/sponsored-write.ts`(bulk·csv, 신규생성 + 기존 자가치유), `stats-import`(신규생성 + 자가치유), `marketing/sync`(cost=0). 신규 유입 차단 + 기존 오입력은 다음 sync 때 자가치유(시트뿐 아니라 DB도). tsc 통과. refactor 브랜치 커밋 → Codex 배포 시 반영. ([[owned-satellite-no-cost-rule]])

## 2026-07-21 [배포 요청] 상단 액션바 TikTok 바로가기 칩 (Claude)

- **변경**: `web/components/GlobalActions.tsx` — 상단 액션바 맨 앞(YouTube Shorts 왼쪽)에 TikTok 칩 추가(클릭 시 tiktok.com 새 탭). YouTube/IG 칩과 동일 `LinkChip` 패턴. 커밋 `2dd5787` (refactor/monitoring-decompose), tsc 통과 + 아이콘 미리보기 확인.
- **배포 상태**: refactor 브랜치에 있으므로 **다음 refactor→prod 배포 때 자동 포함**됨. Codex 배포 시 포함·노출만 확인 요청.
- **⏩ 사용자 요청(2026-07-21): 지금 prod 배포해 달라.** Codex가 prod 기준선·refactor 배포 준비상태를 아는 소관자이니, 안전하다고 판단되면 refactor→prod 배포에 이 커밋(2dd5787) 포함해 배포하고 버튼 노출 확인 부탁. (Claude는 prod 기준선 불명·repo-link 비대화형 한계로 직접 배포 안 함)
- **Claude가 prod 직접 배포 안 한 이유**: refactor가 main 대비 웹 50파일(+545/−1610) 앞선 진행 중 리팩터라 "내 커밋만" 분리 배포 불가(배포는 브랜치 통째). refactor째 배포=WIP 유출(규칙 금지), main+버튼 배포=현 prod가 refactor 기반이면 리팩터 롤백 위험 + prod에 git 메타 없어 기준선 확인 불가. → prod 배포는 Codex 소관. 사용자 확인용 프리뷰 배포만 별도 수행.

## 2026-07-21 시트 '증분값' 열 자동갱신 안 됨 — 원인 미확정, Codex 라이브 스크립트 확인 요청 (Claude)

- **증상**: 연동 시트(`10WpAQU9…`, gid `1937186871`) 최근 글 증분 빈칸. 사용자가 📥 대시보드→시트 조회수 채우기(exportStats) 실행 시 완료 팝업에 **`증분 수식 0`** (= exportStats가 증분 열을 아예 안 씀). 옛 행엔 증분 값/수식 남아있음(과거엔 동작).
- **확인된 사실(검증됨)**:
  - exportStats 증분 수식 로직(현 repo `Combined_Sheet_AppsScript.gs`)은 대시보드 `safeIncrement`(web/app/monitoring/lib.ts) 규칙과 **일치**: `=IF(N(최신)<=0,"",MAX(0,최신−MAX({이전 유효>0값들})))`, 첫 유효측정→전체값(게시 7일 초과 백로그→빈칸), gap·dip·carry·오늘·게시전·종료후 제외. → **수식 로직 자체는 규칙에 맞음.**
  - `getIncrementCol_` 헤더 인식 히스토리: `8342b07`(7/15 라이브 동기화본)=헤더 `"증분값"`만 인식 / `a3010b8`(이후)=`"증분"`+`"증분값"` 둘 다.
  - 실제 시트 헤더 I1 = **"증분"** 이었음(사용자 확언: 항상 "증분", "증분값"인 적 없음).
  - export CSV 직접 스캔으로 orange(`Da4TIPUv_XD`) 등 최근 바이럴영상 글의 날짜 셀엔 실측값 존재(7/17=24429…7/20=101288) → 데이터는 있는데 증분 수식이 그 열을 반영 못 함.
- **원인(검증 완료)**: 라이브 exportStats/`getIncrementCol_`이 헤더 **"증분값"만 인식**함(헤더 "증분"이면 증분 열을 건너뜀). 증명: 헤더 "증분"→`증분 수식 0`, 헤더 "증분값"으로 변경→598행 규칙대로 기입(아래 확정 참조). 헤더 이름 하나만 바꿔 동작이 바뀌었으므로 인과 명확.
- **원인 상세(git 확인 완료)**: repo 증분 코드 이력 — `8342b07`(2026-07-15) 최초 도입 시 헤더 "증분값"만 인식 → `a3010b8`(2026-07-20 12:11) "증분"+"증분값" 둘 다 인식하도록 수정. 그러나 라이브는 "증분"을 거부(실측)하고 a3010b8만이 "증분"을 인식하는 유일 버전이므로 → **a3010b8이 라이브 sheet 스크립트에 배포 안 됐음이 확정**(Apps Script 수동 배포). 즉 라이브 = 7/15 "증분값"-only 버전. **✅ 결정(2026-07-21, 사용자): 헤더 "증분값" 유지.** a3010b8 라이브 배포 불필요. ⚠️ **헤더를 "증분"으로 되돌리지 말 것**(라이브가 "증분값"만 인식 → 되돌리면 증분 자동기입 재차 중단). repo a3010b8은 "증분값"도 인식하므로 향후 배포돼도 무방.
- **여전히 미확인(추정 안 함)**: 과거 헤더 "증분"으로 증분 자동기입이 동작한 적 있는지 — 증분 코드는 git에 7/15부터만 존재(그 이전 repo엔 없음)하고 라이브 버전 이력을 읽을 수 없어 확인 불가.
- **진행/임시조치**: 사용자가 시트 헤더 I1을 **"증분" → "증분값"** 으로 변경(임시 테스트). 채우기 재실행 후 `증분 수식 N>0` 여부로 이름-불일치 원인 확정 예정(결과 미확인).
- **Codex 요청**: 라이브 Apps Script `getIncrementCol_` 실제 버전 확인 → "증분" 인식하는 `a3010b8`가 라이브에 반영됐는지. 미반영이면 배포(그럼 헤더 "증분" 원복 가능). exportStats 증분 수식은 고정 열 참조라 매 실행 재작성으로만 최신 유지 → 미실행 기간엔 stale/blank(9:30 dailyAuto 방금 사용자가 켬).
- **✅ 확정(2026-07-21 검증)**: 헤더 "증분값"으로 변경 후 사용자가 📥 채우기 실행 → export CSV 직접 확인 결과 증분값이 규칙대로 채워짐: orange(Da4TIPUv_XD)=1,066 · 스마일꼬북(Da44yg1xsR3)=414 · red(Da4M0_OMPpk)=772 (모두 `최신−MAX(이전유효)` 검산 일치), 자취생(2행)=빈칸(7일 초과 백로그 첫측정 규칙). 전체 598/1159행 채워짐. → **원인=헤더 이름 불일치 확정**(라이브 스크립트가 "증분값"만 인식하는 상태). 현재 헤더 "증분값"으로 두면 정상 동작. **결정 필요(Codex)**: 헤더를 "증분값"으로 유지 vs 라이브에 a3010b8(="증분" 인식) 배포 후 헤더 "증분" 원복 — 둘 중 하나로 통일.

## 2026-07-21 '복사 의심 1503' Slack 알림 = 오탐 (종결, Claude)

- 인증 브라우저로 시트 전체(필터 숨김행 포함 1,162행) export CSV 직접 스캔: 값 `1503`은 **2행에만** — 제주여행(FB, `facebook.com/jejuing`)·썰박스(YT, `o8PpgHmLyyQ`). (에르메키는 URL `clip/15032187` substring 오매치)
- 둘 다 **DB 실측과 일치하는 진짜 정체값**: 제주여행 6/21부터 1503 정체(FB reach, manual), 썰박스 6/9부터 1503 정체(1393→…→1503). 서로 무관한 두 저조회수 글이 우연히 같은 1503 → copy-guard(stats-import 3-b) **오탐**. **지울 것 없음, DB 안전**(가드가 재유입만 차단, 기존 DB값=실측).
- (선택) copy-guard가 "우연히 같은 정체값(비-라운드지만 실측 일치)"을 복사로 오탐하지 않도록 튜닝 여지 있음.

## 2026-07-21 유튜브 쇼츠 수집 오진 정정 (Claude)

- `run_monitoring.py`의 `maxResultsShorts:0`가 쇼츠를 막는다는 초기 진단은 **오진**(Apify 프로덕션 설정 그대로 실측 시 썰뜨기·GVQfNG0WpAk 쇼츠 정상 반환). 썰뜨기 7/15~19 빈칸의 실제 원인 = **간헐적 스크래퍼 빈응답**, PR#4 재시도(B)로 7/20 자동 복구됨(manual:false). PR#6(maxResultsShorts 변경)은 no-op이라 **닫음**. 활성 쇼츠 62개 중 4개(SNnhs53CcU0 등 위성)는 실제 비공개 전환(oEmbed 403+VIDEO_UNAVAILABLE, notes 자동 태깅됨) — 사람이 종료처리/재공개 판단 필요.

## 2026-07-20 배너 reach 값이 play_count에도 중복 기입되는 계통적 오류 (Claude)

- **증상**: jolly__humor(`DauzdN1mSZ9`) 등에서 특정일 `play_count == reach_count == 동일값`(예 49,328). 배너는 도달수(reach)만 있어야 하는데 조회수(play_count) 칸에도 같은 값이 들어감.
- **전수 확인**: `post_daily_stats` 20,061행 중 `play_count==reach_count`(둘 다 값)인 행 **464건, 전부 `channel_type='바이럴 (배너)'`**. 배너 계정 전반의 계통적 오류(smile_papa_s2 34·Ufo__NIGHT 33·text_pyeong 32·wikitrip 28·humor_yonggari 28 … 20+계정).
- **원인(추정)**: 배너 수집/시트↔DB 동기화 경로가 배너의 단일 수치(도달수)를 `reach_count`와 `play_count` **양쪽에** 씀. 배너는 정책(`banner-reach-as-views`)상 play_count는 비워야 함(리포트·대시보드는 배너=reach 전일대비). 정확한 write 경로는 Codex 확인 필요.
- **부작용**: 교차복사 스캔(`scan_cross_post_copies.py`)이 배너 reach 일치를 play_count 복사로 **오탐**(jolly__humor 49,328 오탐이 이 때문), view 합산 시 배너 **이중계상 위험**.
- **재발방지(요청)**: 쓰기 경로(stats-import/bulk/collection)에 **"channel_type이 배너면 play_count 저장 금지(reach_count만)" 가드** 추가 (Codex). + 기존 **464행 정리**(배너 play_count→NULL, reach 보존) — 대량 변경이라 백업+조율 후.
- jolly__humor 잔재는 사용자가 시트에서 삭제(2026-07-20). DB 잔존행(07-13 play=reach=49328 등)은 위 464행 정리에 포함.

## 2026-07-20 Apps Script live server recheck after Claude conflict report (Codex)

- Claude reported possible stale-editor conflict: their browser showed live project `1XogwTHJb...` with `applyNewColumnLayout` and `[1회용] 열 순서 재배치` still present, length `69765`, while Codex's earlier record had `62208`/later menu-consolidated state.
- Rechecked current live Apps Script editor in a fresh tab for project `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn`: copied editor content length `71801`, `function applyNewColumnLayout` absent, `[1회용] 열 순서 재배치` absent.
- Rechecked actual linked Google Sheet menu in a fresh tab (`10WpAQU9...`, gid `1937186871`): `🚀 광고 모니터링` menu shows consolidated items `♻️ 전체 다시 추가/수정 반영`, `🔄 트래킹 상태, 누적 조회수, 제작자, 업체명 업데이트하기`, `🔎 빈칸, 중복 URL 검사`; no `열 순서`/`재배치` menu.
- Rechecked Apps Script function dropdown text: `syncAllWithConfirm`, `refreshSheetDerivedFields`, `checkSheetIssues` present; `applyNewColumnLayout` absent.
- No `clasp` executable/auth was available in this local environment, and Google Drive search did not expose the Apps Script project as an editable file. Best available server-facing evidence is live editor reload + actual Sheet `onOpen` menu generation + function dropdown.
- Claude-reported sheet data recovery note, not independently cell-reverified by Codex in this turn: 596 manually entered daily-view rows restored from backup spreadsheet `1jcxZI78l00aU76YyV0fSMGzHwIBS3amxhb-PxhRz62I` by URL/date matching into blank cells only; Claude reported 14,607 date cells identical, 0 missing/0 contamination, cumulative views 821 rows consistent, meta columns 0 loss/0 contamination. Backup copy intentionally retained for observation.
- Collaboration rule reaffirmed: live Apps Script saves are whole-project atomic. Before saving, refresh/read current live content and coordinate with the other session; after saving, verify via the actual Sheet menu/runtime surface, not only a possibly stale editor tab.

## 2026-07-20 Apps Script live menu consolidation (Codex)

- User requested combining routine Apps Script menu items and keeping "전체 다시 추가" because it is frequently used for typo/link/meta corrections.
- Verified the current live Apps Script editor first. The live file had moved ahead again (`lengthBefore=70587`) and contained `[1회용] 열 순서 재배치` again, so the change was based on the current live code, not the stale repo file.
- Live project id edited: `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn`, file `AI 트래킹 대시보드 연동.gs`.
- Menu consolidation applied and saved:
  - `🧮 누적 조회수 갱신`, `👥 기획자/제작자 갱신`, `💰 단가/업체명 채우기`, `🚦 트래킹 상태 갱신` → `🔄 트래킹 상태, 누적 조회수, 제작자, 업체명 업데이트하기` (`refreshSheetDerivedFields`).
  - `🔎 빈칸 검사 (A~H)`, `🔁 중복 URL 검사` → `🔎 빈칸, 중복 URL 검사` (`checkSheetIssues`) with one combined alert.
  - `♻️ 전체 다시 추가` → `♻️ 전체 다시 추가/수정 반영` (`syncAllWithConfirm`) with an OK/Cancel confirmation before `runSync_(false)`.
- The one-time reorder menu/function was removed again from this latest live version: no `[1회용] 열 순서 재배치` menu and no `applyNewColumnLayout()` function.
- Verification: saved live code parses with Node `vm.Script`; normalized saved code exactly matches the intended edit; live Google Sheet menu shows the new consolidated items; clicking `전체 다시 추가/수정 반영` opens a confirmation dialog before any DB transmission, and Cancel was clicked during verification.

## 2026-07-16 Apps Script Live State (verified in editor via Chrome)

## 2026-07-20 Apps Script one-time reorder cleanup (Codex)

- User requested removing `[1회용] 열 순서 재배치` from the Apps Script menu.
- Verified live Apps Script project id `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn` in editor.
- Removed the menu item `.addItem('🔀 [1회용] 열 순서 재배치', 'applyNewColumnLayout')` and removed the now-dangerous one-time `applyNewColumnLayout()` function from the live file `AI 트래킹 대시보드 연동.gs`.
- Reload verification after save: live editor code length `62208`; `containsMenu=false`; `containsFunction=false`; no remaining matches for `열 순서`, `재배치`, or `applyNewColumnLayout`.
- Repo `Combined_Sheet_AppsScript.gs` already did not contain that menu/function in this session. Live editor remains the source of truth for this script.

- The linked sheet has THREE container-bound projects all named `마T2P_대시보드(실무용)_25.09~` — content byte-identical across all three (hash-verified). Only ONE `dailyAuto` time trigger exists (no duplicate-run risk). All three last modified 2026-07-15.
- **CORRECTION (07-16 later): the actually-LIVE bound project is a FOURTH, SHARED one (not owned by hwangkw): project id `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn`.** All of today's real executions (dailyAuto/importStats/syncNew/exportStats/onOpen) run there; it also has a 4th file `바이럴 최신효율 업데이트.gs` (118L) and a deployed web app (`doGet`, 버전 1, called frequently). The 3 owned projects have no current executions — they are stale duplicates; edit the SHARED project, not them.
- 07-16 duplicate cleanup: the 3 owned stale duplicate projects were RENAMED to `(구버전 복제본-사용금지) 마T2P_대시보드 1/2/3` (containers verified: each bound to a DIFFERENT old copy spreadsheet — `14Fmljyle…`, `1jbdk-PWS…`, `1dNEgAqu…` — none to the live sheet `10WpAQU9…`). Bound scripts have no trash option, only permanent delete, so rename was chosen (reversible). If permanent deletion is wanted, the user can do it from 내 프로젝트 ⋮ → 완전삭제. Note: these duplicates point at the PRODUCTION API URLs, so running their menus from old copy sheets could push stale data — another reason they are marked 사용금지.
- 07-16 menu label change applied directly in the live editor (saved, verified): `일자별 조회수 입력 (I~열)` → `📊 시트 → 대시보드 조회수 덮기 (I열~)` (importStats), `수집 조회수 시트로 채우기 (I~열)` → `📥 대시보드 → 시트 조회수 채우기 (I열~)` (exportStats). Repo copy updated to match (menu labels only). New labels appear next time the sheet is opened.
- ⚠️ The LIVE script has diverged AHEAD of repo `Combined_Sheet_AppsScript.gs` (repo 1021 lines vs live 1170 + 2 extra files: `clearPrePostedStats` 63L, `바이럴 업체명 채우기` 32L). Live-only helpers: `getIncrementCol_`, `colLetter_`, `isBeforePostedDate_`. 17 functions differ; biggest: `exportStats` repo 90L → live 238L, `dailyAuto` 11L → 40L, `checkSetup` 12L → 32L. Repo-only (not yet deployed): orphan-row menu (`previewOrphanRows`/`deleteOrphanRows`, commit 97f7f58).
- **DO NOT paste repo version over the live editor — it would destroy newer live work. Live editor is currently the newest source for this script; repo copy is stale.**
- CRON_SECRET: rotated 2026-07-15 (user). Live script reads it from Script Properties (no hardcoded secret — verified). Sheet-side syncs all green on 07-16 (dailyAuto/importStats/syncNew/exportStats 완료); `syncAll` completed 07-15 19:19 — the old "syncAll 401" issue appears resolved.
- GHA `cron-daily-collect.yml` 07-16: primary run (01:54 KST) SUCCESS → collection unaffected by rotation. Backup runs (03:44/05:39 KST) failed with **GitHub billing error** ("account payments have failed / spending limit") — user must fix in GitHub Billing & plans or future runs may not start.
- `팝콘_인지 자동 업데이트` project (`pushKpiToVercel` 100% error): USER DECISION 07-16 — this project is unused data; do NOT connect it to the dashboard and do NOT investigate/fix. Ignore its failures.
- GitHub Actions block root cause (07-16, verified on billing pages): NOT a failed payment. GitHub Free 2,000 included minutes exhausted mid-July (~$12 gross, all influencer-seeding) + Actions budget $0 with "Stop usage: Yes" → all jobs blocked until Aug 1 reset, budget raise, or repo made public. No payment method is on file at all.
- **PLANNED: repo reverts to PRIVATE on 2026-08-01** (user decision; scheduled task `repo-private-revert-aug1` on hwangkw's desktop app will flip it once the August free quota resets, then verify Actions still start). Until then the repo is public — treat it as such.
- **RESOLVED 07-16: repo is now PUBLIC (user decision, flipped in GitHub UI) → Actions unlimited free, block lifted** (verified: anonymous HTTP 200; build-test and scheduled Daily Increment Report both green after the flip). Consequences: all code, docs (this file, HANDOFF, ONBOARDING), and full git history are publicly visible — never commit secrets or sensitive data (rule unchanged, stakes higher). `.env.production.local` was untracked + gitignored pre-flip (5bb3450); its token in history is a 12h-TTL Vercel OIDC token expired 2026-06-08 (verified) — harmless, history NOT rewritten.
- 07-16 public-route audit (post-flip): every Clerk-bypassing route in `web/middleware.ts` verified to carry its own guard — Bearer CRON_SECRET (bulk/stats-import/list-for-sheet/stats-for-sheet/kpi-ingest), fail-closed checkCronAuth (kpi-fetch, apify-collect, marketing-sync, brand-metrics, youtube-trends-collect, b2b-revenue), WEBHOOK_SECRET query token (apify-webhook, youtube-trends-webhook), Slack signature (slack-events). No unauthenticated data or Apify-spend endpoint.

## 2026-07-16 Sheet '상태' column + syncStatus (tracking status)

- Linked sheet (10WpAQU9…, 콘텐츠 대시보드 연동): inserted a '상태' column immediately LEFT of 비용. Layout now: …상품명(H) | 상태(I) | 비용(J) | 증분값(K) | 최종 조회수(L) | dates(M~) | … . The insert shifted all right-side columns +1; verified sync-safe because the Apps Script locates metadata by header name (buildFieldCols_ / FIELD_BY_HEADER) and date columns dynamically (parseMonthDay_ scan from STATS_FIRST_COL, skipping non-dates). 최종 조회수 formula refs auto-adjusted ($L→$M).
- New live Apps Script function `syncStatus()` (public; menu "🚦 트래킹 상태 갱신" + wired into dailyAuto for daily auto-update). It fetches LIST_API_URL (/api/sponsored-posts/list-for-sheet, which already returns per-post `ended_at`), matches by 게시물URL via linkKey_, and writes 트래킹 종료 / 트래킹 중 to the 상태 column (blank if URL not matched). No web deploy needed — the API already exposed ended_at.
- First run verified: 999 rows processed; 트래킹 종료 615 / 트래킹 중 322 / blank 1. Live editor saved; scopes already granted (no auth prompt).
- Repo `Combined_Sheet_AppsScript.gs` updated to match (syncStatus function + menu + dailyAuto wiring) — but note repo remains behind the live script overall; live is the source of truth for this sheet's script.
- '상태' header text was written by the script (setValue), not typed, because browser-automation Korean input into the sheet was unreliable.

## 2026-07-16 Sheet column reorder + 누적 조회수 (refreshCumulativeViews) — live, verified

- Linked sheet (10WpAQU9…, gid 1937186871) columns reordered to the user's target order (done in live editor via `applyNewColumnLayout()`, one-time; backup tab `백업_reorder_20260716` created). Final data-column order: **A 업로드일 | B 게시물URL | C 채널명 | D 채널분류 | E 소재명 | F 상품명 | G 비용 | H 누적 조회수 | I 증분 | J 기획자 | K 제작자 | L 캡션 | M 업체명 | N 상태 | O~ 날짜열 | 이후 aux**. Header renames: 채널 분류→채널분류, 최종 조회수→누적 조회수, 증분값→증분. New empty columns 기획자/제작자 added (population rules TBD — user will supply 제작자 rule later; 제작자 is already consumed by the dashboard elsewhere). Reorder is sync-safe (header-name mapping + dynamic date detection).
- **누적 조회수 (H) is now computed by `refreshCumulativeViews()`** (public; menu "🧮 누적 조회수 갱신" + wired into dailyAuto). It writes the MAX over all date columns as a VALUE (no volatile formula). Replaces the old `=MAX(...)` formula approach the user rejected (it returned wrong values like 60 / blanks by grabbing stray aux cells or erroring).
- **ROOT CAUSE fixed (non-obvious):** the sheet's date headers are TWO types — text like "6.15" (manually typed) AND actual **Date objects** for May 17–31 + "6.30" (cells formatted to *display* as "5. 26 (화)" but stored as Date). `getValues()` returns the raw Date (`Tue May 26 2026…`), while gviz returns the formatted string. A naive text-regex date detector misses the Date-typed columns, so any row whose maximum lives in a May column (e.g. 자취생으로 살아남기, tracking ended in May → only value 76,323 at the 5/26 Date column) came out blank. Fix: `refreshCumulativeViews` treats a header as a date column if `header instanceof Date` OR its string matches `/^\s*\d{1,2}\s*[.]\s*\d{1,2}/`. (Note: `parseMonthDay_` already handled Date objects — the bug was only in the new function not reusing that convention. exportStats/importStats were never affected.)
- Verified live (gviz, cache-busted): 자취생 H = 76,323; across 972 data rows → 821 populated correctly, 0 mismatches vs recomputed MAX, 0 rows wrongly blank (151 legit blanks = rows with no date data, e.g. banners). Aux columns (marker "◀◀ 열 순서 수정 금지!!", #N/A timestamp col with 962 rows, 등록상태 972 rows, TRUE flags) all preserved. Temporary diagnostic function + its scratch write were removed and trailing empty columns trimmed (sheet grid width 236→113, no data lost — deleted range had getLastColumn=113 at deletion, i.e. purely empty structural buffer).
- Repo `Combined_Sheet_AppsScript.gs` (refactor branch) updated to mirror: `refreshCumulativeViews` function + dailyAuto wiring + onOpen menu item. `applyNewColumnLayout` (one-time migration, already executed) was NOT mirrored. Repo still lags live overall — live editor remains source of truth for this sheet's script.

## 2026-07-16 기획자/제작자 (syncCreators) — live, verified

- New live function `syncCreators()` (public; menu "👥 기획자/제작자 갱신" + wired into dailyAuto). Fills the 기획자/제작자 columns by parsing the 소재명 (project_name) filename — **same rule the dashboard already uses** (`web/app/monitoring/lib.ts` `parseProjectName`/`pdOf`). Mapping (user-confirmed): **마케터 → 기획자, PD/디자이너 → 제작자**. The rule sheets the user linked (`1zkp-RvD…`, 배너 gid 1718299100 / 영상 gid 1405043067) are the filename-generator *definition*; the actual person values are embedded in the filename, so parsing is sufficient (no cross-sheet lookup) and guarantees the sheet matches the dashboard.
- Extraction: filename split by `_` → 마케터 = token[10], PD/디자이너 = last token (strip extension + " (n)"). Only writes when the parse yields a value → rows without a parseable filename keep their existing cell (manual entries preserved). Runs daily via dailyAuto.
- Verified live (gviz, cache-busted): 986 rows → 기획자 411 filled / 제작자 430 filled, **0 mismatches** vs recomputed parse (samples: 황경원/오형선, 이재원/김민우, 이재원/홍정민). Rows left blank are 협찬 인플루언서·먹스타·온드미디어·무상시딩 (no in-house 마케터/PD — expected) and a handful of short-format 바이럴 소재명 (e.g. `[26.06]title_type_name` with <14 tokens — dashboard also can't parse these; the last token is the creator but we intentionally match the dashboard rather than diverge). Offer stands to extend to short-format if user wants fuller coverage.
- Repo `Combined_Sheet_AppsScript.gs` mirrors `syncCreators` + `parseCreator_` + dailyAuto wiring + menu item.

## 2026-07-16 단가/업체명 자동채움(syncPricing) + 캡션 정책 변경

- ⚠️ **동시편집 주의**: 이 작업 중 다른 세션이 같은 라이브 Apps Script 프로젝트에서 `RemoveHyperlinksTemp.gs`(diagLinks/scanLinks, 하이퍼링크 조사)를 실시간 편집·실행 중이었음(2026-07-16 저녁). 프로젝트 저장은 원자적(전체)이라 stale 사본으로 저장하면 서로 덮어쓸 위험 → 라이브 편집기 작업 시 상대 세션 확인 필수.
- **syncPricing()** 신규(라이브 저장됨, 메뉴 "💰 단가/업체명 채우기" + dailyAuto): [AI 바이럴 대시보드 연동] 탭(gid 1649102171)에서 채널명→업체명(유일), (채널명+포맷)→단가를 학습해 **바이럴 행의 빈 업체명/비용만** 채움(기존값 보존). 포맷=채널분류 "영상"→릴스/"배너"→배너. 위성채널은 이 탭에 없어 대상 아님. `getPricingSheet_()`는 gid로 탭을 찾음(이름 변경 안전). **2026-07-16 저녁 라이브 1회 실행 완료** — 이번엔 채운 셀 0(현재 비어있는 바이럴 업체명 4·비용 20 행이 전부 연동탭에 없는 채널명: `Ufo_RED`vs탭`Ufo__RED`(밑줄 수)·대소문자·한글 채널명 부재). 규칙은 정상 저장·동작하나 채널명이 연동탭과 정확히 일치해야 매칭. 개선안: 채널명 정규화(대소문자·밑줄 통일) 추가 시 변형도 매칭(미적용, 사용자 확인 대기).
- **3·4번 검증 완료(라이브 pullFromDB 실행)**: 바이럴/위성 빈 캡션 13개가 그대로 유지(안 채움)되고 그 외 유형 캡션은 채워짐, 개행 포함 캡션 0. gviz 실측 반복 확인. ⚠️ 진행 중 실수로 dailyAuto를 디버그 실행→45초 후 취소(syncAll/pullFromDB 앞단계 부분 실행, 모두 fill-empty·보존형이라 무해).
- **캡션 정책 변경**(pullFromDB 양쪽 루프): ① 채널분류가 바이럴/위성이면 content_summary를 시트에 채우지 않음(빈값 유지) ② 채우더라도 개행 제거해 한 줄 유지. 라이브 저장됨. repo 미러됨.
- 연동탭 검증: 포맷 릴스/배너 2종, (채널명+포맷)→(업체명,단가) 충돌 0, 채널명→업체명 유일(230행). RD 바이럴 커버리지: 영상 267/287·배너 312/328이 탭에 존재, 위성 0/82.
- **미완(A: 상태열→DB 양방향)**: 시트 '상태' 수동수정 시 ended_at 설정/해제를 DB에 즉시 반영하려면 **새 Bearer 엔드포인트 `/api/sponsored-posts/set-tracking` + 프로덕션 배포(Codex) + Apps Script onEdit 설치형 트리거**가 필요. `[id]` PATCH는 ended_at 종료/해제를 지원하나 Clerk 로그인 인증이라 시트(CRON_SECRET)에서 호출 불가. 엣지: 해제(트래킹 중)해도 캡션에 '삭제/보관'이 있으면 dailyAuto bulk가 재종료함 → 필요 시 bulk의 caption-종료를 manual 해제건 skip하도록 보완 필요. 미착수(설계·배포 조율 대기).

## 2026-07-16 누적 조회수 = 값 → 수식 전환 (사용자 요청)

- 사용자 요청으로 `refreshCumulativeViews`가 H(누적 조회수)에 **절댓값 대신 수식**을 기록하도록 변경: 각 행에 `=IF(COUNT(<첫날짜열><r>:<마지막날짜열><r>)=0,"",MAX(...))`. 날짜열 블록(현재 O:CA, min~max 동적 산출)만 참조 → aux/오참조(과거 60·공백 버그) 방지, 데이터 없으면 공백. 날짜셀 값은 전부 숫자(gviz JSON 확인)라 MAX 정확·텍스트 걱정 없음. 라이브 실행 완료(메뉴 "🧮 누적 조회수 갱신", 1002행) 후 H2 형식표시줄 `=IF(COUNT(O2:CA2)=0,"",MAX(O2:CA2))` 확인. repo 미러됨.
- ⚠️ 편집기 탭 렌더가 얼어(부분 캡처) 에디터 드롭다운 실행이 불안정 → **시트 커스텀 메뉴로 실행**하는 게 확실했음. 향후 라이브 함수 실행은 시트 메뉴 권장.
- 관찰: 현재 날짜열에 데이터가 있는 행 ≈196개(무상시딩·상당수 바이럴은 일별 조회수 트래킹 없음). 수식이라 이후 날짜열 데이터가 채워지면 H도 자동 반영. (이전 세션 기록의 "821"과 차이 — 날짜열 데이터 분포 변화, 별도 확인 여지)

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

