-- ISIN opzionale per valorizzazione via Twelve Data (vedi TWELVE_DATA_API_KEY).

alter table public.manual_investments
  add column if not exists isin text;

comment on column public.manual_investments.isin is 'ISIN (ISO 6166), opzionale; usato per aggiornare valore da quotazione di mercato.';
