-- Checkpoint ultimo run di /api/cron/sync (solo service role / SQL dashboard).
-- Evita 504: quando il run termina per budget tempo, l’esito resta tracciato qui.
create table if not exists public.cron_sync_state (
  id text primary key check (id = 'singleton'),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

comment on table public.cron_sync_state is 'Stato e audit dell’ultimo run cron di sync bancario (scrittura da API con service role).';

alter table public.cron_sync_state enable row level security;
-- Nessuna policy per anon/authenticated: nessun accesso con chiave utente; service_role bypassa RLS.
