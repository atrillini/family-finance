-- Esempi few-shot derivati dalle correzioni manuali (categoria/tag/merchant/flag)
-- per arricchire il prompt Gemini senza creare una regola per ogni caso.

create table if not exists public.categorization_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  merchant text,
  category text not null,
  tags text[] not null default '{}',
  is_subscription boolean not null default false,
  is_transfer boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists categorization_examples_user_created_idx
  on public.categorization_examples (user_id, created_at desc);

alter table public.categorization_examples enable row level security;

create policy "Users select own categorization_examples"
  on public.categorization_examples for select
  using (auth.uid() = user_id);

create policy "Users insert own categorization_examples"
  on public.categorization_examples for insert
  with check (auth.uid() = user_id);

create policy "Users delete own categorization_examples"
  on public.categorization_examples for delete
  using (auth.uid() = user_id);
