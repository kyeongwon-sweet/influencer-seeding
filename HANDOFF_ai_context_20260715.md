# HANDOFF — AI 세션 공용 컨텍스트 (2026-07-15)

> 목적: 협찬 모니터링 대시보드를 여러 AI 세션(Claude 여럿·Codex·Claude in Chrome·시트세션)이 동시에 만지면서
> 생긴 조율 실패·데이터 사고를 막기 위한 **단일 컨텍스트 문서**. 작업 전 필독, 변경 후 갱신.
> 정본 상태판은 `AI_SHARED_STATUS.md`, 이 문서는 "무엇을·어디서·어떻게"의 지도.

---

## 0. 🚨 절대 규칙 — 데이터 무결성 (모든 AI 필수, 예외 없음)
- **실측이 없으면 값을 지어내지 않는다.** 조회수/도달수 등은 **실제 수집(Apify) 또는 팀이 실제로 본 값**만 DB·시트에 넣는다.
- 수집 불가(틱톡 민감영상 POST_SENSITIVE·not_found)·미측정 → **비워둔다.** (마지막 값 복사·타 게시물 값·추정치 저장 금지)
- 이상치는 **자동 보정 금지, 감지 알림만.** 사람이 실측으로 정정.
- ⚠️ **빈 값(측정 없음)을 0으로 읽지 말 것** (공백≠0, 증분·누적 깨짐).
- **오염 제거로 빈칸이 생기면 반드시 "이 게시물 실측 필요" 목록으로 사람에게 보고.** (조용히 빈칸으로 두지 말 것 — 자취생 사고 교훈)

---

## 1. ⚠️ 동시 세션 조율 (이번 사고의 근본 원인)
- **여러 Claude 세션 + Codex가 같은 Supabase DB를 동시에 쓴다.** "DB=Claude 단일 소유"는 **현실과 다름** — 실제로 여러 세션이 DB에 씀.
- 실제 사례: 자취생 76,323 행을 **다른 세션이 오늘 19:10(KST) 생성**(`created_at=2026-07-15T10:10:02Z`), 이 세션은 몰랐음.
- **작업 전 필수 절차:**
  1. `AI_SHARED_STATUS.md` + 이 문서 읽기.
  2. DB 쓰기 전 **현재 상태를 먼저 조회**해서 다른 세션이 이미 처리했는지 확인.
  3. 파괴적/대량 변경 전 **백업 + 사람 승인.**
- 세션 목록 확인: CCD session_mgmt MCP(`list_sessions`, `search_session_transcripts`, `send_message`)로 다른 세션이 뭘 했는지 검색 가능.

---

## 2. 소유권 모델 (충돌 방지)
| 영역 | 담당 | 비고 |
|---|---|---|
| DB 읽기/정합 조사·정정 | Claude (이 세션) | **쓰기 전 반드시 현재 상태 재조회** |
| 배포(`vercel --prod`)·수집 자동화·코드 | Codex | prod는 수동 CLI 배포(자동배포 아님) |
| Apps Script(.gs)·구글 시트 UI | 시트세션 / Claude in Chrome / 사용자 | 시트=위치기반, 값 직접 편집 |
| Apify 수집 실행 | Codex / `run_monitoring.py`(GHA) | 검증은 최소 표본으로(월 한도) |

- **금지:** `organic/page.tsx` 재커밋(Codex 영역), `posted_at`(게시일) 수정, 시크릿을 채팅/문서에 출력.

---

## 3. 진행 중 현안 (2026-07-15 기준)

