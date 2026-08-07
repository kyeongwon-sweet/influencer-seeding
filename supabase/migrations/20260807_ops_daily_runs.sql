create table if not exists public.ops_daily_runs (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  run_date date not null,
  status text not null default 'done',
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service, run_date)
);

create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'ops_daily_runs_updated_at'
  ) then
    create trigger ops_daily_runs_updated_at
      before update on public.ops_daily_runs
      for each row execute function update_updated_at();
  end if;
end $$;

alter table public.ops_daily_runs enable row level security;
