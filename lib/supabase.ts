import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TransactionCategory } from "./gemini";

/**
 * Schema atteso per le tabelle `transactions` e `accounts` su Supabase.
 *
 * SQL per creare la tabella dei conti (con i campi necessari a GoCardless/Nordigen):
 *
 *   create table public.accounts (
 *     id uuid primary key default gen_random_uuid(),
 *     name text not null,
 *     type text not null default 'conto corrente',
 *     balance numeric not null default 0,
 *     logo_url text,
 *     iban text,
 *     institution_id text,
 *     requisition_id text,
 *     gocardless_account_id text,
 *     last_sync_at timestamptz,
 *     created_at timestamptz not null default now()
 *   );
 *   create unique index if not exists accounts_gocardless_account_id_key
 *     on public.accounts (gocardless_account_id)
 *     where gocardless_account_id is not null;
 *
 * SQL per creare la tabella delle transazioni (con relazione al conto e dedup esterno):
 *
 *   create table public.transactions (
 *     id uuid primary key default gen_random_uuid(),
 *     date timestamptz not null default now(),
 *     description text not null,
 *     merchant text,
 *     category text not null default 'Altro',
 *     amount numeric not null,
 *     tags text[] not null default '{}',
 *     is_subscription boolean not null default false,
 *     is_transfer boolean not null default false,
 *     account_id uuid references public.accounts(id) on delete set null,
 *     external_id text,
 *     created_at timestamptz not null default now(),
 *     constraint transactions_account_external_unique
 *       unique (account_id, external_id)
 *   );
 *
 * SQL per la tabella delle regole di categorizzazione (memoria contestuale
 * dell'IA). Le regole vengono applicate lato server prima di chiamare
 * Gemini, sia in sync GoCardless che sulla ricategorizzazione manuale:
 *
 *   create table public.categorization_rules (
 *     id uuid primary key default gen_random_uuid(),
 *     match_type text not null default 'description_contains',
 *         -- supportati: 'description_contains', 'merchant_contains',
 *         --             'description_regex'
 *     pattern text not null,
 *     category text not null default 'Altro',
 *     tags text[] not null default '{}',
 *     merchant text,
 *     is_subscription boolean not null default false,
 *     is_transfer boolean not null default false,
 *     priority integer not null default 0,
 *     note text,
 *     created_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now()
 *   );
 *   create index if not exists categorization_rules_priority_idx
 *     on public.categorization_rules (priority desc, created_at desc);
 *
 *   -- Per il dedup su GoCardless il sync usa già un pre-check client-side,
 *   -- quindi il constraint è facoltativo. Se lo aggiungi, Postgres tratta
 *   -- `(account_id, NULL)` come distinto da un altro `(account_id, NULL)`
 *   -- quindi le transazioni manuali senza `external_id` non collidono.
 *
 * Migrazione additiva se le tabelle esistono già:
 *
 *   alter table public.accounts
 *     add column if not exists iban text,
 *     add column if not exists institution_id text,
 *     add column if not exists requisition_id text,
 *     add column if not exists gocardless_account_id text,
 *     add column if not exists last_sync_at timestamptz;
 *
 *   create unique index if not exists accounts_gocardless_account_id_key
 *     on public.accounts (gocardless_account_id)
 *     where gocardless_account_id is not null;
 *
 *   alter table public.transactions
 *     add column if not exists tags text[] not null default '{}',
 *     add column if not exists is_subscription boolean not null default false,
 *     add column if not exists is_transfer boolean not null default false,
 *     add column if not exists account_id uuid references public.accounts(id) on delete set null,
 *     add column if not exists external_id text;
 *
 *   create table if not exists public.categorization_rules (
 *     id uuid primary key default gen_random_uuid(),
 *     match_type text not null default 'description_contains',
 *     pattern text not null,
 *     category text not null default 'Altro',
 *     tags text[] not null default '{}',
 *     merchant text,
 *     is_subscription boolean not null default false,
 *     is_transfer boolean not null default false,
 *     priority integer not null default 0,
 *     note text,
 *     created_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now()
 *   );
 *   create index if not exists categorization_rules_priority_idx
 *     on public.categorization_rules (priority desc, created_at desc);
 *
 *   -- Se avevi il vecchio indice partial, droppalo e sostituiscilo con un
 *   -- vero unique constraint (serve a `ON CONFLICT` se un giorno tornerai
 *   -- ad usare `upsert` al posto dell'insert + pre-check):
 *
 *   drop index if exists public.transactions_account_external_key;
 *   alter table public.transactions
 *     drop constraint if exists transactions_account_external_unique;
 *   alter table public.transactions
 *     add constraint transactions_account_external_unique
 *     unique (account_id, external_id);
 *
 * Per abilitare gli aggiornamenti in tempo reale:
 *   alter publication supabase_realtime add table public.transactions;
 *   alter publication supabase_realtime add table public.accounts;
 *   alter publication supabase_realtime add table public.categorization_rules;
 *
 * --- Multi-tenant (Supabase Auth) -----------------------------------------
 * Collega ogni riga all'utente autenticato + abilita RLS:
 *
 *   alter table public.accounts add column if not exists user_id uuid
 *     references auth.users(id) on delete cascade;
 *   alter table public.transactions add column if not exists user_id uuid
 *     references auth.users(id) on delete cascade;
 *   alter table public.categorization_rules add column if not exists user_id uuid
 *     references auth.users(id) on delete cascade;
 *
 *   create index if not exists accounts_user_id_idx on public.accounts (user_id);
 *   create index if not exists transactions_user_id_idx on public.transactions (user_id);
 *   create index if not exists categorization_rules_user_id_idx
 *     on public.categorization_rules (user_id);
 *
 *   alter table public.accounts enable row level security;
 *   alter table public.transactions enable row level security;
 *   alter table public.categorization_rules enable row level security;
 *
 *   create policy "accounts_own" on public.accounts for all
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *   create policy "transactions_own" on public.transactions for all
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *   create policy "rules_own" on public.categorization_rules for all
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * Dopo la migrazione, esegui un backfill una tantum (es. tutto a un utente)
 * oppure svuota le tabelle di test.
 */
