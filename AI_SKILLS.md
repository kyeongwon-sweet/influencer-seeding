# AI 작업 스킬 (플레이북)

> 이 프로젝트를 이어받는 AI/개발자를 위한 **반복 작업 절차집**.
> 프로젝트 지식·경로·함정 → `ONBOARDING.md`, 코딩 규칙 → `CLAUDE.md`, 배경 이력 → `docs/`.
> 각 스킬은 그대로 따라 하면 되도록 명령/스니펫을 포함. 작성 기준일 2026-07-03.

## 환경 전제 (모든 스킬 공통)
- OS: Windows 11, 셸: PowerShell 주력 + Git Bash(POSIX). **Git Bash는 cp949** — 한글을 그대로 파이프/`curl -d` 하면 깨진다.
- **실제 python**: `C:\Users\hwangkw\AppData\Local\Python\pythoncore-3.14-64\python.exe` (bare `python`은 깨진 스텁 — 쓰지 말 것).
- 파이썬으로 한글 다룰 땐 **`PYTHONUTF8=1`** 필수.
- 시크릿: 웹 `web/.env.local`, 스크립트 `scripts/.env`, 자동화 GitHub Secrets. **값을 코드/문서에 박지 말 것.**

---

## Skill 1 — Supabase 데이터 안전 조회/수정 (Python + UTF-8)

**언제**: DB 상태를 직접 확인하거나 고쳐야 할 때. **curl로 한글 payload 금지**(Git Bash cp949가 바이트를 깨뜨림 — 실제로 '혼'→'ȥ' 오염 사고 있었음). 항상 아래 Python+urllib 패턴을 쓴다.

**조회 (READ) — 항상 이걸로 먼저 사실 확인:**
```bash
cd "C:\Users\hwangkw\AI\.claude\influencer-seeding" && set -a; . web/.env.local 2>/dev/null; set +a; \
PY="C:\Users\hwangkw\AppData\Local\Python\pythoncore-3.14-64\python.exe"; \
PYTHONUTF8=1 SUPA_URL="${SUPABASE_URL:-$NEXT_PUBLIC_SUPABASE_URL}" SUPA_KEY="$SUPABASE_SERVICE_ROLE_KEY" "$PY" - <<'PY'
import os,json,urllib.request
URL=os.environ["SUPA_URL"]; KEY=os.environ["SUPA_KEY"]
H={"apikey":KEY,"Authorization":"Bearer "+KEY}
def get(p): return json.load(urllib.request.urlopen(urllib.request.Request(URL+p,headers=H)))
# 예: 특정일 행수/합계
rows=[];frm=0
while True:  # PostgREST 기본 1000행 → 페이지네이션 필수
    pg=get(f"/rest/v1/post_daily_stats?select=post_id,play_count&measured_at=eq.2026-07-02&limit=1000&offset={frm}")
    rows+=pg
    if len(pg)<1000: break
    frm+=1000
print(len(rows), sum(r["play_count"] for r in rows if r.get("play_count") is not None))
PY
```

**수정 (WRITE) — 백업 먼저, 그다음 PATCH:**
```python
Hw={**H,"Content-Type":"application/json","Prefer":"return=minimal"}
import urllib.parse
# ① 백업: 바꿀 행의 원본을 스크래치패드에 덤프 (되돌릴 수 있게)
#    C:\Users\hwangkw\AppData\Local\Temp\claude\...\scratchpad\backup_YYYYMMDD.json
# ② PATCH (숫자만이라도 Python으로; 한글 값이면 json.dumps(..., ensure_ascii=False).encode("utf-8"))
q=f"/rest/v1/post_daily_stats?post_id=eq.{urllib.parse.quote(pid)}&measured_at=eq.2026-07-02"
urllib.request.urlopen(urllib.request.Request(URL+q,method="PATCH",headers=Hw,
    data=json.dumps({"play_count":newv}).encode()))
```

