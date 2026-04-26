-- Bonus fedeltà (es. Mediolanum) + storico aggiornamenti; `isin_code` allineato a `isin`.

alter table public.manual_investments
  add column if not exists bonus_amount numeric not null default 0,
  add column if not exists maturity_date date,
  add column if not exists isin_code text,
  add column if not exists is_manual boolean not null default true;

update public.manual_investments
  set isin_code = isin
  where (isin_code is null or btrim(isin_code) = '')
    and isin is not null
    and btrim(isin) <> '';

comment on column public.manual_investments.bonus_amount is 'Bonus fedeltà stimato (es. da app Mediolanum), oltre al valore titoli.';
comment on column public.manual_investments.maturity_date is 'Scadenza vincolo per maturazione bonus.';
comment on column public.manual_investments.isin_code is 'ISIN di tracciamento; in app allineato al campo `isin`.';
comment on column public.manual_investments.is_manual is 'True se gestita principalmente a mano; aggiornamento quote API può impostare false.';

-- Storico valori bonus inseriti dall’utente (es. lettura da app ufficiale).

create table if not exists public.bonus_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  manual_investment_id uuid not null references public.manual_investments (id) on delete cascade,
  bonus_amount numeric not null,
  source_note text,
  created_at timestamptz not null default now()
);

create index if not exists bonus_history_investment_idx
  on public.bonus_history (manual_investment_id, created_at desc);

create index if not exists bonus_history_user_idx
  on public.bonus_history (user_id);

alter table public.bonus_history enable row level security;

drop policy if exists "bonus_history_select_own" on public.bonus_history;
create policy "bonus_history_select_own"
  on public.bonus_history for select
  using (auth.uid() = user_id);

drop policy if exists "bonus_history_insert_own" on public.bonus_history;
create policy "bonus_history_insert_own"
  on public.bonus_history for insert
  with check (auth.uid() = user_id);

comment on table public.bonus_history is 'Storico importi bonus fedeltà registrati manualmente per posizione.';
