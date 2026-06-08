#!/bin/bash
# 6/6, 6/7 검색량 데이터 복구 스크립트

set -e

echo "🔄 검색량 데이터 복구 시작..."

# 환경변수 확인
if [ -z "$NAVER_CLIENT_ID" ] || [ -z "$NAVER_CLIENT_SECRET" ]; then
  echo "❌ 환경변수 설정 필요: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET"
  exit 1
fi

echo "✅ Naver API 환경변수 확인됨"

# 복구할 기간
START_DATE="2026-06-01"
END_DATE="2026-06-07"
KEYWORDS=("라라스윗" "라라스윗 아이스크림")

echo "📊 Naver Trends API 호출..."

for keyword in "${KEYWORDS[@]}"; do
  echo "  키워드: $keyword"

  curl -s -X POST "https://openapi.naver.com/v1/datalab/search" \
    -H "Content-Type: application/json" \
    -H "X-Naver-Client-Id: $NAVER_CLIENT_ID" \
    -H "X-Naver-Client-Secret: $NAVER_CLIENT_SECRET" \
    -d "{
      \"startDate\": \"$START_DATE\",
      \"endDate\": \"$END_DATE\",
      \"timeUnit\": \"date\",
      \"keywordGroups\": [
        {\"groupName\": \"$keyword\", \"keywords\": [\"$keyword\"]}
      ]
    }" > /tmp/naver_response.json

  echo "  응답 저장: /tmp/naver_response.json"
done

echo "✅ 데이터 수집 완료"
echo "📝 응답 내용:"
cat /tmp/naver_response.json | jq '.' 2>/dev/null || cat /tmp/naver_response.json

echo ""
echo "💡 다음 단계:"
echo "  1. 응답 데이터에서 6/6, 6/7의 값을 확인"
echo "  2. Supabase에 수동으로 저장하거나"
echo "  3. TypeScript 엔드포인트 생성"
