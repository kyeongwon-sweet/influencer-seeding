# AI 세션 인계 — influencer-seeding

> **파일명에 날짜를 붙이지 않는다.** 예전에 `HANDOFF_ai_context_20260715.md`(refactor 브랜치에만 있었고
> main 에는 한 번도 존재하지 않음)와 `HANDOFF_ai_context_20260905.md` 두 개가 생겨, 상태판과 메모리가
> **없는 파일을 정본으로 가리키는 죽은 포인터**가 됐다. 2026-09-10 에 하나로 통합했다.
> 갱신할 때 **새 파일을 만들지 말고 이 파일을 고쳐라.**

최종 갱신 **2026-09-10 12:30 KST** · 대상: 다음 AI 세션(Claude/Codex/기타).
이 문서는 **스냅샷**이다. 정본 상태는 항상 `AI_SHARED_STATUS.md`(맨 위가 최신)이고,
이 문서와 어긋나면 **상태판이 이긴다.**

---

## 0. 지금 상태 한 눈 (2026-09-10 12:30 KST)

| 항목 | 값 |
|---|---|
| `origin/main` | `31214938` |
| 워크트리 | `C:\Users\hwangkw\_yeomun_wt` (main 체크아웃) |
| 최근 큰 사건 | **09-08 유튜브 268건 전량 미수집 = 액터 스키마 변경**(§2-B). 수정 후 09-09 257/260 · 09-10 263/275 정상 |
| 새 워치독 | notify_status 체크 **⑨ 가격미매핑 전수 · ⑩ 플랫폼 수집 붕괴 · ⑪ 안전망 비활성** |
| 미결(사용자) | `YOUTUBE_API_KEY` 시크릿 미등록 · 09-08 증분 리포트 `update_ts` 편집 여부 |
| 미결(Codex) | C12(syncAll + 캡션 백필) · C13(슈기 H수식 1행) — §7 |

⚠️ **착수 전 `git fetch` + 남의 미커밋 WIP 확인.** 2026-09-10 12:30 현재
`scripts/owner_fields_guard.py`·`scripts/test_owner_fields_guard.py` 에 **다른 세션의 미커밋 변경**이 있다. 건드리지 말 것.

---

## 1. 진입 순서 (반드시 이 순서로)

1. `CLAUDE.md` — 절대 규칙(데이터 무결성·API 키)
2. `AI_SHARED_STATUS.md` **맨 위 10~15 섹션** — Codex/다른 세션이 방금 한 일
3. `git log --oneline -20` + `git status` — 남의 미커밋 WIP 확인
4. 이 문서 §2(내가 틀린 판정) → §6(절대 규칙) → §7(열린 항목)

---

## 2. ⚠️ 최우선: 내 오염 판정이 뒤집혔다 (같은 실수 반복 금지)

**2026-09-03에 내가 "교차오염 확정"이라고 판정해 삭제를 권고한 값이, 실제로는 팀의 수기 기준선이었다.**

```
이짓매거진  /p/Dcf5OKEiZvJ/  (협찬 파워채널/매거진, 게시 2026-08-26)
  시트 08-26~08-30 = 116,853  ← 팀이 시트에만 수기 관리하는 값의 carry-forward
  시트 09-02       = 180,654  ← 사용자가 IG 인사이트에서 확인해 입력
  정상 증분 = 180,654 − 116,853 = +63,801
```

내가 한 오판과 그 결과:
1. "5일 연속 완전 동결 = 자동 전파 오염" 으로 판정 → 삭제 승인 권고
2. `repair-metric-spikes-20260903` API 가 08-26~08-30 을 play·reach 양쪽 NULL 로 지움
3. **기준선이 사라져 `safeIncrement` 가 09-02 를 '첫 측정=전액'으로 잡아 리포트 증분이 +63,801 → +180,654 로 튐** (시트 I열 63,801과 불일치)
4. 이후 08-26 기준선 복원 + Codex 가 그 repair API 를 **영구 차단**(`9f67a27e`) — 판단이 뒤집힌 것이라서

### 왜 틀렸나 (다음 세션이 피해야 할 추론)

