-- Investimenti / titoli inseriti a mano (MVP). Patrimonio = saldi conti (app) + somma current_value.

create table if not exists public.manual_investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  instrument_type text not null default 'altro',
  quantity numeric,
  avg_price numeric,
  current_value numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_investments_user_id_idx
  on public.manual_investments (user_id);

create index if not exists manual_investments_user_updated_idx
  on public.manual_investments (user_id, updated_at desc);

alter table public.manual_investments enable row level security;

drop policy if exists "manual_investments_select_own" on public.manual_investments;
create policy "manual_investments_select_own"
  on public.manual_investments for select
  using (auth.uid() = user_id);

drop policy if exists "manual_investments_insert_own" on public.manual_investments;
create policy "manual_investments_insert_own"
  on public.manual_investments for insert
  with check (auth.uid() = user_id);

drop policy if exists "manual_investments_update_own" on public.manual_investments;
create policy "manual_investments_update_own"
  on public.manual_investments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "manual_investments_delete_own" on public.manual_investments;
create policy "manual_investments_delete_own"
  on public.manual_investments for delete
  using (auth.uid() = user_id);

comment on table public.manual_investments is 'Posizioni investimento inserite manualmente; nessuna integrazione broker in MVP.';
