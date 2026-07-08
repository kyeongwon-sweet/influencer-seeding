# 인플루언서 시딩 대시보드 — 인수인계 (ONBOARDING)

> 라라스윗(저당 간식 브랜드) 마케팅팀의 **인플루언서 시딩/협찬 성과 추적 대시보드**.
> 이 문서는 다른 AI/개발자가 바로 이어받도록 핵심 지식·경로·함정을 정리한 것. 작성 기준일: **2026-06-30**.
> ⚠️ "기준일" 표기가 있는 항목(특히 Vercel/도메인)은 시간이 지나면 바뀔 수 있으니 항상 현재 상태를 직접 확인할 것.

---

## 0. 가장 먼저 알아야 할 작업 규칙 (안 지키면 사고남)

1. **편집 직전 항상 `git fetch origin main` / pull로 최신화.** 다른 세션(AI/사람)이 같은 레포를 동시에 편집한다. 작업트리가 여러 브랜치를 오간다. 스테일 트리로 커밋하면 남의 작업을 덮어버린 사고가 실제로 있었다.
2. **변경은 `git worktree`로 격리해서 한다.** main 작업트리는 동시 세션이 쓰므로 직접 건드리지 말 것. 패턴:
   ```
   git worktree add ../wt-name origin/main
   cd ../wt-name && git switch -c <branch>
   # 편집 → 빌드검증 → commit → (fetch+rebase 루프)로 push origin HEAD:main
   # 끝나면: node_modules 정션 제거 → git worktree remove --force → 디렉터리 삭제
   ```
   worktree엔 node_modules가 없으니, 빌드/타입체크하려면 PowerShell `New-Item -ItemType Junction`으로 메인의 `web/node_modules`를 연결(경로 `C:\C:\` 중복 주의). 정리 시 정션을 **먼저 링크만** 제거(`(Get-Item -Force).Delete()`) 후 worktree 제거(실체 삭제 방지).
3. **푸시 전 반드시 빌드/타입체크.** `web/next.config.mjs`의 `typescript.ignoreBuildErrors: false`(2026-06-29 전환) → 타입에러 시 빌드 실패. `cd web && npx tsc --noEmit` 필수. ⚠️ tsconfig `incremental:true`라 `tsbuildinfo` 캐시가 에러를 숨길 수 있음 → `rm -f tsconfig.tsbuildinfo` 후 검증. `next build`는 plain tsc보다 엄격(라우트는 핸들러만 export 가능).
4. **pre-push 훅이 푸시 전 `tsc --noEmit`을 자동 실행**(`.githooks/pre-push`, `core.hooksPath=.githooks`). 비상 우회 `git push --no-verify`.
5. **"고쳤다" 전에 실제로 확인.** 특히 자동화/엔드포인트: **그 자동화가 하는 정확한 호출(메서드+경로+인증)을 그대로 찍어 200을 본 뒤에만** 바꾼다. 옆 URL의 상태코드/302로 추론해 행동 금지(302=리다이렉트=차단일 수 있음). 되는 걸 "안 된다" 단정 말고 직접 호출해 검증.
6. 커밋 메시지: `feat|fix|refactor|style|chore:` + 푸터 `Co-Authored-By: Claude <noreply@anthropic.com>`.
7. **프로덕션 데이터(특히 `post_daily_stats`) 수정 전 3단계.** ① 값이 이상해 보이면 DB가 아니라 **그 값을 계산·렌더하는 코드부터 읽어 표시값을 재현**한다 — 화면이 이미 보정하는 경우가 많다(§6 클라이언트 단조보정). ② 꼭 써야 하면 **원본을 파일로 백업**(post_id+옛값) 후 쓴다. ③ **대량·비가역 변경은 실행 전 사용자에게 제안·확인.** (2026-07-03: 미검증 가설로 215행을 덮어써 오히려 데이터를 오염시킨 사고 — 자세한 절차는 `AI_SKILLS.md` Skill 1·2)

---

## 1. 기술 스택 / 배포

| 역할 | 기술 |
|------|------|
| 프런트 | Next.js 15 App Router + TypeScript + Tailwind (Pretendard 폰트) |
| 인증 | Clerk |
| DB | Supabase (PostgreSQL) — 서버는 service role, lazy singleton `getServerSupabase()` (`web/lib/supabase-server.ts`) |
| 배포 | Vercel (**2026-06-30 Pro로 업그레이드**) |
| 수집 | Apify (REST 직접 호출) |
| 자동화 | **GitHub Actions** (Vercel 크론 아님 — `vercel.json` crons 의도적으로 비움) |

- 디자인 토큰: `web/tailwind.config.ts` (a-blue #0066cc, a-ink #1d1d1f, a-ink-muted #6e6e73, a-hairline #e0e0e0, a-divider #f0f0f0). 전역 CSS `web/app/globals.css` (얇은 스크롤바 5px #d1d5db).
- 증감 색 규칙: **증가=빨강(text-red-500), 감소=파랑(text-blue-600)** (국내 관습). B2B 발주량 "값"만 예외로 초록(green-600=차트 계열 식별색).

## 2. 레포 구조 / 핵심 경로

- `web/app/` — 페이지(8개): 홈(`page.tsx`, KPI), `listup`, `organic`(무상노출), `screening`, `monitoring`(협찬, 메인·~1800줄), 컨택 등.
- `web/app/monitoring/` — `page.tsx`(거대), `lib.ts`(타입·상수·통계 헬퍼·CHANNEL_TYPES·normalizeChannelType·fmtChannelType·URL상수), `components/`(LineChart·PostsTable·CorrelationPanel·FiltersBar), `perf-utils.tsx`(ElapsedTimer·useStableHandlers).
- `web/app/api/` — 46개 route.ts. 시트 sync(bulk·sync·stats-import·marketing)는 Apps Script push 수신(body 필수, 크론 아님).
- `web/lib/` — supabase-server, apify, url-utils(ALLOWED_POST_URL_RE·normalizeUrl), stats-guard(단조보정), google-sheets, cron-auth(checkCronAuth), logger(`logger.warn(module,msg,data?)`), dateRule.
- `scripts/run_monitoring.py` — **일일 수집 실주체**(Python). `.github/workflows/` — 크론들.

## 3. 데이터 수집(자동화) 아키텍처 — 중요

- **실주체 = `scripts/run_monitoring.py`** (GitHub Actions가 매일 실행). 플랫폼별 `_fetch_*` + 도메인 필터로 조회수 수집해 Supabase에 직접 적재(Vercel API 안 거침).
  - IG: `apify/instagram-scraper`. 간헐 차단 시 폴백 `data-slayer/instagram-post-details`(2.7배 비쌈 — 누락분만·예산가드 필요).
  - 트위터/X: `apidojo/twitter-scraper-lite` (⚠️ startUrls 끝슬래시 붙으면 0건 → `_tw_norm` 정규화 필수).
  - 틱톡: 살아있는 영상만(0=접근불가 건너뜀). FB/스레드는 조회수 없음.
  - 조회수는 **누적·단조증가**(monotonic max 가드). 감소=수집오류로 간주.
- **`.github/workflows/cron-daily-collect.yml`** — run_monitoring + Vercel API curl 4개(brand-metrics/collect·youtube-trends/collect kw=0,1·b2b-revenue/fetch)를 GET+Bearer(CRON_SECRET). 스케줄은 혼잡 피해 `:41` 3개 창(UTC) + "오늘 이미 수집됨" 게이트. `workflow_dispatch` input `api_only=true`(IG 건너뛰고 보조만). **호출 URL은 워크플로 상단 `env.APP_URL`(=`https://influencer-seeding-mu.vercel.app`)로 중앙화** — 도메인 바꿀 땐 이 한 줄만. 각 curl은 **응답이 2xx 아니면 `::error`+`exit 1`로 단계 실패**(조용한 무성공 처리 방지, 3f6745c). cron-kpi.yml도 동일 패턴.
- 다른 크론: `cron-kpi.yml`(kpi/fetch), `daily-increment-report.yml`(09:30 증분 리포트 슬랙), `monitoring-retry.yml`(데이터 없을 때만 재수집), `dumppokbar-reminder.yml`.
- **보조 지표 출처**: brand-metrics(IG 프로필 방문 ig_profile_views), **유튜브 검색량 = Google Trends**(`youtube_search_trends`, Apify gprop=youtube, **OAuth 불필요**). ⚠️ `yt_search_views`(Analytics OAuth)는 1d36401에서 **의도적으로 폐기된 죽은 필드**(영구 null, 복구대상 아님 — "OAuth 필요"로 오판 말 것).
- 슬랙(여믄봇): 수집상태 DM(황경원) + 09:30 증분 리포트(#빙과_마케팅_리포트, TOP10 하이퍼링크). 채널 발송은 봇이 멤버여야 함.

## 4. 주요 DB 테이블

`sponsored_posts`(협찬 게시물·메타), `post_daily_stats`(일별 조회수·measured_at, 단조), `influencers`+`screening_metrics`, `b2b_daily_metrics`(시트 동기화, dumbuk/jjondeuk_order·total_order — ⚠️ dumbuk_order는 실제 CVS발주량, jjondeuk_order=B2B발주량, 일요일=0 정상), `brand_daily_metrics`, `youtube_search_trends`, `memos`(팀 메모, 수동 SQL 1회 생성), `jobs`(수집 작업 큐).

## 5. ⚠️ Vercel 사용량 / 도메인 현황 (기준일 2026-06-30 — 반드시 현재 상태 재확인)

- **6/30 Hobby 무료한도 3배 초과로 배포 정지**(402): Function Invocations 3.2M/1M, Fluid CPU 11h/4h, Origin Transfer 18GB/10GB, Edge Requests 1.7M/1M. Hobby는 리셋돼도 자동 resume 안 됨(커뮤니티 다수 사례) → **Pro 재업그레이드로 복구**. Speed Insights 부가상품은 layout에서 `<SpeedInsights/>` 제거(미사용).
- **도메인 함정 (핵심)**:
  - `influencer-seeding-mu.vercel.app` = **공개 도메인**(배포보호 없음). 정지 여파로 **루트(/)는 404**지만 **API 라우트는 정상**(무인증 401 → Bearer면 200). → **크론은 반드시 `-mu` 사용.**
  - `-kwhwang-s-projects`·`-git-main`·`<hash>-` 등 표준/배포 도메인 = **Vercel Deployment Protection(SSO) ON** → 모든 요청 vercel.com/sso로 **302**. 앱 인증(CRON_SECRET)으로 못 뚫음 → 크론 쓰면 실패.
  - **교훈**: 크론 도메인 판단은 루트 말고 `curl -H "Authorization: Bearer <CRON_SECRET>" .../api/.../fetch`로 직접 찍어 200 확인.
- **미해결**: `-mu` 루트 404 → 팀 브라우저 접속 불가. Vercel 대시보드 Settings→Domains에서 `-mu`를 최신 배포에 재지정하거나, Deployment Protection을 꺼 `-kw`를 공개로. (대시보드/결제 작업 — 사용자가 직접)
- **사용량 절감(일부 적용)**: 보조 GET 라우트 캐싱(`Cache-Control: s-maxage=300, swr=900`) — b2b-revenue·brand-metrics·youtube-trends·product-search-trends·kpi·last-update에 적용됨. **미적용(권고)**: sponsored-posts 페이로드 분리, daily-summary SQL 집계, influencers 페이지네이션, 메모 폴링 완화.

## 6. 알려진 함정 / 규칙 (재발방지)

- **조회수 단조보정은 '화면(클라이언트)'에서도 한다 ⭐**: `monitoring/page.tsx`의 `dailyTotals`가 **게시물별 러닝맥스(`Math.max`)+forward-fill**로 계산(`lastPlay = Math.max(lastPlay ?? v, v)`, 202~203줄) → DB에 수집오류로 0/감소값이 있어도 "일자별 증감"은 직전값을 유지해 **정상 표시**된다. 따라서 **DB의 낮은 값을 직접 clamp하지 말 것**(불필요하고, 잘못 올리면 러닝맥스가 뒷날짜로 전파돼 영구 과대계상됨). 실제 수집 가드는 적재 시점의 `run_monitoring.py`/`lib/stats-guard.ts`가 담당.
- **일자별 증분의 변동성**: 증분(누적 diff)은 **집계 대상 게시물 수가 매일 늘어나면**(늦게 추가된 게시물이 과거 이력을 달고 들어옴) 최근 날짜가 부풀려진다 — 알려진 "증분 귀속" 특성이지 손상이 아님. 오늘(KST)은 수집중이라 표/그래프에서 제외됨.
- **채널분류 표기 표준**: 괄호 앞 공백("바이럴 (영상)"). CHANNEL_TYPES 상수는 공백없음이라, 저장 시 모든 쓰기경로(POST/PATCH/bulk/sync/stats-import/marketing)에서 `normalizeChannelType`로 표준화(623cfab). "온드미디어"도 채널분류(2bfe7dd).
- **조회수=비용 오염 가드**: cost가 play_count로 적재되던 버그 → stats-import에 `play_count==cost` 차단(65e54d9). play_count 유입경로: 스크랩·시트 importStats만(자동 sync는 메타만).
- **수동 수정 보존(manual_fields)**: 시트 동기화가 대시보드 수동수정을 안 덮게. 단 캡션(content_summary)은 시트값 우선 정책. ⚠️ **조회수(play_count)는 정책 변경됨** → 아래 "조회수 입력 최신 우선" 참고.
- **URL 정규화 = 3곳 이식본, 반드시 동기화 ⭐**: 같은 게시물의 URL 변형을 한 글로 접는 로직이 **세 파일에 각각 손으로 이식**돼 있다 — ① 서버 `web/lib/url-utils.ts`의 `normalizeUrl`(정본), ② Apps Script `Combined_Sheet_AppsScript.gs`의 `linkKey_`+`urlKey_`, ③ Python `scripts/notify_status.py`의 `_canon_url`. 접어야 할 변형: **www 유무**(threads.com↔www.threads.com), **IG 계정명-경로형**(`instagram.com/<user>/p/<code>` ↔ `instagram.com/p/<code>`), /reel↔/p↔/tv, youtu.be↔watch?v=, threads.com↔.net. **시트→DB(bulk/stats-import)는 normalizeUrl+`onConflict:url`이라 원래 중복 안 남**(DB가 늘 깨끗한 정본을 가진 이유). 사고는 항상 **역방향 DB→시트**(`pullFromDB`)나 파이썬 정합성 체크가 서버와 드리프트해서 발생 — 2026-07-08 `urlKey_`가 www를 안 떼고 `linkKey_` IG정규식이 계정명형을 못 잡아 스레드·페북·IG 3건이 시트에 중복 추가됨(c9b7a7c 수정). **URL 규칙을 손대면 세 파일 모두 고치고, 실제 URL 쌍을 node로 함수 꺼내 키 일치 검증**할 것.
- **조회수 입력 최신 우선(시트+대시보드 공존, 3852fff)**: 조회수 수기값은 시트·대시보드 둘 다 입력 가능하고 **나중에 사람이 고친 값이 이긴다**. stats-import는 예전 "대시보드 manual 무조건 보존"을 **제거**(시트 정정이 반영 안 되던 반대 문제) → 시트 입력이 대시보드값을 덮고, 시트 입력분도 `manual=true`로 표시해 밤 자동수집(별도 경로)이 안 덮음. 대시보드 PATCH는 그대로 manual 찍고 무조건 씀. mono/cost/pre-posted 가드는 안전망 유지. 한계: 구글 시트는 셀별 수정시각을 안 줘 "행동한 순간=최신"으로 구현 → importStats는 '시트 현재값'을 밀어넣으니 최신 상태로 두고 입력.
- **역방향 baseline 0 파괴(6e915d1)**: run_monitoring의 '신규 게시물 전날 0 baseline' 기능에서 '처음 수집인가' 판정 조회(`seen`)가 **LIMIT 없이 1000행 절단** → 이력 있는 게시물을 신규로 오판, 전날 실측을 0으로 덮어 **증분=누적 뻥튀기**(7/8 79건). 진단 시그니처 `play_count=0 & increment>0`(increment에 당시 실측 남아 복원 가능). Supabase `.in().lt()`류 조회는 **항상 전량 페이지네이션**(기본 1000행 절단이 이 계열 사고의 단골 원인 — sponsored-posts 500·증분 오락가락도 동일).
- **Apify 비용 구조**: 비용 거의 전부 IG 스크래퍼. 프로필형 URL(shortcode 없음)이 directUrls에 섞이면 계정 통째로 긁어 과수집 → 3개 경로에 shortcode 가드(beeb142). 월 한도 관리 필수. 검증은 최소표본·액터당 1회(풀수집 반복 금지).
- **자동 종료**: 위성채널·온드미디어 프로젝트는 ended_at 자동종료 제외(apify-webhook handleMonitoring 한 곳).
- **시트 sync 인증**: bulk·stats-import에 Bearer(CRON_SECRET). Apps Script 스크립트 속성에 CRON_SECRET 필요.
- **당일 데이터 표시**: 게시물별 수집완료분만 당일 반영(play_collected). "수집했는데 옛값"=캐싱 아닌 '오늘 제외' 설계일 수 있음.
- **자격증명 발급 전 필요성 확인**: 빈 값=버그 아닐 수 있음(의도적 미사용). 발급/API활성화 시키기 전에 "정말 필요한가" 먼저.

## 7. 자격증명 / 시크릿 위치 (값은 절대 코드/문서에 박지 말 것)

- 웹: `web/.env.local` (Clerk, SUPABASE_URL/SERVICE_ROLE_KEY/ANON, APIFY_API_TOKEN, APP_URL, NAVER, NOTION, META_BUSINESS).
- 스크립트: `scripts/.env` (APIFY, SUPABASE_URL/SERVICE_ROLE_KEY). 로컬 실행 시 `PYTHONUTF8=1` 필수(cp949 이모지 크래시), 실제 python은 `C:\Users\hwangkw\AppData\Local\Python\pythoncore-3.14-64\python.exe`(bare `python`은 깨진 스텁).
- GitHub Secrets: APIFY_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, **CRON_SECRET**, SLACK 등. (CRON_SECRET 값은 GitHub Secrets/`.env`에서 확인 — 문서에 안 적음)

## 8. 남은 작업 / 효율화 권고 (코드 리뷰 결과)

- 🔴 사용량 직격: `api/sponsored-posts` GET 페이로드 분리(전 게시물+전체통계 반환=18GB transfer), `api/daily-summary` SQL 집계(현재 풀스캔+JS집계), `api/influencers` 페이지네이션+캐시, 메모 폴링 20s→탭숨김 정지.
- 🟠 Apify/자동화: run_monitoring 루프 내 per-post 쿼리(인플루언서·통계이력 ×6플랫폼)를 `.in_()` 배치로(수백~수천 쿼리 절감), IG 폴백 누락분만+예산가드.
- 🟡 렌더: monitoring/page.tsx에서 LineChart에 넘기는 postsOnDate·extraSeries·mainAdCosts를 useMemo/useCallback로 고정(현재 매 렌더 재생성→memo 무력화).
- ⚪ 정리: `api/monitoring/run`은 동작 안 하는 죽은 스텁, 여러 라우트가 `createClient()` 직접 호출(→ getServerSupabase 싱글톤).

## 9. 검증 체크리스트 (배포 전/후)

- 배포 전: `cd web && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` (0건) → `npm run build` 통과.
- 자동화 변경 시: 그 자동화의 정확한 호출을 인증까지 포함해 직접 찍어 200 확인.
- 배포 후: 실제 도메인에서 동작 확인(`-mu`는 API만, 팀 접속은 별도). 자동수집은 다음 날 데이터 적재로 확인.
- 로컬 dev는 Clerk 인증·DB 접근 401이라 데이터 화면 검증 어려움 — 빌드/타입체크 + 라이브 확인 병행.