- **IG `/p/` 협찬글은 스크래퍼가 조회수(videoPlayCount)를 못 얻는다.** 좋아요만 저장되고 `play=None, manual=False` 행이 매일 19시경 생긴다. 그래서 팀이 **인사이트 값을 연동시트에만 수기로 관리**한다.
  → **이 유형에서 값이 며칠 동결되는 것은 정상이다.** 동결을 오염 근거로 쓰면 안 된다.
- 116,853 이 `486__humor` 시트 행(DM1280)에도 있었는데, 나는 "486__humor 가 원본이고 이짓매거진이 오염 피해자"로 읽었다. **방향이 반대였을 가능성이 크다** — 이짓매거진이 원본 수기값이고 그 값이 다른 행으로 흘러간 것.
  → 같은 값이 여러 행에 있으면 **어느 쪽이 원본인지부터 판정**하라. 수기 관리 게시물이 원본일 수 있다.

### 현재 정합 상태 (건드리지 말 것)

```
DB  08-26  play=NULL  reach=116,853  manual=True   ← 기준선
DB  09-02  play=NULL  reach=180,654  manual=True
증분 +63,801 (리포트·댓글·대시보드·시트 I열 전부 일치)
```

매거진은 게시일 ≥ `MAGAZINE_BANNER_FROM=2026-08-18` 이면 **배너 판정 → reach 가 정본 필드**다
(`isBannerChannel(channel_type, posted_at)`). 그래서 play→reach 필드 이동이 이뤄졌다.
백업: `data/output/ijit_fieldmove_backup_20260904.json`, `data/output/ijit_backup_20260903.json`.

---

## 2-B. ⚠️ 2026-09-08 유튜브 268건 전량 미수집 — "장애"가 아니라 **스키마 변경**

하루아침에 활성 유튜브 275건 중 **268건**이 미수집됐다(백업 포함 3회 실행 전부: 실값 7 → 0 → 0).
로그는 `no_collector_response` · `미반환 262건` 이라 **스크래퍼 장애처럼 보였다.**

**실제 원인(URL 2개 최소 프로브로 응답 본문을 직접 열어 확인):**
`streamers/youtube-scraper` 가 Shorts 아이템의 `url` 을 `"https://www.youtube.com/shorts/"`
(**영상 ID가 잘린 값**)로, `id` 를 `""` 로 반환하도록 바뀌었다. **`viewCount` 는 정상으로 들어온다.**
`_yt_id(it["url"])` 가 None 이 되어 **아이템을 통째로 버렸고**, 그게 '미반환'으로 찍혔다.
단서: `watch?v=` URL 7건만 살아남았다 → **URL 형식별로 결과가 갈리면 매칭 실패를 의심하라.**

**재발방지 3층(전부 배포됨):**
1. `_yt_item_id()` — `url → id → thumbnailUrl(/vi/<id>/) → input(요청 URL 에코)` 순 복구 (`17f9ddca`)
2. **모든 플랫폼**의 매칭 실패를 세어 경고 + AST 계약 테스트로 강제 (`fd961bce`).
   같은 무음 폐기(`if not key: continue`)가 **7곳**에 있었다 — 유튜브·틱톡·스레드·페북·트위터·
   인스타(본·data-slayer 폴백)·인스타 계정 생존 스캔. ⚠️ 계정 생존 스캔이 특히 위험하다(핸들 추출이
   깨지면 '계정 사망' 오판 → `ended_at` 종료까지 번진다).
3. 경고에 **버려진 아이템의 키 목록**을 함께 출력 (`c2cd82ad`) — 아래 오진 때문에 추가했다.

**⚠️ 여기서 내가 또 오진했다(같은 실수 금지):** 위 카운터가 잡은
`인스타 폴백(data-slayer) 2/3건 매칭 키 추출 실패` 를 "유튜브와 같은 스키마 변경"으로 보고했는데,
프로브해보니 **`code` 필드는 멀쩡했다**(개별 실패 스텁이었다). 원인이 둘인데
**경고 문구가 한 가지 원인('스키마 변경 의심')만 적어놔서 그 문구를 읽은 내가 그대로 결론냈다.**
→ 교훈: **경고에는 가설이 아니라 판별에 필요한 사실을 담아라.**

---

## 3. 환경·툴체인 (여기서 시간 낭비하지 말 것)

