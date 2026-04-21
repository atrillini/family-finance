# FamilyFinance AI

Web app di gestione finanziaria familiare, costruita con **Next.js 16**, **Tailwind CSS v4**, **Lucide React**, **Supabase** e **Google Gemini**. Il design è ispirato ad Apple Card: superfici chiare, tipografia SF, carte con gradienti profondi e micro‑interazioni discrete.

## Funzionalità

- **Dashboard** con saldo totale, entrate e uscite del mese.
- **Tabella transazioni** con icone per categoria, alimentata in tempo reale da Supabase.
- **AddTransaction**: form che interroga Gemini per la categoria suggerita e scrive su Supabase.
- **Budget** per categoria con barre di avanzamento.
- **Impostazioni** con il pannello di integrazione Gemini.
- **Sidebar** di navigazione: _Dashboard_, _Transazioni_, _Budget_, _Impostazioni_.
- **Fallback** automatico a dati di esempio quando Supabase non è configurato.

## Getting Started

```bash
npm install
cp .env.example .env.local   # compila le variabili d'ambiente
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

## Variabili d'ambiente

| Variabile                        | Dove vive      | A cosa serve                                               |
| -------------------------------- | -------------- | ---------------------------------------------------------- |
| `GEMINI_API_KEY`                 | Solo server    | Chiamate a Gemini dall'endpoint `/api/categorize`.         |
| `NEXT_PUBLIC_SUPABASE_URL`       | Browser/server | URL del progetto Supabase.                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Browser/server | Chiave `anon` per leggere/scrivere dal client con RLS.     |

La chiave di Gemini **non** viene mai esposta al browser: il componente `AddTransaction` chiama la route `/api/categorize`, che a sua volta usa `lib/gemini.ts`.

## Schema Supabase

Esegui questo SQL nell'editor SQL di Supabase:

```sql
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  date timestamptz not null default now(),
  description text not null,
  merchant text,
  category text not null default 'Altro',
  amount numeric not null,
  tags text[] not null default '{}',
  is_subscription boolean not null default false,
  created_at timestamptz not null default now()
);

-- Abilita il realtime sulla tabella
alter publication supabase_realtime add table public.transactions;

-- (Demo) Row Level Security con accesso libero – in produzione limita per utente
alter table public.transactions enable row level security;
create policy "read all" on public.transactions for select using (true);
create policy "insert all" on public.transactions for insert with check (true);
```

Se hai già la tabella creata dalla versione precedente, aggiungi solo le colonne nuove:

```sql
alter table public.transactions
  add column if not exists tags text[] not null default '{}',
  add column if not exists is_subscription boolean not null default false;
```

## Flusso di inserimento transazione

```
 AddTransaction (client)
   │
   │ 1. POST /api/categorize { description }
   ▼
 app/api/categorize/route.ts ── usa GEMINI_API_KEY
   │
   │ 2. category suggerita
   ▼
 AddTransaction → supabase.from("transactions").insert(...)
   │
   ▼
 Supabase Realtime → DashboardClient aggiorna la lista in tempo reale
```

## Struttura del progetto

```
app/
  api/categorize/route.ts   # proxy server-side per Gemini
  components/
    Sidebar.tsx
    PageHeader.tsx
    SummaryCards.tsx
    TransactionsTable.tsx
    AddTransaction.tsx      # form con suggerimento AI + insert Supabase
    DashboardClient.tsx     # fetch iniziale + subscription realtime
  page.tsx                  # Dashboard
  transazioni/              # Pagina Transazioni
  budget/                   # Pagina Budget
  impostazioni/             # Pagina Impostazioni
lib/
  gemini.ts                 # integrazione Google Generative AI
  supabase.ts               # client Supabase tipizzato + TransactionRow
  mock-data.ts              # dati fittizi + helper €/date
```