### (A) 자취생으로 살아남기 — `/p/DYFBwz5GlJ7/`
- **최종 확정값 = 76,323** (2026-05-26 종료, 선정님 시트 댓글 "5/26 기준 76,323" 확인, DB `manual=true`).
- **DB·시트·대시보드 모두 76,323 일치. 잠금됨**(ended_at 과거 → 자동수집 스킵, manual → 하향 방지).
- ⚠️ **5/8~5/26 일별 히스토리는 DB·연동시트·디스크 어디에도 없음**(삭제됨, 백업 없음). **지어내지 말 것.**
- 진행: Claude in Chrome이 **원본 입력 탭**(연동 탭 아님)에서 자취생 일별 궤적 잔존 여부 읽기 중(읽기전용). 실제 증가 궤적이면 복원 검토, 오염(평평/822,210류)이면 76,323만 유지.

### (B) 하토토 시트 공백 — URL 형식 불일치
- DB 하토토 = `https://www.instagram.com/p/DZ1L0iLzahp/` (98,362 보유).
- 시트 하토토 = `/reel/DZ1L0iLzahp/` → `채워두기`(stats-for-sheet)가 URL 완전일치로 매칭 → **불일치로 공백.**
- **DB는 /reel/ 0건(전부 /p/로 정규화 완료), 시트에만 /reel/ 잔재.**
- 임시조치(Chrome): 시트 하토토 URL `/reel/→/p/` 수정 후 재채움.
- **영구조치(Codex): `stats-for-sheet` 매칭을 URL 완전일치 → shortcode 기준으로 변경.**

### (C) "수집기록 없는 150개 URL"
- 채워두기가 매칭 실패로 공백 처리한 URL 150개. **일부는 (B)처럼 /reel/ 형식 불일치, 일부는 진짜 미수집.**
- Chrome이 /reel/ 개수 목록화 중 → Codex가 형식불일치/진짜미수집 분리 감사.

### (D) syncAll(미분류 동기화) 401
- Apps Script `전체 다시 시작`/`일자별 조회수 입력`은 CRON_SECRET 필요 → 값 불일치 시 401.
- 조치: Apps Script 스크립트 속성 `CRON_SECRET` = Vercel 환경변수 값으로 맞춤(Codex/사용자, **값은 절대 출력 금지**).
- `채워두기`(exportStats/GET)는 인증 불필요 → 401 안 남.

---

## 4. 파일·경로 지도 (실재 확인됨)

### 저장소 (같은 repo의 2개 워크트리)
- 메인 체크아웃: `C:\Users\hwangkw\AI\.claude\influencer-seeding\`
- 워크트리(이 세션): `C:\Users\hwangkw\AI\.claude\wt-company\`
- GitHub: `kyeongwon-sweet/influencer-seeding`
- **정본 브랜치: `refactor/monitoring-decompose`** (main 아님). ⚠️ prod는 이 브랜치 기준 **수동 배포**.
- 프로덕션: `https://influencer-seeding-mu.vercel.app/monitoring`

### 상태·설계·핸드오프 문서 (repo 루트)
- `AI_SHARED_STATUS.md` — 정본 상태판(작업 전 필독/후 갱신)
- `CLAUDE.md` — 절대 규칙 + 프로젝트 개요
- `DESIGN_oneway_db_source_of_truth.md` — 재발방지 설계("안전한 양방향")
- `HANDOFF_cluster_contamination_20260714.md` — 클러스터 오염 마스터 목록/실측값
- `HANDOFF_ai_context_20260715.md` — (이 문서)

### 코드 (web/)
- `web/app/monitoring/page.tsx` — 모니터링 페이지(patchPlayCount, measured_at 전달)
- `web/app/monitoring/components/PostsTable.tsx` — 표/툴팁
- `web/app/api/sponsored-posts/stats-import/route.ts` — 시트→DB(가드: copy/dup-column/spike/mono)
- `web/app/api/sponsored-posts/stats-for-sheet/route.ts` — DB→시트(채워두기 소스). **shortcode 매칭 개선 대상**
- `web/.env.local` — 웹 시크릿(**여기서만 로드, 출력 금지**)

### 스크립트
- `scripts/scan_cross_post_copies.py` — 교차복사 오염 스캐너(주간 GHA). 실행:
  `PYTHONUTF8=1 <python> scripts/scan_cross_post_copies.py [최소일수=2] [최소값=10000]`