```
저장소 워크트리   C:\Users\hwangkw\_yeomun_wt          ← 여기서 작업 (main 체크아웃)
카노니컬 repo     C:\Users\hwangkw\AI\.claude\influencer-seeding
env 정본          C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local
⚠️ 워크트리 web/.env.local 은 값이 전부 "" 인 스텁 → 쓰면 조용히 실패
python            C:\Users\hwangkw\AppData\Local\Python\pythoncore-3.14-64\python.exe
                  (bare `python`·`python3` 는 깨진 스텁)
필수 환경변수     PYTHONUTF8=1  (없으면 cp949 콘솔에서 이모지·한글 즉사)
```

**DB 조회는 반드시 `scripts/db_probe.py` 를 import** (`585f5a6c`, 공지 `533691be`).
애드혹으로 `urllib` 직접 쓰면 아래 함정을 또 밟는다 — 내가 하루에 네 번 밟았다:

| 함정 | 대체 API |
|---|---|
| `play_count` 만 조회 → 값이 `reach_count` 에 있어 "0행" 오판 | `metric(row)` (play 우선·없으면 reach, `play==0` 은 실측이라 None 아님) |
| `format(v or 0)` → **NULL 을 0 으로 출력**(공백≠0 위반) | `fmt(v)` (None → `"NULL"`) |
| `limit=3000` 줬지만 PostgREST 상한 1000 → 첫 페이지를 전체로 보고 | `fetch_all` (limit/offset 금지·끝까지 페이지네이션·유일키 id 강제) / 개수는 `count()` |
| 검증 날짜 창을 어림해 실제 변경일을 비켜감 | `assert_window_covers(manifest, from, to)` |

---

## 4. 시스템 지도 (데이터 흐름)

```
[Apify] ──> run_monitoring.py (GHA cron-daily-collect) ──> post_daily_stats
                                                              │
[연동시트] ──importStats/bulk──> DB (메타·수기 조회수)        │
   │  ▲                                                       │
   │  └──exportStats(역채움, T-1)────────────────────────────┘
   └──banner-reach-sync(시트 per-date → DB reach_count)  ← 배너 도달수 단일 경로

대시보드/리포트 = DB 기반. 시트는 팀 입력 정본.
```

핵심 규칙:
- **배너**(`바이럴 (배너)`, 매거진 게시일 ≥ 08-18)는 `play_count` 없고 **`reach_count`** 가 지표.
- 배너 reach 는 **시트 수기 → `banner-reach-sync` 단일 경로**. run_monitoring 자동 스냅샷은 비활성(되살리지 말 것).
- `exportStats` 는 **오늘 날짜 절대 안 씀**(T-1). 수집값 있는 날짜만 갱신, 수동값 보존.
- 증분은 **표시 단계 `safeIncrement`** 로 재계산(저장 `increment` 컬럼 폐기).
  `오늘값 − 직전 유효(>0)값`, 직전 유효값이 없으면 **게시 후 7일 이내면 전액·초과면 null**(백로그 스파이크 방지).
  ⚠️ "공백을 0으로 본다"가 아니다 — 별도 규칙이다.

---

## 4-B. 연동 시트 (위치·메뉴·인증)

- 시트 ID `10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak` (⚠️ `1QWpAQU9…` 는 오기)
- `콘텐츠 대시보드 연동` 탭: 날짜열이 가로로 이어짐(2026-09-10 기준 **116개**, 지표 구간 `P`~`EA`).
- 헤더↔DB 필드: 업로드일=posted_at · 게시물URL=url · 채널명=account_name · **캡션=content_summary** ·
  **소재명=asset_name** · 채널분류=channel_type · 프로젝트명·상품명·기획자·제작자·업체명·비용.
- 메뉴 `🚀 광고 모니터링` 3종과 **인증 차이**:

| 메뉴 | 함수 | 방향 | 인증 |
|---|---|---|---|
| 수집 조회수 시트로 채워두기 | `exportStats` | DB → 시트(T-1) | 불필요 |
| 일자별 조회수 입력 | `importStats` | 시트 → DB | **CRON_SECRET 필요** |
| ♻️ 전체 다시 추가 | `syncAll` | 시트 → DB(메타 전량) | **CRON_SECRET 필요** |

