import type { QueryFilter } from "@/lib/gemini";
import type { Transaction } from "@/lib/mock-data";

/**
 * Applica un filtro da ricerca NL a una query Supabase PostgREST.
 * Vedi commenti in `DashboardClient` (stesso comportamento).
 */
export function applySupabaseFilter<Q>(query: Q, filter: QueryFilter): Q {
  const { column, operator, value } = filter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;

  switch (operator) {
    case "eq":
      return q.eq(column, value) as Q;
    case "gt":
      return q.gt(column, value) as Q;
    case "gte":
      return q.gte(column, value) as Q;
    case "lt":
      return q.lt(column, value) as Q;
    case "lte":
      return q.lte(column, value) as Q;
    case "ilike":
      return q.ilike(column, String(value)) as Q;
    case "containedBy":
      if (column === "tags") {
        return q.contains("tags", [String(value)]) as Q;
      }
      return q.eq(column, value) as Q;
    default:
      return query;
  }
}

/**
 * Valuta in locale se una riga rispetta il filtro (mock, realtime, test).
 */
export function rowMatchesFilter(row: Transaction, filter: QueryFilter): boolean {
  const raw = (row as unknown as Record<string, unknown>)[filter.column];

  switch (filter.operator) {
    case "eq":
      return String(raw) === String(filter.value);
    case "gt":
      return Number(raw) > Number(filter.value);
    case "gte":
      if (filter.column === "date") {
        return (
          String(raw ?? "").slice(0, 10) >= String(filter.value).slice(0, 10)
        );
      }
      return Number(raw) >= Number(filter.value);
    case "lt":
      return Number(raw) < Number(filter.value);
    case "lte":
      if (filter.column === "date") {
        return (
          String(raw ?? "").slice(0, 10) <= String(filter.value).slice(0, 10)
        );
      }
      return Number(raw) <= Number(filter.value);
    case "ilike": {
      const pattern = String(filter.value).replace(/%/g, "").toLowerCase();
      return String(raw ?? "").toLowerCase().includes(pattern);
    }
    case "containedBy":
      if (Array.isArray(raw)) {
        return raw
          .map((v) => String(v).toLowerCase())
          .includes(String(filter.value).toLowerCase());
      }
      return false;
    default:
      return true;
  }
}
