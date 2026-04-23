-- Chiave di deduplica per descrizione+merchant normalizzati: si sostituisce
-- la riga precedente quando l’utente corregge di nuovo lo stesso movimento.

alter table public.categorization_examples
  add column if not exists dedupe_key text;

create index if not exists categorization_examples_user_dedupe_idx
  on public.categorization_examples (user_id, dedupe_key)
  where dedupe_key is not null;
