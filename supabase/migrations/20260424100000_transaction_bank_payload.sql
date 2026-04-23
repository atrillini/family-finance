-- Payload GoCardless grezzo + qualità dati per re-parse e refresh mirato
alter table public.transactions
  add column if not exists bank_payload jsonb,
  add column if not exists parser_version text not null default '1',
  add column if not exists data_quality text not null default 'unknown'
    check (data_quality in ('ok', 'weak', 'unknown')),
  add column if not exists payload_hash text,
  add column if not exists bank_pending boolean not null default false;

comment on column public.transactions.bank_payload is 'Snapshot JSON GoCardless (Berlin Group) + meta pending/capturedAt';
comment on column public.transactions.data_quality is 'ok = dati ricchi; weak = etichetta generica senza controparte; unknown = legacy o mancanza dati';
comment on column public.transactions.parser_version is 'Versione logica normalizzazione usata al salvataggio';

create index if not exists transactions_data_quality_idx
  on public.transactions (user_id, data_quality)
  where data_quality is not null;
