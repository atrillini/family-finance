-- Notifiche in-app (lista campanella header)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('info', 'warning', 'success')),
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read)
  where is_read = false;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own"
  on public.notifications for insert
  with check (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = user_id);

comment on table public.notifications is 'Notifiche utente mostrate dalla campanella nell''header';

-- Finestra validità accesso GoCardless (da requisition.access_expires / access)
alter table public.accounts
  add column if not exists consent_expires_at timestamptz;

comment on column public.accounts.consent_expires_at is 'Scadenza consenso PSD2 GoCardless per la requisition associata';

-- Realtime opzionale (abilita dalla dashboard Supabase → Database → Replication):
-- alter publication supabase_realtime add table public.notifications;