- 401 이 나면 Apps Script **스크립트 속성 `CRON_SECRET`** 이 Vercel 값과 다른 것이다(값은 절대 출력 금지).
- `dailyAuto` 단계 순서: **`fillCaptionFromAsset` → `syncAll` → syncPricing → … → `importStats` →
  `exportStats` → `syncStatus` → `refreshCumulativeViews` → …**
  ⚠️ 직렬이라 `importStats` 가 30분 상한을 넘기면 **뒤 단계가 통째로 굶는다**(09-07 exportStats 스킵 사고).
  → **낮에 dailyAuto 를 통째로 수동 실행하지 말 것.** 필요한 단계만 공개 진입점으로 돌려라
  (예: 캡션만 = `backfillViralCaptionsFromAsset()`).
- **바이럴 캡션은 소재명에서 파생한다**(사용자 확정 2026-08-24). `captionFromAssetName_` 이
  `.배너`/`.렉카·릴스·숏츠·영상` 표식 다음부터 꼬리 `YYMMDD` 앞까지를 캡션으로 쓴다. **빈 칸에만** 채운다.
- ⚠️ repo 의 `Combined_Sheet_AppsScript.gs` 는 **라이브 배포본보다 낡을 수 있다.** 수정·실행 전 Monaco 실물 확인.

---

## 4-C. DB 접근·불변식·오염 시그니처

```bash
# 키는 정본 env 에서만 로드 — 값을 채팅·문서·커밋에 절대 노출 금지
#   C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local
# 조회는 애드혹 urllib 대신 반드시 scripts/db_probe.py 를 import (§3 함정표)
```

- 핵심 테이블
  - `sponsored_posts` (id, url, account_name, channel_type, asset_name, project_name, product_name,
    company_name, planner, creator, cost, posted_at, created_at, ended_at, notes, not_found_streak, manual_fields)
  - `post_daily_stats` (id, post_id, measured_at, play_count, reach_count, likes_count, comments_count,
    manual, increment, created_at) — ⚠️ `play_collected` 는 **컬럼이 아니라** API 응답 파생 필드다.
- **불변식: 게시물별 Σ증분 == 최종 누적.** 어긋나면 이중계상 또는 누락이다.
- **오염 시그니처:** `play=0 & 증분>0` · 여러 게시물이 같은 `(날짜, 비-라운드 값)` 을 공유 ·
  급등 직후 **완전 동결**. ⚠️ 다만 **동결 하나만으로 오염 판정 금지**(§2 참조).
- `cost` 컬럼에는 **NULL 이 한 행도 없다**(전수 3,534행 확인). 즉 "미기입"과 "무상 확정"이
  같은 값 `0` 이라 컬럼값으로 못 가른다 → 무상 판정 정본은 `channel_kind.free_reason()`:
  **무상채널(온드·위성·무상시딩) · 미러링 · `/서비스` · `무상협찬`**. ⚠️ 판정은 **`account_name` 만** 본다
  (project/asset 에는 위성 139건이 '미러링'을 품어 신호가 오염된다. `asset_name` 에 '팬서비스' 문구도 실재).

---

## 5. 일일 자동화 7종 · 마감 · 폴백

`scripts/cron_watchdog.py` 의 `DAILY_DEADLINE_KST` 가 마감 기준 감시를 한다(나이 기준 아님).

| 워크플로 | 예정(KST) | 유예 | 마감 | 폴백 |
|---|---|---|---|---|
| cron-daily-collect | 00:41 (+02:41·04:41) | 300 | 05:41 | 다중 크론 + Apps Script `collect-fallback` |
| monitoring-validate | 05:00 (+07:00) | 210 | 08:30 | 다중 크론 |
| injibot-daily-report | 06:38 (+07:38·08:38) | 210 | 10:08 | 09:33 외부 폴백(`ensure-daily-audits`) |
| formula-audit | 09:10 | 165 | 11:55 | 09:33 외부 폴백 |
| invalid-creator-fields | 09:25 | 165 | 12:10 | 09:33 외부 폴백 |
| cron-kpi | 10:05 (+12:05·14:05) | 150 | 12:35 | **다중 크론(내가 09-04 추가, `732417c3`)** |
| daily-increment-report | 12:20 (4중~15:20) | 285 | 17:05 | Apps Script 자가치유 + `ensure-daily-report` |

