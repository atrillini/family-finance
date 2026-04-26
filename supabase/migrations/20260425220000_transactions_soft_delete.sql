-- Soft delete: nasconde dalla UI e dalle analisi senza rimuovere la riga (GoCardless non re-inserisce per external_id).

alter table public.transactions
  add column if not exists is_hidden boolean not null default false;

comment on column public.transactions.is_hidden is 'Se true, la transazione non appare in liste/analisi; resta in DB per dedup sync (external_id).';

create index if not exists transactions_account_visible_idx
  on public.transactions (account_id)
  where is_hidden = false;
