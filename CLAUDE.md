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

### Python 스크립트 (`.env`)
- `APIFY_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### GitHub Secrets
- `APIFY_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