**GHA 스케줄은 자주 지연·드롭된다.** 실제 관측:
- 09-04: 자정수집 2~3시간 지연(드롭 0), 수식감사·제작자감사 **스케줄 드롭** → 09:33 외부 폴백이 살림, KPI 10:05 드롭
- 09-04 KPI 백업 슬롯 실전 결과: 3회 전부 성공(05:43Z·07:55Z·09:28Z) → **데이터는 복구됐지만 첫 실행이 마감(12:35) 이후라 워치독 알림은 울렸을 것**. 즉 "복구는 되고 조용하지는 않은" 상태 — 더 이른 슬롯이 필요한지는 며칠 관측 후 판단.

⚠️ **예정 시각만 보고 "미실행" 단정 금지.** `event=schedule`·`attempt`·실제 실행 시각 분포로 **드롭 vs 지연**을 구별하라(`gh run list --json createdAt,event,attempt,conclusion`).

---

## 6. 절대 규칙 (위반 시 사고)

1. **실측 없으면 값을 지어내지 않는다.** 수집 불가·미측정은 **비워둔다**. 마지막 값 복사·타 게시물 값·추정치 저장 금지.
   **빈 값(NULL)을 0으로 읽지 말 것** — 0은 "아무도 안 봤다"는 실측이다.
2. 이상치는 **자동 보정하지 말고 감지 알림만**. 사람이 실제 값으로 정정.
3. `posted_at` 은 **절대 자동 수정 금지**.
4. 시트 H(누적)/I(증분) **수식 재생성 금지** (2026-08-06 H열 1,765행 손상 사고).
5. **대량 변경 금지** — 최소·수술적 + 롤백 가능하게. 쓰기 직전 baseline + 직후 재감사.
6. 시트 열 **삽입·삭제로 고치지 말 것** (전체 날짜열이 밀린다). 기존 셀에 쓰는 방식만.
7. 공유 기본 필터는 공유 설정이니 함부로 지우지 말 것.
8. ⚠️ **정정(2026-09-05 실측): main 푸시 = ~15초 뒤 `-mu` 프로덕션 자동배포**(Vercel Git 연동). 문서만 고쳐도 배포된다
   → **push 자체가 릴리스**이므로 커밋 전 테스트·`tsc`·build 통과가 배포 게이트다. Claude 임의 `vercel --prod`는 여전히 금지
   (카노니컬 repo가 refactor 브랜치+미커밋일 수 있음). 수동배포 구분자 = `git-main` 별칭 없음.
9. 라이브 Apps Script/시트 쓰기는 하네스가 차단 → Codex 또는 사람 레인.
10. 영구 삭제(파일·메일·메시지)는 하지 않는다. 절차를 안내한다.
11. API 키는 `.env` 에서만. 코드·채팅에 쓰지 않는다.
12. **오염 제거로 빈칸이 생기면 반드시 "이 게시물 실측 필요" 목록으로 사람에게 보고한다.**
    조용히 빈칸으로 두지 말 것(자취생 사고 교훈).
13. **거르는 코드는 거른 개수를 세고, 0이 아니면 말한다.** 조용한 `continue` 가 09-08 유튜브 268건을
    숨겼다. 새 플랫폼·새 파서를 붙일 때 계약 테스트(`test_actor_unmapped_contract.py`)가 이를 강제한다.
14. **안전망은 꺼져 있으면 "꺼져 있다"고 말해야 안전망이다.** Data API 폴백은 코드가 있는데
    시크릿이 없어 조용히 무동작이었다 → 체크 ⑪ 로 매일 알린다.
15. 경고·알림 문구에는 **가설이 아니라 판별에 필요한 사실**을 담는다(원인을 단정해 적으면 읽는 사람이 오진한다).

---

## 7. 열린 항목 (2026-09-10 12:30 실측)

### 사용자 몫 (AI 가 대신하지 않음)
- **`YOUTUBE_API_KEY` GitHub Secret 미등록.** 워크플로 배선(`cron-daily-collect.yml:100`)은 이미 있고
  **시크릿만 없다**. 폴백은 VIDEO_UNAVAILABLE 뿐 아니라 **재시도 후에도 값 없는 전량**을 Data API 로
  보강한다(`yt_unavail = _miss()`). 켜져 있었으면 09-08 의 268건이 살았다. 무료 쿼터 1만/일, 268건≈6 units.
  ⚠️ 옛 메모 "API키 발급 불필요"는 다른 증상 진단이었고 **이 실측으로 뒤집혔다.**
