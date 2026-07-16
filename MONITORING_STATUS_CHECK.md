# 자동화 모니터링 상태 점검 가이드

**목적**: 주말/야간 자동 모니터링이 정상 작동하는지 확인
**빈도**: 매주 월요일 오전, 또는 배포 후 24시간

---

## 📋 점검 체크리스트

### 1️⃣ 배포 상태 (Vercel)

```bash
# 현재 배포된 커밋 확인
git log origin/main --oneline -3

# Vercel 배포 URL에서 직접 확인
# https://influencer-seeding.vercel.app/monitoring
```

**확인 항목:**
- [ ] 페이지 로드됨 (500 에러 없음)
- [ ] 포스트 데이터 표시됨
- [ ] 그래프가 렌더링됨
- [ ] 브라우저 콘솔에 에러 없음

---

### 2️⃣ GitHub Actions 상태

```bash
# 워크플로우 실행 상태 확인
# https://github.com/kyeongwon-sweet/influencer-seeding/actions
```

**확인 항목:**
- [ ] 최근 `monitoring.yml` 실행이 ✅ 성공
- [ ] 실행 시간이 "24시간 이내"
- [ ] 지난주 실행 기록 없으면 ❌ 문제

**실패 시 확인:**
```bash
# GitHub Actions 로그 확인
# → Actions 탭 → monitoring 워크플로우 → 최신 실행 → 에러 메시지
```

---

### 3️⃣ Supabase 데이터 수집 상태

```sql
-- Supabase SQL 에디터에서 실행
SELECT 
  MAX(measured_at) as "마지막 수집시간",
  COUNT(*) as "총 레코드",
  DATE(MAX(measured_at)) as "마지막 수집일"
FROM daily_stats
WHERE created_at >= NOW() - INTERVAL '3 days';
```

**정상 상태:**
- ✅ "마지막 수집시간"이 "어제" 이상
- ✅ "마지막 수집일"이 6/6, 6/7 등 최근 날짜

**문제 상태:**
- ❌ "마지막 수집일"이 3일 이상 전
- ❌ 어제의 데이터가 없음

---

### 4️⃣ 배포된 코드 버전 확인

```bash
# 로컬에서 배포된 버전 확인
git log origin/main --oneline -5

# 예상:
# aadfba6 fix: lsStartDate/lsEndDate를 useMemo로...
# 3beda71 fix: 검색량 필드 undefined 에러...
```

**확인 사항:**
- [ ] HEAD가 `aadfba6` 이상
- [ ] `5ac5613` (빌드 실패 버전) ❌가 origin/main에 없음

---

## 🚨 문제 발견 시 대응

### 상황 1: GitHub Actions 실패
```bash
# 1. 에러 메시지 확인
# → Actions 탭에서 로그 읽기

# 2. 일반적인 원인 (Supabase 변수)
# → Vercel 환경변수 재확인: vercel env list

# 3. 급한 경우: 수동 실행
# → Actions → monitoring → "Run workflow" → "Run workflow" 버튼
```

### 상황 2: Vercel 배포 실패
```bash
# 1. 현재 로컬 상태 확인
cd web && npm run build

# 2. 빌드 에러 발생 시
# → monitoring/page.tsx 검토
# → 이전 커밋으로 강제 복원
git reset --hard 3beda71
git push origin main --force

# 3. 우리에게 연락 (또는 자동 알림 설정)
```

### 상황 3: Supabase 데이터 미수집
```bash
# 1. GitHub Actions 로그에서 에러 확인
# 2. 일반적인 원인:
#    - Supabase SERVICE_ROLE_KEY 만료
#    - APIFY_API_TOKEN 한도 초과
#    - 네이버/Meta API 장애

# 3. 대응:
# → GitHub Secrets 업데이트
# → Apify API 한도 확인
```

---

## 📊 정상 작동 신호

✅ **배포된 코드가 aadfba6 이상**
✅ **GitHub Actions "run monitoring" ✅ 성공 (24시간 이내)**
✅ **Supabase에 어제 이상의 데이터 기록**
✅ **Vercel 대시보드에 배포 성공 표시**

---

## ⚠️ 위험 신호 (즉시 확인)

❌ **빌드 실패 (Cannot access 'bs' before initialization 등)**
❌ **GitHub Actions 실패 3회 연속**
❌ **Supabase 데이터 미수집 24시간 이상**
❌ **Vercel 배포 중단 (500 에러)**

---

## 📞 연락처

문제 발생 시:
1. 이 체크리스트 항목 확인
2. CLAUDE.md의 "배포 프로세스" 섹션 참고
3. GitHub Actions 로그 스크린샷과 함께 보고
---

## 2026-07-13 Codex 인수인계: 날짜별 누적조회수 carry-forward

### 배경
- 사용자 제보: 2026-07-10 조회수가 2026-07-09보다 낮게 보이는 게시물이 많음.
- 검증 결과, DB 원본에서 같은 post_id의 `2026-07-10 play_count < 2026-07-09 play_count`는 0건.
- 실제 원인은 “7/10 값이 낮은 것”이 아니라, 7/10 측정 행이 없는 게시물이 날짜 필터에서 누적값을 이어받지 못해 빈값/0처럼 빠지는 표시 로직.

### 수정 원칙
- 증분 계산은 기존처럼 `pickRangeStats` + `viewIncrement`로 기간 안 실제 측정값만 사용한다.
- 누적조회수/도달수/좋아요/댓글 표시, 합계, 정렬, CSV, 업체별 누적은 `pickAsOfStats`로 기간 종료일(`dateTo`) 기준 마지막 누적값을 사용한다.
- 일자별 누적 합계는 필터 시작일 이전 마지막 누적값을 seed로 넣고, 이후 날짜는 forward-fill한다.

### 주요 변경 파일
- `web/app/monitoring/lib.ts`
  - `pickAsOfStats(post, dateFrom, dateTo)` 추가.
  - 날짜 필터가 있고 `dateTo`가 있으면 `dateTo` 이하의 마지막 stats를 반환.
- `web/app/monitoring/page.tsx`
  - 상단 조회수 카드, 하단 표 합계, 정렬, CSV, 업체별 누적, 일자별 합계가 누적 표시용 as-of 값을 사용.
  - 일자별 합계는 날짜 범위를 명시적으로 만들고, 첫 날짜 이전 값을 seed로 forward-fill.
- `web/app/monitoring/components/PostsTable.tsx`
  - 행 표시용 조회수/도달수/좋아요/댓글/비용비는 `displayS = pickAsOfStats(...)` 기준.
  - 증분 컬럼은 계속 `pickRangeStats` 기준.
- `web/tests/monitoring-lib.test.ts`
  - `pickAsOfStats`가 7/10 측정값이 없어도 7/9 누적값을 이어받는 테스트 추가.

### 실제 검증 결과
- Google Sheet `콘텐츠 대시보드 연동`: BK=7.9, BL=7.10 기준 실제 숫자 감소 행 0건.
- 같은 시트에서 7/9 값 있음 + 7/10 공백은 117건.
- DB 원본 직접 비교: 7/9 행 292개, 7/10 행 249개, 실제 감소 0건.
- 새 표시 규칙으로 DB 전체 재계산: 비교 가능 699개 중 7/10 미측정 carry-forward 422개, 감소 0건.
- `npm.cmd test`: pass 26/26.
- `npm.cmd run lint`: error 0, 기존 warning 71개.
- `npm.cmd run build`: 성공.
