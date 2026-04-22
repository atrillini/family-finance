-- Esegui questo script nel SQL Editor di Supabase (Dashboard → SQL → New query)
-- se ricevi: "Could not find the 'user_id' column of 'categorization_rules'"

alter table public.categorization_rules
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists categorization_rules_user_id_idx
  on public.categorization_rules (user_id);

-- Opzionale: se avevi già regole senza proprietario, assegnale al tuo utente (sostituisci l'UUID):
-- update public.categorization_rules set user_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' where user_id is null;