- **09-08 증분 리포트 `update_ts` 편집 여부.** dry_run 대조까지 끝났다. 편집하면 총증분
  `554,316 → 1,039,770`(+485,454)인데 그 **96%가 유튜브가 아니라 슈기 IG 1건**(첫 실측 463,731)이다.
  이틀 지나 중단도 합리적. `replace` 는 쓰지 않기로 확정(ts·스레드 보존).

### Codex 레인 (라이브 시트·Apps Script)
- **C12. syncAll + 캡션 백필** — `backfillViralCaptionsFromAsset()` **먼저**, 그다음 `syncAll`.
  09-09 등록 신규 14건이 **캡션·분류·소재명이 한 묶음으로 안 넘어간 상태**다(원인: dailyAuto·syncAll 이
  팀의 소재명 입력보다 먼저 돌았다. 근거 = DB 에 이 14건의 `channel_type`·`asset_name` 이 전부 비었는데
  시트엔 채워져 있다). ⏰ **자정수집(KST 03:50~04:10) 전**에 끝내야 그날 알림에 반영된다.
  ✅ 그 뒤 알림에서 **영상으로 분류됐는데도 '확인필요'로 남는 계정만** 진짜 대상이다.
- **C13. 슈기 H수식 1행 정정** — 행 3569 `ig:DdBU6JmhltN`. 오늘 수식감사의 유일한 이상(`hInvalid=1`).
  🚫 **H/I 범위 재생성 절대 금지**, 그 셀만. 쓰기 전 baseline → 쓰기 → **직후 formula-audit 재실행으로
  `hInvalid=0` 확인**까지가 완료 조건.
- 관찰: `moduhappy`·`smile_ggobuk_s2`(바이럴 영상)가 09-09 하루 누락. **09-10 결과는 09-11 새벽 수집
  이후에만** 확인 가능 — 그 전에 판단하지 말 것.

### 팀 입력 대기 (값을 지어내지 말 것 — 내부채널 734건 제외 기준)
소재명 **70**(협찬 41·미분류 14·먹스타 9·매거진 6 / 07월 23·08월 13·09월 34로 누적 중) ·
제작자 **113** · 기획자 **89** · 업체명 **67** · 비용 0원 **42**(그중 진짜 미매핑 10건, 체크 ⑨ 가 매일 감시).

### 관측 필요
- **KPI 백업 슬롯 실효성** — 09-04 3회 전부 성공했으나 첫 실행이 마감 이후였다. 슬롯을 앞당길지 판단 대기.
- **Rule A 첫-급등 조기종료 사각 125건** — `detect_spike_freeze` 는 첫 급등에서 판정을 끝낸다.
  **현재 실측 미탐 0건이라 현행 유지 합의.** 실제 사각 사례가 처음 나오면 전수 탐색 + 오탐 백테스트를 함께 설계.
- **⏸️ Meta 헬스체크 워크플로**는 schedule 제거·수동 전용 상태. 토큰 교체 시 ①schedule 재개
  ②상태전이만 알림 ③**실제 Slack 도착 확인**(웹훅 채널 미확인)을 반드시 세트로.

### 닫힌 것 (재론 금지)
- **C9 오늘의 메뉴**(`/p/DbutARtkWS8/`) — 캐러셀이라 **공개 조회수가 없다**. 값 있는 행 16개가 전부
  `manual=true` 이고 값도 전부 동일한 `45,795`(수기 기준선 동결). **자동수집이 끊긴 게 아니라 처음부터 없었다.**
  이후 지표는 팀이 인사이트 실측을 확보했을 때만 시트에 수기 입력.
- **B5 위성 틱톡 미수집** — 큐 제외 버그 아님. 실측 0은 `manual_zero_confirmed` 로 큐에서 제외(`1abad5a4`).
- **D8 Meta 토큰** — 노출 토큰은 **2026-07-11 만료**(공개전환 07-16 보다 5일 앞섬) → 로테이션 불필요.
  남은 건 기능(전환 광고비 그래프 복구용 새 토큰).
