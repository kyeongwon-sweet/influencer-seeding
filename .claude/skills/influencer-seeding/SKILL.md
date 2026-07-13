---
name: influencer-seeding
description: 라라스윗 인플루언서 시딩/협찬 모니터링 대시보드(influencer-seeding 레포) 작업 시의 필수 규칙·아키텍처·함정. 이 레포의 코드(web/ Next.js, scripts/ Python 수집, .github/workflows 크론, Vercel 배포)를 수정·디버깅·배포하거나, 협찬 모니터링·수집·Apify·Vercel 사용량·채널분류·도메인/크론 문제를 다룰 때 사용. 자세한 내용은 레포 루트 ONBOARDING.md.
---

# influencer-seeding 대시보드 작업 스킬

이 레포(Next.js 15 + Clerk + Supabase + Apify + Vercel + GitHub Actions)를 작업할 때 **반드시** 따른다.

## 0순위: 공용 상태판 먼저 읽기 (Codex·Claude 공유)
코드·DB·구글시트·Apps Script·배포를 **바꾸기 전에 레포 루트 `AI_SHARED_STATUS.md`를 먼저 읽는다** — 그게 프로젝트 현재 상태의 정본(단일 진실)이다. 내 개인 메모리·이 스킬·`ONBOARDING.md`는 배경·이력용이며, 최신 상태·정책은 항상 `AI_SHARED_STATUS.md`로 검증한다(메모리에만 의존 금지). **의미 있는 변경(커밋·배포·데이터 수정·Apps Script·정책 결정) 후에는 `AI_SHARED_STATUS.md`를 갱신**하고, 미검증 사항은 "미검증"이라 적는다. 비밀번호·토큰·service key는 절대 적지 않는다. 전체 맥락은 `ONBOARDING.md` 참고.

## 절대 규칙 (안 지키면 사고)
1. **편집 직전 `git fetch origin main` / pull.** 다른 세션이 동시 편집한다(작업트리가 브랜치를 오감). 스테일 트리 커밋 = 남 작업 덮음.
2. **변경은 `git worktree`로 격리.** main 작업트리 직접 편집 금지.
   `git worktree add ../wt origin/main` → 브랜치 → 편집 → 검증 → `push origin HEAD:main`(fetch+rebase 루프) → 정리(정션·worktree 제거).
   worktree엔 node_modules 없음 → PowerShell Junction으로 메인 `web/node_modules` 연결, 정리 시 정션 먼저 링크만 제거.
3. **푸시 전 빌드/타입체크.** `ignoreBuildErrors:false`라 타입에러=빌드실패. `cd web && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` → `npm run build`. (incremental 캐시가 에러 숨김 주의.) pre-push 훅이 tsc 자동 실행.
4. **route.ts는 핸들러(GET/POST 등)만 export.** 헬퍼 export 금지(빌드 실패).
5. **자동화/엔드포인트를 바꾸기 전에, 그 자동화가 하는 정확한 호출(메서드+경로+인증)을 그대로 찍어 200 확인.** 옆 URL 상태코드/302로 추론해 행동 금지(302=차단일 수 있음). "고쳤다" 전에 실제 결과 검증.

## 핵심 아키텍처
- **일일 수집 = `scripts/run_monitoring.py`**(GitHub Actions, Supabase 직접 적재). 플랫폼별 `_fetch_*`. IG=apify/instagram-scraper(폴백 data-slayer), 트위터=twitter-scraper-lite(끝슬래시 0건 함정). 조회수 누적·단조(max 가드).
- **보조 지표**: brand-metrics(IG방문)·**유튜브 검색량=Google Trends(OAuth 불필요)**·b2b(시트)·kpi를 `cron-daily-collect.yml`/`cron-kpi.yml`이 Vercel API로 GET+Bearer(CRON_SECRET) 호출. ⚠️ `yt_search_views`(Analytics OAuth)는 죽은 필드.
- **시트 sync**(bulk·sync·stats-import·marketing)는 Apps Script push 수신(body 필수, 크론 아님).

