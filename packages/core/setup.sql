-- health-mcp data plane. Idempotent: safe to re-run in the Supabase SQL editor.

create table if not exists daily_totals (
  date date not null,
  metric text not null,
  value double precision not null,
  unit text not null,
  source text,
  updated_at timestamptz default now(),
  primary key (date, metric)
);

create table if not exists measurements (
  id bigint generated always as identity primary key,
  date date not null,
  timestamp timestamptz,
  metric text not null,
  value double precision not null,
  unit text not null,
  source text,
  external_id text unique,
  created_at timestamptz default now()
);

create index if not exists idx_m_date_metric on measurements(date, metric);
create index if not exists idx_t_metric_date on daily_totals(metric, date);

-- RLS on, no anon policies: the anon/publishable key has zero access.
alter table daily_totals enable row level security;
alter table measurements enable row level security;

-- SELECT-only role the RPC executes as.
do $$ begin
  if not exists (select from pg_roles where rolname = 'health_reader') then
    create role health_reader nologin;
  end if;
end $$;

-- The dashboard's postgres role is not superuser; ownership transfer below
-- requires membership in the target role.
grant health_reader to postgres;

grant usage on schema public to health_reader;
grant select on daily_totals, measurements to health_reader;

drop policy if exists health_reader_select_totals on daily_totals;
create policy health_reader_select_totals on daily_totals
  for select to health_reader using (true);
drop policy if exists health_reader_select_meas on measurements;
create policy health_reader_select_meas on measurements
  for select to health_reader using (true);

-- Read-only SQL over HTTP: PostgREST RPC. DB-level enforcement: SELECT-only
-- function owner (+ RLS). Resource bound: the role-level statement_timeout set
-- below (in-function set_config cannot re-arm an already-started statement).
-- No row cap here (internal tools read full history); the user-facing query
-- tool is capped app-side.
create or replace function run_readonly(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  -- _rr: improbable alias — a user column named like the wrapper alias would
  -- shadow it and silently corrupt results (a column literally named "_rr"
  -- would still collide; acceptable residual).
  execute 'select coalesce(jsonb_agg(_rr), ''[]''::jsonb) from (' || q || ') _rr'
    into result;
  return result;
end;
$$;

-- SECURITY DEFINER runs with the function OWNER's privileges. Owning it by
-- health_reader (SELECT-only) is what enforces read-only — SET ROLE inside a
-- definer function is forbidden by Postgres (42501). The transfer requires the
-- new owner to hold CREATE on the schema; grant transiently, revoke after.
grant create on schema public to health_reader;
alter function run_readonly(text) owner to health_reader;
revoke create on schema public from health_reader;

revoke execute on function run_readonly(text) from public, anon, authenticated;
grant execute on function run_readonly(text) to service_role;

-- Real statement timeout: applied when PostgREST assumes the role, so it arms
-- before each statement (unlike set_config inside a running function). Bounds
-- reads AND ingest writes; 8s is generous for 500-row batches.
alter role service_role set statement_timeout = '8s';

-- Upserts through PostgREST don't touch updated_at on conflict-update;
-- keep the "last write wins, freshly stamped" semantics from the D1 path.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists daily_totals_updated_at on daily_totals;
create trigger daily_totals_updated_at
  before update on daily_totals
  for each row execute function set_updated_at();