- 이짓매거진 08-26 기준선 복원 · `repair-metric-spikes-20260903` **영구 차단**(되살리지 말 것)
- 온드/위성 광고비·업체명 오입력 0건 · `born_ended` 29건 경고만 · 종료일 정정 11건 완료
- 05-17 P열 복구 · 게시 전 종료 저장 차단 · 감사 헤더 파손 알림 라이브
- 미러링·`/서비스`·`무상협찬` cost=0 은 **정상(무상)** 으로 확정(사용자 승인 09-07) — '가격미매핑'으로 세지 않는다.

---

## 8. 협업 프로토콜 (Codex · 동시 Claude 세션)

- 정본 상태판 = `AI_SHARED_STATUS.md`. **작업 전 필독, 변경 후 갱신.** 메모리에 의존해 답하지 말 것.
- **커밋 전 `git fetch` + 남의 신규 커밋 확인.** 상태판은 **추가만**(삭제 라인 0) — 오래된 베이스 위 WIP 를 그대로 커밋하면 남의 섹션이 지워진다(실제로 Codex 09-01~02 섹션 9개가 지워질 뻔했고 내가 복원했다).
- 상태판에 남의 미커밋 WIP 가 있으면: 내 섹션만 분리해 커밋하고(origin 버전 + 내 섹션으로 파일을 재구성 → 커밋 → 남의 섹션 복원) 남의 것은 미커밋으로 남긴다.
- ⚠️ **`git stash` 금지.** stash 스택은 모든 워크트리가 공유하고 다른 세션이 pop 할 수 있다. 필요하면 `git stash push -u -m "<태그>"` 후 SHA 로 `apply`.
- 레인 분담: **DB 읽기·진단·파이썬/웹 코드 = Claude**, **라이브 시트·Apps Script 쓰기·`vercel --prod` = Codex**.
- **다른 세션이 뭘 했는지 검색 가능:** CCD `session_mgmt` MCP (`list_sessions` ·
  `search_session_transcripts` · `send_message`). "다른 세션 탓" 은 금지 — 멀티세션 결과물도 공동 소유다.
- **Codex 몫은 항상 세트로:** 붙여넣기용 인계문 **+** `AI_SHARED_STATUS.md` 기재.
- - Codex 보고를 **액면 수용하지 말 것.** 오늘 두 번, 보고는 맞았지만 내 검증이 부실해 결론이 우연히 맞았다.

---

## 9. 검증 방법론 (내가 오늘 네 번 틀린 이유)

1. **검증 범위를 추정하지 말고 변경 기록에서 받아라.** 백업/작업로그(변경 매니페스트)에 행번호·셀주소·원값·DB값이 다 있다. 계정명·"최근 N일" 같은 어림 범위로 대조하면 검증이 성립하지 않는다.
2. **재구현으로 검증하지 마라.** 라이브 확인을 손으로 다시 쓴 로직으로 하면 실제 코드의 결함이 그대로 남는다(내 헤더 가드가 J:O 메타를 오탐한 걸 그래서 놓쳤다 → Codex `ed4c1e1` 교정).
3. **계약 테스트는 인자·구간 경계까지 고정하라.** "함수를 호출하는지"만 보면 잘못된 인자를 통과시킨다.
4. **대량 형태오류 = 수식보다 헤더 한 칸을 먼저 의심.** 2026-05-17 사고: `P1` 헤더가 깨져 감사가 첫 날짜열을 Q 로 인식 → 그 기준으로 표준식이 재생성돼 **H 수식 3,674개가 Q 시작으로 축소** → 그게 다시 'P↔Q 형태 차이 1,977건'으로 매일 보고. 원인 한 칸이 수천 건 집계에 묻혀 몇 주 방치됐다.
5. gviz 주의: `headers=0` 의 `sum()` 은 **헤더 날짜를 직렬값으로 합산**(2026-05-17 = 46,159). CSV 는 인용 부호 안 줄바꿈이 있어 단순 split 파싱이 밀린다. `out:json` 은 ACCESS_DENIED, `out:csv` 만 가능. 공유 기본 필터로 숨은 행은 조회에서 빠진다(3,480/3,995).

---

## 10. 최근 주요 커밋 지도

