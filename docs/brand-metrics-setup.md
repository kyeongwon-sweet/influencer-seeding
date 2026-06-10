# 브랜드 지표(인스타 유입수 / 유튜브 검색량) 연동 셋업

메인 협찬 모니터링 그래프에 **라라스윗 공식 인스타 유입수**와 **유튜브 검색량**을 추가하기 위한 셋업 가이드.
코드(수집/저장/그래프)는 준비돼 있고, 아래 **외부 데이터 소스 2개**만 채우면 작동한다.

---

## 1. 인스타그램 공식 유입수 (도달, `ig_reach`)

### 결론(중요)
- 인사이트는 **"Instagram API with Facebook Login"** 경로를 써야 한다. (Meta 콘솔이 "인사이트는 Facebook 로그인으로" 라고 명시. Instagram-로그인/Basic Display 경로는 **부적합·폐기**.)
- `profile_views` 지표는 **2025-01-08 폐기**됨 → **`reach`(도달)** 사용. (`website_clicks`, `impressions`도 종료.)
- 코드는 이미 `graph.facebook.com/v23.0/{IG_USER_ID}/insights?metric=reach&metric_type=total_value&period=day` 로 수정 완료
  (`web/app/api/brand-metrics/collect/route.ts`).

### 선행 조건
- 라라스윗 IG가 **프로페셔널(비즈니스/크리에이터) 계정** + **Facebook 페이지에 연결**돼 있어야 함.
  (Meta Business Suite 또는 IG 설정 → 연결된 계정에서 페이지 연결)

### 토큰 발급 (가장 쉬운 길: 그래프 API 탐색기)
1. developers.facebook.com → 앱 "테스트"(ID 965303019541316) → 권한 및 기능에서 추가:
   `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`
2. 상단 **도구 → 그래프 API 탐색기** → 앱 선택 → **Generate Access Token** → 라라스윗 페이지 관리하는 Facebook 계정으로 로그인 + 동의
3. 단기 토큰을 **장기(60일) 토큰으로 교환**:
   ```
   GET https://graph.facebook.com/v23.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={앱 ID}
     &client_secret={앱 시크릿}
     &fb_exchange_token={단기 토큰}
   ```
4. **IG 비즈니스 계정 ID 조회**:
   ```
   GET https://graph.facebook.com/v23.0/me/accounts?fields=name,instagram_business_account{id,username}&access_token={토큰}
   ```
   → 라라스윗 페이지의 `instagram_business_account.id`

### Vercel 환경변수 등록 (Production)
- `INSTAGRAM_ACCESS_TOKEN` = 위 장기 토큰
- `INSTAGRAM_USER_ID` = 위 IG 비즈니스 계정 ID

### 운영 주의
- 장기 토큰은 60일 만료 → 만료 전 재발급/교환 필요. (자동 갱신은 미구현 — 필요 시 collect 라우트에 추가 가능.)
- 수집 트리거: `.github/workflows/monitoring.yml`이 매일 `POST /api/brand-metrics/collect` 호출 → `brand_daily_metrics.ig_reach` 적재 → `/api/brand-metrics`로 조회.

---

## 2. 유튜브 '라라스윗' 검색량

### 결론
- 유튜브 키워드 **검색 횟수(절대 검색량)** 는 어떤 공식 API로도 안 나온다.
  (코드의 `yt_search_views`(YouTube Analytics)는 "우리 채널의 검색 유입 조회수"라 의미가 다름 → 이 목적엔 사용 안 함.)
- 기존 브랜드/상품 검색량과 동일하게 **Google Sheet → CSV 읽기** 방식으로 연동한다. (`product-search-trends` 라우트와 동일 패턴.)

### 데이터 소스 선택지
- **Google Ads 키워드플래너** — 무료, 검색 네트워크(유튜브 포함) **월간** 검색량. Google Ads 계정 필요.
- **3rd-party**(Keyword Tool.io, vidIQ 등) — 유튜브 전용 검색량 추정, 유료, 일~주간.
- (Google Trends는 상대지수라 "절대 검색량"엔 부적합.)

### 만들 Google Sheet 양식
공개 링크(CSV 내보내기 가능) 시트, 첫 행 헤더:

| 날짜 | 라라스윗_유튜브검색량 |
|------|----------------------|
| 2026-06-01 | 1234 |
| 2026-06-02 | 1310 |

- 날짜 형식 `YYYY-MM-DD`, 숫자에 콤마 허용.
- 시트 생성 후 **시트 ID와 gid**를 알려주면, 제가 `product-search-trends`와 동일한 API 라우트를 추가하고 메인 그래프에 라인으로 연결한다.

---

## 남은 코드 작업 (토큰/시트 확보 시 즉시 진행)
- [ ] 메인 그래프(`web/app/monitoring/page.tsx`)에 **인스타 도달(유입)** 라인 추가 (`brandMetrics.ig_reach` 사용 — 데이터 이미 페이지에 로드됨)
- [ ] 유튜브 검색량 Sheet 읽는 API 라우트 + 메인 그래프 라인 추가
- [ ] (선택) 인스타 장기 토큰 자동 갱신
