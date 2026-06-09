# 인플루언서 시딩 시스템

## 프로젝트 개요
인플루언서 발굴(리스트업), 스크리닝, 협찬 게시물 성과 추적을 자동화하는 시스템.

---

## 기술 스택

| 역할 | 기술 |
|------|------|
| 웹 프론트엔드 | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| 인증 | Clerk |
| 데이터베이스 | Supabase (PostgreSQL) |
| 배포 | Vercel |
| 데이터 수집 | Apify (REST API 직접 호출) |
| 자동화 | GitHub Actions (협찬 모니터링 일 1회 스케줄만) |

---

## 필수 규칙

### API 키 / 보안
- API 키는 반드시 `.env` 파일에서 불러올 것. 코드에 직접 절대 쓰지 않는다.
- `.env`, `.env.local` 파일은 GitHub에 올리지 않는다. (`.gitignore`에 등록됨)
- 필요한 키 형식은 `.env.example`, `web/.env.local.example` 참고.

```python
# 올바른 예시
import os
from dotenv import load_dotenv
load_dotenv()
api_key = os.getenv("APIFY_API_TOKEN")

# 잘못된 예시 (절대 하지 말 것)
api_key = "abc123xyz..."
```

```typescript
// 올바른 예시
const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 잘못된 예시 (절대 하지 말 것)
const apiKey = "eyJhbGci...";
```

### 버전 관리
- 기능이 완성되거나 중요한 변경이 있을 때 커밋한다.
- 커밋 메시지 형식: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`

### 파일 저장 위치
- 데이터 파일 (csv, xlsx 등) → `data/input/`, `data/output/` (Git 추적 안 됨)
- Python 스크립트 → `scripts/`
- 웹 앱 → `web/`

---

## Supabase 사용 원칙

```typescript
// 반드시 이 패턴 사용 (lazy init)
let _supabase = null;
export function getServerSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
```

- **Service Role Key**: 서버 사이드 전용 (API routes, GitHub Actions)
- **Anon Key**: 클라이언트 사이드 사용 가능 (현재 미사용)
- API Keys는 반드시 **Legacy API Keys** 탭 값 사용 (새 형식 `sb_secret_...` 미호환)

---

## 환경변수 목록

### 웹앱 (`web/.env.local`)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APIFY_API_TOKEN`
- `APP_URL` → 배포된 Vercel URL (예: `https://influencer-seeding-xxx.vercel.app`)
- `NAVER_CLIENT_ID` → 네이버 개발자센터 발급 (검색 트렌드)
- `NAVER_CLIENT_SECRET` → 네이버 개발자센터 발급 (검색 트렌드)
- `NOTION_API_TOKEN` → notion.so/my-integrations 발급 (무상 노출 노션 동기화)
- `META_BUSINESS_ACCESS_TOKEN` → Meta Business 발급 (광고비 트렌드)
- `META_BUSINESS_ACCOUNT_ID` → Meta Business 광고 계정 ID

### Python 스크립트 (`.env`)
- `APIFY_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### GitHub Secrets
- `APIFY_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 🚨 자동화 모니터링 재발방지 (매우 중요!)

**문제 이력**: 주말/야간 자동 모니터링이 자꾸 중단되어 데이터 수집 실패

### 원인 분석
1. **빌드 실패 → 배포 불가**: 최신 코드가 컴파일되지 않아 배포 중단
2. **배포 후 미검증**: 배포 후 정상 작동 여부 확인 안 함
3. **경고 부족**: 자동화 실패해도 즉시 알림 없음

### 재발방지 대책

#### ✅ 1. 배포 전 빌드 테스트 (자동화)
- GitHub Actions `build-test.yml` 워크플로우 추가
- **main 브랜치 push 시 자동 빌드 테스트 실행**
- 빌드 실패 → PR/push 블록됨

#### ✅ 2. 모니터링 상태 점검 가이드
- 파일: `MONITORING_STATUS_CHECK.md`
- **목표**: 매주 월요일 오전, 배포 후 24시간 이내 점검
- **체크 항목**:
  - Vercel 배포 상태 (페이지 로드 가능?)
  - GitHub Actions 실행 기록 (최근 24시간 성공?)
  - Supabase 데이터 (어제 이상의 데이터 기록?)
  - 배포된 코드 버전 (aadfba6 이상?)

#### ✅ 3. 코드 안정성 강화
**변수 호이스팅 에러 방지:**
```typescript
// ❌ 위험: 매 렌더링마다 재계산되는 변수
const lsStartDate = chartData.length >= 2 ? chartData[0].date : null;

useEffect(() => {
  // ...
}, [lsStartDate]); // 무한 루프 + 컴파일 에러

// ✅ 안전: useMemo로 메모이제이션
const { lsStartDate } = useMemo(() => ({
  lsStartDate: chartData.length >= 2 ? chartData[0].date : null,
}), [chartData]);

useEffect(() => {
  // ...
}, [lsStartDate]); // 안정적
```

#### ✅ 4. 데이터 수집 검증 강화
**Apify 수집 시 반드시 확인:**
1. **사전 검증** (수집 전):
   - 기존 데이터 조회 → 마지막 기록 확인
   
2. **사후 검증** (수집 후):
   - 조회수는 누적이므로 **절대 감소하면 안됨** ❌
   - 이상치 감지: `신규 조회수 < 기존 조회수` → 수집 오류 ⚠️
   - 0이 아닌데 갑자기 0으로 떨어지면 → 게시물 삭제 또는 API 오류
   
3. **오류 처리**:
   - 이상 데이터는 자동으로 저장 안 함
   - 콘솔에 경고 기록
   - Slack 알람 (추가 예정)

#### ✅ 5. 긴급 대응 절차
**빌드 실패 발생 시:**
```bash
# 1단계: 문제 커밋 식별
git log --oneline origin/main -5

# 2단계: 이전 안정 버전으로 강제 복원
git reset --hard 3beda71
git push origin main --force

# 3단계: 자동 재배포 (Vercel이 자동 감지)
```

**데이터 수집 오류 발생 시:**
```bash
# 1단계: Supabase에서 잘못된 데이터 확인
SELECT measured_at, COUNT(*) FROM post_daily_stats 
WHERE measured_at = '2026-06-06' GROUP BY measured_at;

# 2단계: 이상 데이터 삭제
DELETE FROM post_daily_stats WHERE measured_at = '2026-06-06';

# 3단계: 재수집
curl "https://influencer-seeding-mu.vercel.app/api/monitoring/collect-now?date=2026-06-06"
```

### ⚠️ 절대 하지 말 것
- ❌ 빌드 테스트 없이 main 브랜치에 푸시
- ❌ 배포 후 상태 확인 없이 간과
- ❌ 주말 자동화 실패를 그냥 방치
- ❌ 환경변수 설정 확인 없이 "설정해주세요" 요청

### ✅ 반드시 할 것
- ✅ **배포 전**: `npm run build` 로컬 테스트 + CI 빌드 테스트 통과
- ✅ **배포 후**: MONITORING_STATUS_CHECK.md 체크리스트 실행
- ✅ **일주일마다**: GitHub Actions 실행 기록 확인
- ✅ **문제 발생 시**: 먼저 확인하고 해결책 보고