```
── 2026-09-08~10 (유튜브 사고와 재발방지)
17f9ddca  fix(collect) 유튜브 액터 스키마 변경 대응 — _yt_item_id 다중 복구 + 플랫폼 붕괴 워치독 ⑩
fd961bce  fix(collect) 7개 매칭 루프 전부 실패 카운트 + AST 계약 테스트로 강제
c2cd82ad  fix(collect) 경고에 '버려진 아이템 키' 출력 — 스키마변경 vs 개별실패 스텁 판별
24839a15  feat(status) 체크 ⑪ 안전망 비활성(YOUTUBE_API_KEY 미등록) 매일 알림
1abad5a4  fix(queue) 실측 0을 재시도 대상에서 제외(manual_zero_confirmed) + 이력 조회 절단 수정
── 2026-09-07 (무상 판정)
d37a2b64  fix(report) 미러링 cost=0 → '무상(미러링)' (cost 컬럼에 NULL 이 없어 라벨로 판정)
b790642b  feat(report) '/서비스'·'무상협찬'도 무상 + 체크 ⑨ 가격미매핑 전수 워치독
── 그 이전
9f67a27e  fix(ops) repair-metric-spikes 영구 차단 + stats-import 배너 매거진 필드 판정
585f5a6c  feat(scripts) db_probe.py — 진단 함정 4종 차단 (+ 533691be 공지)
732417c3  fix(kpi) 크론 드롭 대비 백업 슬롯 2개 + 계약 테스트
ed4c1e17  fix(audit) 날짜 헤더 검사를 실제 날짜 구간으로 제한 (39a24b92 오탐 교정)
c1f15785  feat(monitoring) 게시 전 종료(ended_at < posted_at) 저장 차단
cd850c3b  fix(apps-script) 축소된 H 수식 3,674개 P:DU 복구
95b61637  fix(monitoring) 중간배율 오독 사전격리(10→3 + 최소증가 20,000)
86f41691  feat 종료일 이상 감지 — notify_status 정합성 ⑦
```

---

## 11. 사용자(황경원) 응대 메모

- **"확실해?/확실하지?"는 실제로 뭔가 틀렸다는 신호일 때가 많다.** 오늘 그 질문이 네 번 나왔고 네 번 다 내 검증에 구멍이 있었다. 방어하지 말고 다시 검증하라.
- 결론은 **먼저 검증하고** 말한다. 확인을 사용자에게 위임하지 않는다(스크린샷·버튼 요청 금지).
- 쉬운 설명을 요청하면 지표·코드 용어를 풀어서, 표와 짧은 문단으로.
- 인계문을 자주 요청한다 — 복사해 붙일 수 있는 코드블록 형태로 준다.
## 12. 참고 문서·산출물 지도

| 파일 | 용도 |
|---|---|
| `AI_SHARED_STATUS.md` | **정본 상태판.** 작업 전 필독, 변경 후 갱신(추가만, 삭제 0) |
| `CLAUDE.md` | 절대 규칙 + 프로젝트 개요 |
| `HANDOFF_ai_context.md` | (이 문서) 온보딩 진입점 |
| `HANDOFF_cluster_contamination_20260714.md` | 2026-07-14 클러스터 오염 마스터 목록·실측값 |
| `DESIGN_oneway_db_source_of_truth.md` | 재발방지 설계('안전한 양방향') |
| `SPEC_integrity_fix_20260716.md` | 무결성 수정 스펙 |
| `Combined_Sheet_AppsScript.gs` | 연동시트 바인딩 스크립트(**라이브가 정본**, repo 본은 참고) |
| `scripts/db_probe.py` | DB 진단 정본 모듈(함정 4종 차단) |
| `scripts/channel_kind.py` | 배너·무상 판정 단일 정본(`is_banner_channel`·`free_reason`·`is_mirror_label`) |
| `scripts/cost_mapping_guard.py` | 체크 ⑨ 가격미매핑 전수 워치독 |
| `scripts/platform_coverage_guard.py` | 체크 ⑩ 플랫폼 수집 붕괴 워치독 |
| `scripts/build_view_missing_queue.py` | 재시도 큐 **정본**(커버리지는 이 큐로 판정, 읽기전용 빌드 가능) |

---
