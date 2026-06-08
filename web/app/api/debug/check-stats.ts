import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 6/5 ~ 6/8 데이터 확인
  const { data, error } = await supabase
    .from('post_daily_stats')
    .select('post_id, measured_at, play_count, likes_count, comments_count')
    .in('measured_at', ['2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08'])
    .order('measured_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 6/6, 6/7, 6/8 데이터 개수 세기
  const count = {
    '2026-06-05': data?.filter(d => d.measured_at === '2026-06-05').length || 0,
    '2026-06-06': data?.filter(d => d.measured_at === '2026-06-06').length || 0,
    '2026-06-07': data?.filter(d => d.measured_at === '2026-06-07').length || 0,
    '2026-06-08': data?.filter(d => d.measured_at === '2026-06-08').length || 0,
  };

  // 6/6 샘플 데이터 (처음 3개)
  const sample606 = data?.filter(d => d.measured_at === '2026-06-06').slice(0, 3) || [];

  return NextResponse.json({
    summary: count,
    status: {
      '2026-06-06_exists': count['2026-06-06'] > 0,
      '2026-06-07_exists': count['2026-06-07'] > 0,
      '2026-06-08_exists': count['2026-06-08'] > 0,
    },
    sample606Data: sample606,
    totalRecords: data?.length || 0,
  });
}
