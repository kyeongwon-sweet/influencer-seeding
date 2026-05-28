# 인플루언서 시딩 시스템 — 셋업 가이드

인플루언서 발굴(리스트업), 스크리닝, 협찬 게시물 성과 추적을 자동화하는 시스템입니다.

---

## 준비물

셋업 전에 아래 계정을 모두 만들어 두세요. 모두 무료로 시작할 수 있습니다.

| 서비스 | 용도 | 무료 플랜 |
|--------|------|-----------|
| [GitHub](https://github.com) | 코드 저장 + 자동화 실행 | 무료 |
| [Supabase](https://supabase.com) | 데이터베이스 | 무료 (프로젝트 2개) |
| [Vercel](https://vercel.com) | 웹사이트 배포 | 무료 |
| [Clerk](https://clerk.com) | 로그인 인증 | 무료 (월 1만 MAU) |
| [Apify](https://apify.com) | 인스타그램·유튜브 데이터 수집 | 유료 (사용량 기반) |

---

## 셋업 순서

### 1단계 — GitHub 레포 생성 및 코드 업로드

1. [github.com](https://github.com) 로그인 → 우측 상단 **+** → **New repository**
2. **Repository name**: 원하는 이름 입력 (예: `influencer-seeding`)
3. **Private** 선택 → **Create repository**
4. 전달받은 ZIP 파일을 압축 해제
5. 압축 해제된 폴더에서 아래 명령어 실행:
   ```bash
   git init
   git add .
   git commit -m "init"
   git remote add origin https://github.com/내계정/레포이름.git
   git push -u origin main
   ```
6. 이후 모든 작업은 생성한 내 레포 기준으로 진행합니다

---

### 2단계 — Supabase 프로젝트 생성 및 스키마 설정

1. [supabase.com](https://supabase.com) 로그인 → **New project** 클릭
2. **Name**: 원하는 프로젝트명 입력 (예: `influencer-seeding`)
3. **Database Password**: 안전한 비밀번호 설정 후 어딘가에 저장
4. **Region**: `Northeast Asia (Seoul)` 선택 → **Create new project**
5. 프로젝트 생성 완료 후 왼쪽 메뉴 **SQL Editor** 클릭
6. 아래 SQL 전체를 복사해서 붙여넣고 **Run** 버튼 클릭

<details>
<summary>📋 전체 스키마 SQL (클릭해서 펼치기)</summary>

```sql
-- 인플루언서 후보 리스트
create table influencers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null unique,
  platform    text not null check (platform in ('instagram', 'youtube')),
  status      text not null default 'pending'
                check (status in ('pending', 'pass', 'hold', 'reject')),
  source      text check (source in ('listup', 'manual')),
  created_at  timestamptz default now()
);

-- 스크리닝 지표
create table screening_metrics (
  id                        uuid primary key default gen_random_uuid(),
  influencer_id             uuid references influencers(id) on delete cascade,
  run_at                    timestamptz default now(),
  followers                 bigint,
  avg_views_per_follower    numeric,
  has_1m_view               boolean,
  total_posts               int,
  general_posts             int,
  ad_posts                  int,
  total_avg_view_count      numeric,
  general_avg_view_count    numeric,
  ad_avg_view_count         numeric,
  total_avg_play_count      numeric,
  general_avg_play_count    numeric,
  ad_avg_play_count         numeric,
  total_like_ratio          numeric,
  general_like_ratio        numeric,
  ad_like_ratio             numeric,
  total_comment_ratio       numeric,
  general_comment_ratio     numeric,
  ad_comment_ratio          numeric,
  top_ad_play_count         bigint,
  top_ad_post_url           text,
  avg_video_duration        numeric
);

-- 리스트업 검색 키워드
create table search_keywords (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null,
  platform    text not null check (platform in ('instagram', 'youtube', 'both')),
  created_at  timestamptz default now()
);

-- 비동기 작업 큐
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('listup', 'screening', 'monitoring')),
  status      text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed')),
  payload     jsonb,
  error       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger jobs_updated_at
  before update on jobs
  for each row execute function update_updated_at();

-- 협찬 게시물
create table sponsored_posts (
  id              uuid primary key default gen_random_uuid(),
  influencer_id   uuid references influencers(id) on delete set null,
  url             text not null unique,
  posted_at       date,
  account_name    text,
  product_name    text,
  project_name    text,
  channel_type    text,
  created_at      timestamptz default now()
);

-- 게시물 일별 성과
create table post_daily_stats (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid references sponsored_posts(id) on delete cascade,
  measured_at     date not null,
  play_count      bigint,
  likes_count     bigint,
  comments_count  bigint,
  unique (post_id, measured_at)
);

-- 추가 컬럼
alter table influencers add column if not exists keyword text;
alter table influencers add column if not exists sample_post_url text;
alter table influencers add column if not exists post_type text;
alter table influencers add column if not exists post_uploaded_at timestamptz;
alter table jobs add column if not exists user_email text;
alter table sponsored_posts add column if not exists cost integer;
alter table sponsored_posts add column if not exists reach_count bigint;

-- RLS 설정 (service_role 키로 접근 시 자동 우회)
alter table influencers        enable row level security;
alter table screening_metrics  enable row level security;
alter table search_keywords    enable row level security;
alter table jobs               enable row level security;
alter table sponsored_posts    enable row level security;
alter table post_daily_stats   enable row level security;

create policy "service role bypass" on influencers        for all using (true);
create policy "service role bypass" on screening_metrics  for all using (true);
create policy "service role bypass" on search_keywords    for all using (true);
create policy "service role bypass" on jobs               for all using (true);
create policy "service role bypass" on sponsored_posts    for all using (true);
create policy "service role bypass" on post_daily_stats   for all using (true);
```

</details>

7. 실행 후 왼쪽 메뉴 **Table Editor**에서 테이블 6개가 생성됐는지 확인

**API 키 복사** (나중에 사용):
- 왼쪽 메뉴 **Project Settings → API** 클릭
- **⚠️ "Legacy API Keys" 탭** 선택 (새 형식 키는 동작하지 않음)
- `Project URL`, `anon` 키, `service_role` 키를 메모장에 복사

---

### 3단계 — Clerk 로그인 설정

1. [clerk.com](https://clerk.com) 로그인 → **Create application** 클릭
2. **Application name**: 원하는 이름 입력 → **Create application**
3. 생성 완료 후 대시보드에서 아래 두 값을 복사:
   - `Publishable key` (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
   - `Secret keys` 탭 → `Secret key` (CLERK_SECRET_KEY)

---

### 4단계 — Apify 계정 및 토큰

1. [apify.com](https://apify.com) 로그인
2. 우측 상단 프로필 → **Settings → Integrations**
3. **Personal API tokens** → **+ Create new token**
4. 생성된 토큰 복사 (APIFY_API_TOKEN)

> Apify는 사용량에 따라 비용이 발생합니다. 무료 크레딧 $5 제공 후 유료 전환됩니다.

---

### 5단계 — GitHub Personal Access Token 발급

매일 자동 실행되는 협찬 모니터링(GitHub Actions 스케줄)을 위해 필요합니다.

1. GitHub 로그인 → 우측 상단 프로필 → **Settings**
2. 하단 **Developer settings → Personal access tokens → Tokens (classic)**
3. **Generate new token (classic)** 클릭
4. **Note**: 원하는 이름 입력 (예: `influencer-seeding`)
5. **repo** 체크박스 선택 + **workflow** 체크박스 선택 (⚠️ 두 개 모두 필요)
6. **Generate token** → 생성된 토큰(`ghp_`로 시작) 복사 후 메모

---

### 6단계 — GitHub Secrets 등록

GitHub Actions 자동화가 Supabase·Apify에 접근할 수 있도록 비밀값을 등록합니다.

1. Fork한 레포 → **Settings → Secrets and variables → Actions**
2. **New repository secret** 버튼으로 아래 3개를 각각 등록:

| Secret 이름 | 값 |
|-------------|-----|
| `APIFY_API_TOKEN` | 4단계에서 복사한 Apify 토큰 |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 (Legacy) |

---

### 7단계 — Vercel 배포

1. [vercel.com](https://vercel.com) 로그인 → **Add New → Project**
2. **Import Git Repository** → 생성한 GitHub 레포 선택
3. **Root Directory는 변경하지 않음** (프로젝트 루트의 `vercel.json`이 자동으로 처리)
4. **Environment Variables**에 아래 값들을 모두 입력:

| 변수명 | 값 |
|--------|----|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Publishable key |
| `CLERK_SECRET_KEY` | Clerk Secret key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 키 (Legacy) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 (Legacy) |
| `APIFY_API_TOKEN` | 4단계에서 발급한 Apify 토큰 |
| `APP_URL` | 배포 완료 후 생성된 URL (예: `https://influencer-seeding-xxx.vercel.app`) |

5. **Deploy** 클릭 → 배포 완료 후 URL 확인
6. 배포된 URL을 복사해서 `APP_URL` 환경변수에 입력 후 **Redeploy**

> `APP_URL`은 배포 후에야 알 수 있으므로 첫 배포 완료 후 추가합니다.

---

### 8단계 — 동작 확인

1. 배포된 URL 접속 → Clerk 로그인 화면 확인
2. Clerk 대시보드 → **Users → Invite** 또는 **+ Create user**로 사용자 초대
3. 로그인 후 각 탭(리스트업 / 스크리닝 / 협찬 모니터링) 정상 표시 확인

---

## 환경변수 한눈에 보기

| 변수 | 어디서 | 어디에 등록 |
|------|--------|------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 대시보드 | Vercel |
| `CLERK_SECRET_KEY` | Clerk 대시보드 | Vercel |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API (Legacy) | Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API (Legacy) | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (Legacy) | Vercel + GitHub Secrets |
| `SUPABASE_URL` | Supabase → Project Settings → API (Legacy) | GitHub Secrets |
| `APIFY_API_TOKEN` | Apify → Settings → Integrations | Vercel + GitHub Secrets |
| `APP_URL` | 배포 완료 후 Vercel URL 직접 입력 | Vercel |

---

## 기능 소개

| 탭 | 하는 일 |
|----|---------|
| **리스트업** | 해시태그로 인스타그램·유튜브 계정 자동 발굴. 수동 추가도 가능. |
| **스크리닝** | 발굴된 계정의 팔로워·재생수·광고 비율 지표 수집. 통과/보류/탈락 상태 관리. |
| **협찬 모니터링** | 협찬 게시물 조회수·좋아요·댓글 매일 자동 수집. 추세 차트와 증감 테이블 제공. |

### 자동 수집 스케줄
- **협찬 모니터링**: 매일 오전 9시 UTC (한국시간 오후 6시) 자동 실행
- **리스트업·스크리닝**: 웹 UI 버튼 클릭 시 즉시 실행

---

## 시스템을 수정하고 싶을 때

이 시스템은 **Claude Code**로 자연어 지시만으로 수정할 수 있습니다.

### 준비
1. [Claude Code 설치](https://claude.ai/code) (Mac 앱 또는 VS Code 확장)
2. 터미널에서 레포 클론:
   ```bash
   git clone https://github.com/내계정/레포이름.git
   cd 레포이름
   ```
3. Claude Code 실행 후 원하는 수정 사항을 자연어로 요청

### 수정 예시
```
"스크리닝 테이블에 '담당자' 컬럼을 추가해줘"
"협찬 모니터링에서 조회수 합계를 카드 형태로 크게 보여줘"
"리스트업 페이지에 플랫폼별 계정 수 통계를 추가해줘"
```

### 수정 후 배포
Claude Code에서 수정 → `git push` → Vercel이 자동으로 재배포

---

## 트러블슈팅

**Q. 로그인 후 화면이 비어 있어요**
→ Vercel 환경변수 중 Supabase 관련 값을 확인하세요. **Legacy API Keys** 탭의 값을 사용해야 합니다.

**Q. 리스트업·스크리닝 실행 버튼을 눌렀는데 아무것도 안 돼요**
→ Vercel 환경변수에 `APIFY_API_TOKEN`과 `APP_URL`이 **Production** 환경으로 등록됐는지 확인하세요.

**Q. Vercel 배포가 실패해요**
→ Root Directory를 변경하지 않았는지 확인하세요. 기본값(변경 없음)으로 두면 `vercel.json`이 자동 처리합니다.

**Q. Apify 비용이 걱정돼요**
→ Apify 대시보드 → Billing에서 월 한도를 설정할 수 있습니다. 소규모 운영 시 월 $10 내외로 유지 가능합니다.

---

## 기술 스택 (참고용)

| 역할 | 기술 |
|------|------|
| 웹 프론트엔드 | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| 인증 | Clerk |
| 데이터베이스 | Supabase (PostgreSQL) |
| 배포 | Vercel |
| 데이터 수집 | Python + Apify |
| 자동화 | GitHub Actions |
