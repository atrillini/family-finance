-- Log operativi (sync, IA, errori banca) — Dev / System Status
create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  level text not null check (level in ('info', 'error', 'success')),
  message text not null,
  module text not null check (module in ('Bank', 'AI', 'System')),
  details jsonb not null default '{}'::jsonb,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  estimated_cost double precision not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists system_logs_user_created_idx
  on public.system_logs (user_id, created_at desc);

create index if not exists system_logs_user_cost_idx
  on public.system_logs (user_id, created_at desc)
  include (estimated_cost);

alter table public.system_logs enable row level security;

drop policy if exists "system_logs_select_own" on public.system_logs;
create policy "system_logs_select_own"
  on public.system_logs for select
  using (auth.uid() = user_id);

drop policy if exists "system_logs_insert_own" on public.system_logs;
create policy "system_logs_insert_own"
  on public.system_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "system_logs_delete_own" on public.system_logs;
create policy "system_logs_delete_own"
  on public.system_logs for delete
  using (auth.uid() = user_id);

comment on table public.system_logs is 'Diagnostica sync / Gemini / banca — vedi /admin/logs';

-- Somma costi stimati Gemini (USD) negli ultimi N giorni per l’utente corrente
create or replace function public.sum_system_logs_cost(p_days integer default 30)
returns double precision
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(estimated_cost), 0)::double precision
  from public.system_logs
  where user_id = auth.uid()
    and created_at >= (now() - (coalesce(p_days, 30) * interval '1 day'));
$$;

grant execute on function public.sum_system_logs_cost(integer) to authenticated;
