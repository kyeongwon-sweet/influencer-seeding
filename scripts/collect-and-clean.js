#!/usr/bin/env node

/**
 * 06/06, 06/07, 06/08 데이터 수집 스크립트
 * API 엔드포인트로 삭제 → 깨끗한 재수집
 */

const APP_URL = 'https://influencer-seeding-mu.vercel.app';

async function deleteDate(date) {
  try {
    const response = await fetch(`${APP_URL}/api/monitoring/delete-date?date=${date}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error(`   ❌ ${date} 삭제 실패: HTTP ${response.status}`);
      return false;
    }

    const result = await response.json();
    console.log(`   ✅ ${date}: 데이터 삭제됨`);
    return true;
  } catch (e) {
    console.error(`   ❌ ${date} 삭제 오류:`, e.message);
    return false;
  }
}

async function collectDate(date) {
  try {
    console.log(`   🔄 ${date} 수집 중...`);
    const response = await fetch(`${APP_URL}/api/monitoring/collect-now?date=${date}`, {
      method: 'GET',
    });

    const result = await response.json();
    if (result.success) {
      console.log(`   ✅ ${date}: ${result.stats_collected}개 행 수집됨`);
      return true;
    } else {
      console.warn(`   ⚠️  ${date}: ${result.error}`);
      return false;
    }
  } catch (e) {
    console.error(`   ❌ ${date} 수집 오류:`, e.message);
    return false;
  }
}

async function main() {
  console.log('🔄 데이터 수집 및 정리 시작...\n');

  const dates = ['2026-06-06', '2026-06-07', '2026-06-08'];

  // 1️⃣ 06/06, 06/07 이상 데이터 삭제
  console.log('📍 Step 1: 06/06, 06/07 이상 데이터 삭제');
  for (const date of ['2026-06-06', '2026-06-07']) {
    await deleteDate(date);
    await new Promise(r => setTimeout(r, 1000)); // 1초 대기
  }

  console.log('\n📍 Step 2: 06/06, 06/07, 06/08 재수집');
  console.log('⏳ 각 수집은 1-2분 소요됩니다...\n');

  // 2️⃣ 각 날짜별 재수집 (순차)
  for (const date of dates) {
    await collectDate(date);
    await new Promise(r => setTimeout(r, 2000)); // 2초 대기
  }

  console.log('\n✅ 데이터 수집 완료!');
  console.log('📊 모니터링 페이지에서 06/06-08 확인하세요: https://influencer-seeding-mu.vercel.app/monitoring');
}

main().catch(e => {
  console.error('💥 오류:', e);
  process.exit(1);
});
