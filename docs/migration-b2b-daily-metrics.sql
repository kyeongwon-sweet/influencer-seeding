-- B2B 일자별 현황 (마케팅T 대시보드 시트의 '일자별 현황' 탭 연동)
-- 최종 이익 = 듬뿍바 본부공헌이익 + 쫀득바 본부공헌이익
-- 발주량 합 = 듬뿍바 CVS 발주량 + 쫀득바 B2B 발주량
create table if not exists b2b_daily_metrics (
  date date primary key,

  -- 듬뿍바 (CVS)
  dumbuk_order        bigint,   -- CVS 발주량
  dumbuk_profit       bigint,   -- 이익(300원)
  dumbuk_conv_pl      bigint,   -- 전환 손익
  dumbuk_ad_cost      bigint,   -- 인지 광고비
  dumbuk_contribution bigint,   -- 본부공헌이익

  -- 쫀득바 (B2B)
  jjondeuk_order        bigint, -- B2B 발주량
  jjondeuk_profit       bigint, -- 이익(200원)
  jjondeuk_conv_pl      bigint, -- 전환 손익
  jjondeuk_ad_cost      bigint, -- 인지 광고비
  jjondeuk_contribution bigint, -- 본부공헌이익

  -- 합계 (최종)
  total_order        bigint,    -- CVS 발주량 + B2B 발주량
  total_contribution bigint,    -- 본부공헌이익 합 = 최종 이익

  updated_at timestamptz not null default now()
);