## 자주 무는 함정
- **Vercel 도메인(기준 2026-06-30)**: 크론은 **`influencer-seeding-mu.vercel.app`** 사용(루트는 404여도 API는 정상, Bearer면 200). `-kwhwang-s-projects` 등은 **Deployment Protection(SSO 302)** 라 크론 막힘. 도메인 판단은 `/api/...`를 Bearer로 직접 찍어 확인. (크론 URL은 워크플로 `env.APP_URL` 한 곳에 있음, 각 curl은 비2xx 시 `::error`+exit로 실패 — 3f6745c.)
- **채널분류 표준=괄호 앞 공백**("바이럴 (영상)"). 저장 시 `normalizeChannelType`(모든 쓰기경로) 표준화.
- **조회수=비용 오염 가드**(stats-import play_count==cost 차단), **manual_fields 보존**(캡션만 시트 우선), **자동종료 제외**(위성채널·온드미디어).
- **Apify 비용**=대부분 IG 스크래퍼. 프로필형 URL(shortcode 없음) 섞이면 과수집 → shortcode 가드. 검증은 최소표본.
- **증감색**: 증가=빨강/감소=파랑. B2B 값만 초록(계열색).
- **URL 정규화 3곳 동기화 필수**: 같은 게시물의 URL 변형(www 유무, IG `instagram.com/<계정명>/p/<code>` 계정명-경로형, /reel↔/p, threads.com↔.net)을 한 글로 접는 로직이 **세 파일에 각각** 구현됨 — 서버 `normalizeUrl`(web/lib/url-utils.ts), Apps Script `linkKey_`+`urlKey_`(Combined_Sheet_AppsScript.gs), Python `_canon_url`(scripts/notify_status.py). 한쪽만 고치면 어긋나 **pullFromDB(DB→시트)가 이미 있는 글을 시트에 중복 추가**함(2026-07-08 스레드·페북·IG 계정명형 3건). 서버 sheet→DB는 normalizeUrl+`onConflict:url`이라 원래 안전 → 사고는 늘 시트/파이썬이 서버와 드리프트해서 남. URL 규칙 손대면 세 곳 다 고치고 **실제 URL 쌍으로 키 일치 검증**(node로 함수 꺼내 대조).
- **조회수 입력 = "가장 최근에 사람이 고친 값이 이긴다"**(시트+대시보드 공존, 3852fff): stats-import는 대시보드 manual을 **덮음**(예전 무조건보존 제거)+시트입력분도 manual=true. 대시보드 PATCH도 manual 찍고 무조건 씀 → 나중 저장이 이김. 밤 자동수집은 별도 경로라 manual 안 덮음. importStats는 '시트 현재값'을 밀어넣으니 최신 상태로 두고 입력. 시트는 셀별 수정시각 없음 → "행동한 순간=최신".
- **역방향 baseline 0 파괴**(6e915d1): run_monitoring '처음 수집' 판정(`seen`)이 LIMIT 없어 1000행 절단 → 기존 게시물을 신규 오판, 전날 실측을 0으로 덮음(증분=누적 뻥튀기). 진단 시그니처 `play=0 & increment>0`. Supabase `.in().lt()` 조회는 **항상 전량 페이지네이션**(1000행 기본 절단 주의).

## 사용량 절감 권고(미적용)
sponsored-posts 페이로드 분리, daily-summary SQL 집계, influencers 페이지네이션, 메모 폴링 완화, run_monitoring 루프 내 per-post 쿼리 배치화. (상세 ONBOARDING.md §8)

## 시크릿
값은 코드/문서에 박지 말 것. 위치: `web/.env.local`, `scripts/.env`, GitHub Secrets(APIFY·SUPABASE·CRON_SECRET·SLACK). 로컬 Python은 `PYTHONUTF8=1` + 실제 python.exe 경로 사용.