**규칙**
- `.in_()`/`.in.()` 필터는 URL 길이 한계(~600개 id면 0행 반환) → **80~150개씩 청크**.
- 기본 1000행 → `limit`+`offset` 페이지네이션.
- **쓰기 전 반드시 백업.** 대량/비가역이면 실행 전 사용자에게 제안·확인(`ONBOARDING.md §0-7`).

---

## Skill 2 — "데이터가 이상하다" 진단 (소비 코드부터)

**핵심 교훈(2026-07-03 사고)**: 표시값이 이상하다고 **DB부터 고치면 안 된다.** 화면이 이미 보정하는 경우가 많다.

절차:
1. **그 숫자를 계산·렌더하는 코드를 먼저 읽는다.** 예: "일자별 증감"·"조회수 트렌드"는 `web/app/monitoring/page.tsx`의 `dailyTotals`(게시물별 `Math.max` 러닝맥스+forward-fill) → `deltaTableData`/`playDeltaData`. **DB의 0/감소값은 여기서 직전값으로 보정돼 무해**하다.
2. **표시값을 코드 로직 그대로 재현**해 본다(Skill 1 조회로 데이터 뽑아 동일 계산). 재현값이 화면과 맞으면 "데이터"가 아니라 "해석"의 문제일 수 있다.
3. **동일 코호트로만 비교.** 서로 다른 게시물 수(예: 391행 vs 605행)의 집계 합계를 나란히 놓고 "급락=손상"이라 단정하지 말 것.
4. **가설을 반증하려 시도.** "내가 틀렸다면 어떤 증거가 보일까?"를 먼저 쿼리.
5. 진짜 수집오류(예: 삭제된 게시물, 스크랩 차단으로 0)라면 → 적재 가드(`run_monitoring.py`, `lib/stats-guard.ts`)를 손보거나 **재수집**(Skill 3). DB 직접수정은 최후수단.

---

## Skill 3 — 특정일 재수집 / 로컬 복구

**A. 원격 재수집 (권장, 자동화와 동일 경로)**
- 엔드포인트: `POST/GET https://influencer-seeding-mu.vercel.app/api/monitoring/collect-now?date=YYYY-MM-DD` (인증 필요 시 `Authorization: Bearer <CRON_SECRET>`; 라우트에서 확인).
- **반드시 `-mu` 공개 도메인** 사용(다른 배포 도메인은 SSO 302로 막힘 — `ONBOARDING.md §5`).
- 잘못 적재된 날 삭제: `api/monitoring/delete-date` 또는 `api/admin/delete-date-stats`(인증) → 재수집.

**B. 로컬 복구 (원격이 안 될 때)**
```bash
cd "C:\Users\hwangkw\AI\.claude\influencer-seeding\scripts"
# deps: apify-shared==1.1.2 핀 필요(버전 안 맞으면 임포트 에러)
PYTHONUTF8=1 "C:\...\python.exe" run_monitoring.py   # PYTHONUTF8 없으면 이모지에서 cp949 크래시
```
- 실주체는 `scripts/run_monitoring.py`(GitHub Actions가 매일 실행). 플랫폼별 `_fetch_*`.
- 조회수는 누적·단조 — 적재 시점 monotonic max 가드. IG 차단 시 폴백 `data-slayer`(비쌈 — 누락분만).

---

## Skill 4 — 안전 배포 (worktree + 타입체크 + 푸시 레이스)

