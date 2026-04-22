-- Multi-tenant: colonna user_id per accounts, transactions, categorization_rules.
-- Il cron /api/cron/sync e syncTransactions() richiedono queste colonne.
-- Esegui in Supabase → SQL Editor.

alter table public.accounts
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.transactions
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.categorization_rules
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists categorization_rules_user_id_idx
  on public.categorization_rules (user_id);

-- Backfill deployment con un solo utente: tutti i record al primo utente registrato.
-- Se hai più utenti, NON usare questo blocco così com’è: assegna user_id per utente/conto.
with u as (
  select id from auth.users order by created_at asc limit 1
)
update public.accounts a
set user_id = u.id
from u
where a.user_id is null;

update public.transactions t
set user_id = a.user_id
from public.accounts a
where t.account_id = a.id
  and t.user_id is null
  and a.user_id is not null;

with u as (
  select id from auth.users order by created_at asc limit 1
)
update public.categorization_rules r
set user_id = u.id
from u
where r.user_id is null;