export type AccountRow = {
  id: string;
  /** Proprietario — obbligatorio quando RLS è attiva (migrazione Auth). */
  user_id: string | null;
  name: string;
  type: string;
  balance: number;
  logo_url: string | null;
  iban: string | null;
  institution_id: string | null;
  requisition_id: string | null;
  gocardless_account_id: string | null;
  last_sync_at: string | null;
  created_at: string;
};

export type TransactionRow = {
  id: string;
  user_id: string | null;
  date: string;
  description: string;
  merchant: string | null;
  category: TransactionCategory;
  amount: number;
  tags: string[];
  is_subscription: boolean;
  /**
   * Flag "è un giroconto / trasferimento interno". Le transazioni marcate
   * `true` vengono escluse dai totali entrate/uscite perché rappresentano
   * spostamenti di denaro fra conti dello stesso utente e altrimenti
   * falserebbero le statistiche mensili.
   */
  is_transfer: boolean;
  account_id: string | null;
  external_id: string | null;
  created_at: string;
};

/**
 * Regola di categorizzazione definita dall'utente. Viene applicata come
 * contesto prima della chiamata a Gemini: se il pattern matcha la
 * transazione sostituiamo la risposta dell'IA con i valori qui dichiarati
 * (e saltiamo la chiamata). Le regole vengono comunque mostrate a Gemini
 * come "memoria" così anche per transazioni non coperte da regola esatta
 * l'IA impara il gusto dell'utente.
 */
export type CategorizationRuleRow = {
  id: string;
  user_id: string | null;
  match_type: "description_contains" | "merchant_contains" | "description_regex";
  pattern: string;
  category: TransactionCategory;
  tags: string[];
  merchant: string | null;
  is_subscription: boolean;
  is_transfer: boolean;
  priority: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      transactions: {
        Row: TransactionRow;
        Insert: Omit<
          TransactionRow,
          | "id"
          | "created_at"
          | "date"
          | "tags"
          | "is_subscription"
          | "is_transfer"
          | "account_id"
          | "external_id"
          | "user_id"
        > & {
          id?: string;
          date?: string;
          created_at?: string;
          tags?: string[];
          is_subscription?: boolean;
          is_transfer?: boolean;
          account_id?: string | null;
          external_id?: string | null;
          user_id?: string | null;
        };
        Update: Partial<TransactionRow>;
        Relationships: [];
      };
      categorization_rules: {
        Row: CategorizationRuleRow;
        Insert: Omit<
          CategorizationRuleRow,
          | "id"
          | "created_at"
          | "updated_at"
          | "tags"
          | "priority"
          | "is_subscription"
          | "is_transfer"
          | "match_type"
          | "user_id"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tags?: string[];
          priority?: number;
          is_subscription?: boolean;
          is_transfer?: boolean;
          match_type?: CategorizationRuleRow["match_type"];
          user_id?: string | null;
        };
        Update: Partial<CategorizationRuleRow>;
        Relationships: [];
      };
      accounts: {
        Row: AccountRow;
        Insert: Omit<
          AccountRow,
          | "id"
          | "created_at"
          | "balance"
          | "iban"
          | "institution_id"
          | "requisition_id"
          | "gocardless_account_id"
          | "last_sync_at"
          | "logo_url"
          | "user_id"
        > & {
          id?: string;
          created_at?: string;
          balance?: number;
          logo_url?: string | null;
          iban?: string | null;
          institution_id?: string | null;
          requisition_id?: string | null;
          gocardless_account_id?: string | null;
          last_sync_at?: string | null;
          user_id?: string | null;
        };
        Update: Partial<AccountRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
  };
};

let browserClient: SupabaseClient<Database> | null = null;

/**
 * Restituisce (e memoizza) il client Supabase pensato per il browser.
 * Usa la chiave anonima (sicura da esporre) e NON deve essere usato lato server
 * con privilegi elevati.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase non è configurato. Imposta NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) nel file .env.local."
    );
  }

  browserClient = createBrowserClient<Database>(url, anonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  });

  return browserClient;
}

let adminClient: SupabaseClient<Database> | null = null;

/**
 * Restituisce un client Supabase con privilegi di service-role.
 *
 * IMPORTANTE: da usare SOLO lato server (API routes, server actions, job).
 * Bypassa le Row-Level Security policy e permette le scritture nei flussi
 * automatici (callback GoCardless, sync transazioni, ecc.).
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service role non configurato. Imposta NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel file .env.local."
    );
  }

  adminClient = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}

/**
 * Indica se le variabili d'ambiente Supabase sono presenti.
 * Utile per mostrare uno stato vuoto quando il progetto non è ancora collegato.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}

/**
 * Indica se è disponibile la service-role key (per scritture server-side).
 */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
