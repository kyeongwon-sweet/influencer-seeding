#!/bin/bash

# GitHub Actions workflow 수동 실행 스크립트
# 6/6, 6/7 데이터 복구용

REPO="kyeongwon-sweet/influencer-seeding"
WORKFLOW="monitoring.yml"

echo "🔄 GitHub Actions 워크플로우 수동 실행"
echo "========================================="

# 두 날짜에 대해 순차 실행
for DATE in "2026-06-06" "2026-06-07"; do
  echo ""
  echo "⏰ $DATE 데이터 수집 시작..."
  
  # GitHub CLI로 workflow dispatch
  gh workflow run "$WORKFLOW" \
    --repo "$REPO" \
    --ref main \
    -f monitoring_date="$DATE"
  
  if [ $? -eq 0 ]; then
    echo "✅ $DATE 수집 작업 큐에 추가됨"
  else
    echo "❌ $DATE 수집 작업 실패"
    exit 1
  fi
  
  # API 레이트 제한 방지
  sleep 5
done

echo ""
echo "✅ 모든 작업이 큐에 추가되었습니다"
echo "진행 상황: https://github.com/$REPO/actions"
