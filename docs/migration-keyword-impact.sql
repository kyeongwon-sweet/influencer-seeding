-- screening_metrics에 검색어 트렌드 분석 컬럼 추가
alter table screening_metrics
  add column kw_keywords  text,     -- 입력 키워드 (콤마 구분)
  add column kw_ad_date   date,     -- 광고 날짜
  add column kw_impact    numeric,  -- 임팩트 (전 대비 후 변화율 %)
  add column kw_before    numeric,  -- 광고 전 7일 평균 ratio
  add column kw_after     numeric;  -- 광고 후 7일 평균 ratio