동시 세션이 같은 레포를 편집하므로 격리·최신화가 필수(`ONBOARDING.md §0`).
```bash
git fetch origin main
git worktree add ../wt-x origin/main && cd ../wt-x && git switch -c feat/x
# (worktree엔 node_modules 없음 → PowerShell로 정션 연결)
#   New-Item -ItemType Junction -Path web\node_modules -Target <메인>\web\node_modules
# 편집 후 반드시:
cd web && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit   # ignoreBuildErrors:false → 타입에러 시 빌드실패
npm run build                                              # next build는 tsc보다 엄격
# 푸시(레이스 루프): 거부되면 fetch+rebase 후 재시도
git push origin HEAD:main || (git fetch origin main && git rebase origin/main && git push origin HEAD:main)
# 정리: 정션은 '링크만' 삭제 후 worktree 제거(실체 삭제 방지)
```
- pre-push 훅(`.githooks/pre-push`)이 `tsc --noEmit` 자동 실행. 비상 우회 `--no-verify`(가급적 금지).
- Vercel Pro가 push→자동 배포. 배포 후 실제 도메인에서 확인.

---

## Skill 5 — 시트 ↔ DB 동기화 반영

방향과 정책을 알아야 무한 왕복/덮어쓰기 사고를 막는다.
- **시트→DB**: `Combined_Sheet_AppsScript.gs`의 `syncNew()`(신규 URL만) / `syncAll()`(전체) → `POST /api/sponsored-posts/bulk`. **비어있지 않은 값만 덮고, `manual_fields`(대시보드 수동수정)·빈칸은 보존.** 캡션(content_summary)은 시트값 우선.
- **DB→시트**: `pullFromDB()` → `GET .../sponsored-posts/...`(sync 계열). **시트의 빈 셀만 채움**(기존 값 안 덮음).
- **매일 자동(dailyAuto)** = `syncNew`(신규만) + `pullFromDB`(빈칸만) → **기존 행은 자동으로 안 덮인다.** 단 **수동 `syncAll`(전체 동기화)** 을 돌리면 시트값이 DB를 덮는다.
- 결론: DB에서 바꾼 값을 영구화하려면 **시트 원본도 같이 바꿔라**(안 그러면 다음 `syncAll` 때 되돌아감).
- 인증: bulk·stats-import는 Bearer(CRON_SECRET) — Apps Script 스크립트 속성에 `CRON_SECRET` 필요.
- **오염 가드**: stats-import는 `play_count==cost` 차단(비용이 조회수로 적재되던 버그 방지).

---

## Skill 6 — 지표 해석 주의 (틀리기 쉬운 것들)

- **일자별 증분 변동성**: 집계 게시물 수가 매일 늘면(늦게 추가된 게시물의 과거 이력) 최근 날짜 증분이 부풀려짐. 손상 아님.
- **오늘(KST) 제외**: 표/그래프는 오늘을 뺀다(수집중·미완성). 게시물별 `play_collected`로 완료분만 당일 반영.
- **조회수는 화면에서 per-post 러닝맥스 보정**됨(DB 낮은 값 무해) — Skill 2 참고.
- **죽은 필드 주의**: `yt_search_views`(Analytics OAuth)는 **의도적 폐기(영구 null)** — "OAuth 필요"로 오판 말 것. 유튜브 검색량은 Google Trends(`youtube_search_trends`, OAuth 불필요).
- **B2B**: `jjondeuk_order`=B2B발주량, `dumbuk_order`=실제 CVS발주량. 일요일 0은 정상.
- **Apify 비용**: 거의 전부 IG 스크래퍼. 검증은 **최소 표본·액터당 1회**(풀수집 반복 금지, 월 한도 관리).

---

## 자주 여는 파일 지도
- 협찬 대시보드 로직: `web/app/monitoring/page.tsx`(거대) + `lib.ts`(타입·상수·통계) + `components/`.
- 수집: `scripts/run_monitoring.py`, `web/app/api/monitoring/*`, `web/app/api/apify-webhook/route.ts`.
- 시트 연동: `web/app/api/sponsored-posts/{bulk,sync,stats-import}/route.ts` + 루트의 `*.gs`.
- 자동화: `.github/workflows/*.yml`(cron-daily-collect가 핵심).
- 공통 lib: `web/lib/{supabase-server,apify,url-utils,stats-guard,cron-auth,logger}.ts`.
