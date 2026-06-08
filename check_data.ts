import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: "web/.env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  console.log("🔍 협찬 모니터링 데이터 확인\n");

  // 전체 포스트 수
  const { count } = await supabase
    .from("sponsored_posts")
    .select("*", { count: "exact", head: 0 });

  console.log(`📊 전체 포스트: ${count}개\n`);

  // 최근 추가된 포스트
  const { data: recent } = await supabase
    .from("sponsored_posts")
    .select("id, account_name, product_name, url, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("📅 최근 추가된 포스트 (5개):");
  recent?.forEach((p, i) => {
    console.log(`\n${i + 1}. [${p.account_name}] ${p.product_name}`);
    console.log(`   생성: ${p.created_at?.slice(0, 19)}`);
    console.log(`   수정: ${p.updated_at?.slice(0, 19)}`);
    console.log(`   URL: ${p.url?.slice(0, 60)}...`);
  });

  // 일일 통계 데이터
  const { count: statsCount } = await supabase
    .from("post_daily_stats")
    .select("*", { count: "exact", head: 0 });

  console.log(`\n\n📈 일일 통계: ${statsCount}개\n`);

  // 6월 데이터 확인
  const { data: juneStats } = await supabase
    .from("post_daily_stats")
    .select("measured_at, play_count")
    .gte("measured_at", "2026-06-01")
    .lte("measured_at", "2026-06-05")
    .order("measured_at", { ascending: false });

  console.log("📊 6월 1-5일 통계:");
  const byDate: Record<string, number> = {};
  juneStats?.forEach(s => {
    const date = s.measured_at.slice(0, 10);
    byDate[date] = (byDate[date] || 0) + (s.play_count || 0);
  });

  Object.entries(byDate)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([date, total]) => {
      console.log(`  ${date}: ${total.toLocaleString()} 조회`);
    });
})();
