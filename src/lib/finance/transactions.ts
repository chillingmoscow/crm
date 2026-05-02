"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type {
  TransactionFormInput,
  TransactionListFilters,
  TransactionRow,
} from "@/types/finance";

// ─── List + filters ─────────────────────────────────────────────────────────

export type ListTransactionsOptions = {
  filters?: TransactionListFilters;
  /** 1-based page number. */
  page?: number;
  /** Page size (clamped 1..200). Default 50. */
  pageSize?: number;
};

export type ListTransactionsResult = {
  rows: TransactionRow[];
  /** Total count of rows matching the filter (via supabase `{ count: "exact" }`). */
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
};

/**
 * List transactions of the active account, ordered by date desc.
 * RLS gates by account_id = get_active_account_id() AND
 * finance.view_transactions (migration 042 §4).
 */
export async function listTransactions(
  opts: ListTransactionsOptions = {}
): Promise<ListTransactionsResult> {
  const supabase = await createClient();
  const filters = opts.filters ?? {};
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("transactions")
    .select("*", { count: "exact" });

  if (!filters.include_deleted) query = query.is("deleted_at", null);

  if (filters.legal_entity_id)  query = query.eq("legal_entity_id", filters.legal_entity_id);
  if (filters.venue_id)         query = query.eq("venue_id", filters.venue_id);

  // Single-or-list filter: scalar → eq, array → in. Used by the multi-select
  // chips on /finance/transactions to pass [id1, id2, …] without us having
  // to widen the API to per-id round trips.
  query = applyEqOrIn(query, "bank_account_id", filters.bank_account_id);

  // Category & counterparty additionally support an "include null" flag — the
  // multi-select chips have a special "Без статьи" / "Без контрагента" entry.
  // OR-clause syntax follows postgrest: `field.is.null,field.in.(a,b)`.
  query = applyEqOrInWithNull(
    query,
    "category_id",
    filters.category_id,
    filters.category_include_none,
  );
  query = applyEqOrInWithNull(
    query,
    "counterparty_id",
    filters.counterparty_id,
    filters.counterparty_include_none,
  );

  if (filters.type)             query = query.eq("type", filters.type);
  if (filters.source)           query = query.eq("source", filters.source);

  if (filters.date_from)        query = query.gte("date", filters.date_from);
  if (filters.date_to)          query = query.lte("date", filters.date_to);
  if (filters.amount_min !== undefined) query = query.gte("amount", filters.amount_min);
  if (filters.amount_max !== undefined) query = query.lte("amount", filters.amount_max);

  if (filters.q && filters.q.trim()) {
    query = query.ilike("description", `%${filters.q.trim()}%`);
  }

  const { data, error, count } = await query
    .order("date", { ascending: false })
    .order("public_id", { ascending: false })
    .range(from, to);

  if (error) {
    return { rows: [], total: 0, page, pageSize, error: error.message };
  }
  return {
    rows: (data ?? []) as TransactionRow[],
    total: count ?? 0,
    page,
    pageSize,
    error: null,
  };
}

// Local query builder helpers for list-filter polymorphism. Kept here (not
// extracted into a shared util) because they're tightly coupled to the
// supabase-js fluent API and only used by listTransactions.

type Q = ReturnType<ReturnType<Awaited<ReturnType<typeof createClient>>["from"]>["select"]>;

function applyEqOrIn(query: Q, field: string, value: string | string[] | undefined): Q {
  if (value === undefined) return query;
  if (Array.isArray(value)) {
    if (value.length === 0) return query;
    return query.in(field, value);
  }
  if (value === "") return query;
  return query.eq(field, value);
}

function applyEqOrInWithNull(
  query: Q,
  field: string,
  value: string | string[] | undefined,
  includeNone: boolean | undefined,
): Q {
  const list = Array.isArray(value)
    ? value.filter((v) => v !== "")
    : value
      ? [value]
      : [];
  const wantsNone = !!includeNone;

  if (list.length === 0 && !wantsNone) return query;
  if (list.length === 0 && wantsNone) return query.is(field, null);
  if (list.length > 0 && !wantsNone) return query.in(field, list);

  // Both: rows with field IS NULL OR field IN (list).
  // Postgrest .or() takes a CSV of `<col>.<op>.<value>` clauses.
  return query.or(`${field}.is.null,${field}.in.(${list.join(",")})`);
}

export async function getTransaction(
  id: string
): Promise<{ row: TransactionRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as TransactionRow | null) ?? null, error: null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Create a transaction. The DB trigger pereschityvaet bank_accounts.balance
 * automatically (migration 040). Don't try to update balance manually —
 * it will be silently rolled back by the guard trigger.
 *
 * For type='transfer', the input must include `to_bank_account_id` and
 * `to_legal_entity_id`. For income/expense those fields must be absent —
 * the discriminated union in TransactionFormInput enforces it at compile
 * time, and the DB enforces it at runtime via check constraints.
 */
export async function createTransaction(
  input: TransactionFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }

  const base = {
    account_id:         accountId as unknown as string,
    created_by:         user.id,
    legal_entity_id:    input.legal_entity_id,
    venue_id:           input.venue_id ?? null,
    bank_account_id:    input.bank_account_id,
    type:               input.type,
    amount:             input.amount,
    currency:           input.currency ?? "RUB",
    date:               input.date,
    description:        input.description ?? null,
    source:             input.source ?? "manual",
    source_external_id: input.source_external_id ?? null,
  } as const;

  const payload =
    input.type === "transfer"
      ? {
          ...base,
          to_bank_account_id: input.to_bank_account_id,
          to_legal_entity_id: input.to_legal_entity_id,
          category_id: null,
          counterparty_id: null,
        }
      : {
          ...base,
          category_id: input.category_id ?? null,
          counterparty_id: input.counterparty_id ?? null,
          to_bank_account_id: null,
          to_legal_entity_id: null,
        };

  const { data, error } = await supabase
    .from("transactions")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать транзакцию" };
  }

  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { id: data.id, error: null };
}

/**
 * Patch a transaction. The balance trigger handles the delta between OLD
 * and NEW automatically. Cross-tenant FKs (migration 040) ensure that
 * any swapped legal_entity / bank_account / category / counterparty
 * stays inside the active account.
 *
 * When `patch.type` changes the variant, the now-irrelevant columns
 * are nulled out — otherwise the row would violate the check
 * constraints from migration 040 (`income_expense_no_to_account`,
 * `transfer_requires_to_account`, etc.). Mirrors the normalisation
 * `createTransaction` does on insert.
 */
export async function updateTransaction(
  id: string,
  patch: Partial<TransactionFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const normalised: Record<string, unknown> = { ...patch };
  if (patch.type === "transfer") {
    normalised.category_id     = null;
    normalised.counterparty_id = null;
  } else if (patch.type === "income" || patch.type === "expense") {
    normalised.to_bank_account_id = null;
    normalised.to_legal_entity_id = null;
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      ...normalised,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/finance/transactions");
  revalidatePath(`/finance/transactions/${id}`);
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { error: null };
}

/**
 * Soft delete: sets deleted_at = now(). The balance trigger reverts the
 * effect on bank_accounts.balance automatically.
 */
export async function softDeleteTransaction(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("transactions")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { error: null };
}

export async function restoreTransaction(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { error: null };
}