- `Combined_Sheet_AppsScript.gs` — 구글 시트 바인딩 스크립트(**시트세션 영역, 읽기만**). exportStats/importStats/syncAll + dup-date 가드.

### 툴체인 (윈도우)
- Python(진짜 실행파일): `C:\Users\hwangkw\AppData\Local\Python\pythoncore-3.14-64\python.exe`
  (⚠️ 맨 `python`은 깨진 스텁. 이모지 출력 시 `PYTHONUTF8=1` 필수, cp949 즉사)

### 구글 시트
- 시트 ID: `10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak`
- `콘텐츠 대시보드 연동` 탭: K:BW = 날짜열(exportStats DB→시트 미러). 데이터행 ~929, 이후 신규 대기.
- 원본/입력 탭: 팀 수기 추적(Combined_Sheet). 자취생 일별 히스토리 후보지.
- 메뉴 `🚀 광고 모니터링`:
  - `수집 조회수 시트로 채워두기` = exportStats (DB→시트, GET, **인증 불필요**)
  - `일자별 조회수 입력` = importStats (시트→DB, **CRON_SECRET 필요**)
  - `전체 다시 시작` = syncAll (bulk, **CRON_SECRET 필요**)

---

## 5. DB 접근 (Supabase) — 시크릿 출력 금지

```bash
# 키는 web/.env.local 에서 로드 (값을 채팅/문서/커밋에 절대 노출 금지)
export SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' \
  /c/Users/hwangkw/AI/.claude/influencer-seeding/web/.env.local | cut -d= -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' \
  /c/Users/hwangkw/AI/.claude/influencer-seeding/web/.env.local | cut -d= -f2)
# REST: {URL}/rest/v1/{table}?...  헤더 apikey + Authorization: Bearer
# 페이지네이션은 Range 헤더로 1000행씩 (range()는 유일 정렬키 필수 — measured_at 단독 금지, id 2차정렬)
```

- 핵심 테이블:
  - `sponsored_posts` (id, account_name, project_name, url, ended_at, channel_type, ...)
  - `post_daily_stats` (id, post_id, measured_at, play_count, reach_count, increment, manual, created_at, ...)
- 불변식: **게시물별 Σ증분 == 최종 누적.** 어긋나면 이중계상/누락.
- 증분은 **표시단계 safeIncrement**로 재계산(저장 increment는 폐기 방향). 상세: 메모리 `safe-increment-display-rule`.

---

## 6. 가드·감지 메커니즘 (이미 가동 중)
- `stats-import` 가드: copy-guard(≥2일 타 게시물 일치)·dup-column·spike(≥3×)·mono(하향 방지).
- 주간 교차복사 스캔 GHA(`scan_cross_post_copies.py`) — 진짜의심 0 유지가 목표.
- 오염 시그니처: `play=0 & 증분>0`, 여러 게시물이 같은 (날짜,비-라운드값) 공유.
- **가드는 "감지·차단"만. 정정은 사람 실측으로.**

---

## 7. 대기 작업 (2026-07-15)
- [ ] **Chrome**: 하토토 URL `/reel/→/p/` 수정 → 채워두기 재실행 → 98,362 readback.
- [ ] **Chrome**: 150개 중 `/reel/` 개수·예시 목록(읽기전용).
- [ ] **Chrome**: 원본 입력 탭 자취생 일별 히스토리 읽기(읽기전용) → 진위 판별용.
- [ ] **Codex**: `stats-for-sheet` shortcode 매칭 전환 + 150개 감사(형식불일치/진짜미수집 분리).
- [ ] **Codex/사용자**: Apps Script CRON_SECRET = Vercel 값으로 맞춰 syncAll 401 해소(값 비노출).
- [ ] **Claude(이 세션)**: 위 readback 수신 후 히스토리 복원 판단 + DB↔시트 최종 정합.
