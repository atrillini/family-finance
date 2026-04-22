-- Corregge: "new row violates row-level security policy for table categorization_rules"
-- Esegui nel SQL Editor di Supabase dopo aver aggiunto la colonna user_id.
--
-- Causa tipica: policy solo SELECT, o senza WITH CHECK per INSERT, o nome/ruolo errato.

alter table public.categorization_rules enable row level security;

-- Rimuove tutte le policy sulla tabella (evita conflitti con nomi sconosciuti)
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'categorization_rules'
  loop
    execute format(
      'drop policy if exists %I on public.categorization_rules',
      pol.policyname
    );
  end loop;
end $$;

-- Una sola policy per il ruolo authenticated: CRUD solo sulle proprie righe
create policy categorization_rules_authenticated_own
  on public.categorization_rules
  as permissive
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Permessi tabella (Supabase di solito li ha già; harmless se ripetuti)
grant select, insert, update, delete on table public.categorization_rules to authenticated;
