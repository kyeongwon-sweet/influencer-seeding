# 비동기 아키텍처 — GitHub Actions → Vercel 직접 호출

## 변경 전 (GitHub Actions)

```
버튼 클릭
  → Vercel API → GitHub Actions 트리거
  → GitHub Actions 대기열 (30초 ~ 5분)
  → GitHub Actions에서 Python 스크립트 실행
  → Apify 액터 실행 (1~2분)
  → 결과 Supabase 저장
```

**문제점**: GitHub Actions 대기열 때문에 버튼 클릭 후 실제 실행까지 수 분이 걸림

---

## 변경 후 (Vercel 비동기)

```
버튼 클릭
  → POST /api/jobs
  → job DB 생성 (~50ms)
  → 즉시 응답 반환  ← 사용자 체감 끝

백그라운드 (after()):
  → Supabase에서 대상 목록 조회
  → Apify 액터 병렬 시작 (Promise.all)

Apify 완료 (1~2분 후):
  → Webhook → POST /api/apify-webhook
  → 결과 처리 및 Supabase 저장
  → job 상태 'done' 업데이트
```

**개선**: 버튼 클릭 즉시 반응, 대기열 0초

---

## 핵심 변경 파일

| 파일 | 역할 |
|------|------|
| `web/lib/apify.ts` | Apify REST API 호출 헬퍼 |
| `web/app/api/jobs/route.ts` | `after()`로 비동기 처리, `Promise.all`로 병렬 실행 |
| `web/app/api/apify-webhook/route.ts` | Apify 완료 시 결과 처리 (리스트업·스크리닝·모니터링) |

---

## 사용 기술

- **`after()`** (Next.js 15+): 응답을 먼저 보내고 이후 작업을 백그라운드에서 실행
- **`Promise.all`**: 여러 Apify 액터를 순차가 아닌 병렬로 동시 시작
- **Apify Webhook**: 액터 완료 시 Vercel API로 결과 전송

---

## Apify 액터 매핑

| 기능 | Apify 액터 |
|------|-----------|
| 리스트업 — 인스타그램 | `apify/instagram-hashtag-scraper` |
| 리스트업 — 유튜브 | `streamers/youtube-scraper` |
| 스크리닝 — 인스타그램 | `apify/instagram-scraper` |
| 스크리닝 — 유튜브 | `streamers/youtube-scraper` |
| 협찬 모니터링 | `apify/instagram-scraper` |

---

## 필요한 환경변수

### Vercel (추가됨)
| 변수명 | 용도 |
|--------|------|
| `APIFY_API_TOKEN` | Apify 액터 시작 및 결과 조회 |
| `APP_URL` | Webhook 콜백 URL (예: `https://influencer-seeding-mu.vercel.app`) |

### GitHub Secrets (기존 유지 — 자동 모니터링 스케줄용)
| 변수명 | 용도 |
|--------|------|
| `APIFY_API_TOKEN` | GitHub Actions에서 Python 스크립트 실행 시 |
| `SUPABASE_URL` | 동일 |
| `SUPABASE_SERVICE_ROLE_KEY` | 동일 |
