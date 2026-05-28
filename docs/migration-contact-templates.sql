-- ================================================
-- 컨택 문안 템플릿 테이블
-- Supabase SQL 에디터에서 실행
-- ================================================

create table if not exists contact_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  content     text not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table contact_templates enable row level security;

create policy "authenticated users only" on contact_templates
  for all using (auth.role() = 'authenticated');

-- updated_at 자동 갱신 (jobs 테이블과 동일한 함수 재사용)
create trigger contact_templates_updated_at
  before update on contact_templates
  for each row execute function update_updated_at();

-- 기본 문안 2개 삽입
insert into contact_templates (name, content) values
(
  '기본 협찬 제안',
  E'안녕하세요, {name}님!\n\n저는 라라스윗 마케팅 팀 담당자입니다.\n\n{name}님의 콘텐츠를 항상 즐겁게 보고 있습니다. 특히 최근 올려주신 영상들이 많은 분들께 큰 사랑을 받고 있어, 꼭 함께하고 싶어 연락드립니다.\n\n저희 라라스윗의 신제품 협찬을 제안드리고자 합니다.\n제품 협찬 관련 세부 사항은 회신 주시면 상세히 안내해 드리겠습니다.\n\n좋은 답변 기다리겠습니다.\n감사합니다.\n\n라라스윗 마케팅 팀 드림'
),
(
  'DM 협찬 제안 (간결)',
  E'안녕하세요, {name}님!\n라라스윗 마케팅 팀입니다 :)\n\n{name}님과 협찬 콘텐츠를 진행하고 싶어 연락드렸습니다.\n관심 있으시면 편하게 답장 주세요!\n감사합니다.'
);
