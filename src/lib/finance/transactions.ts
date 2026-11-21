"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { TransactionFormInput, TransactionRow } from "@/types/finance";
import {
  fetchTransactionsPage,
  type QueryTransactionsOptions,
  type QueryTransactionsResult,
} from "./transactions-page-query";

// ─── List + filters ─────────────────────────────────────────────────────────

/**
 * Страница списка для клиента. Размер страницы ограничен 100 строками:
 * действие вызывается из браузера, а крупная выборка — только у выгрузки
 * (она идёт через `fetchTransactionsPage` с проверкой finance.export).
 */
export async function queryTransactions(
  opts: QueryTransactionsOptions = {},
): Promise<QueryTransactionsResult> {
  return fetchTransactionsPage({
    ...opts,
    pageSize: Math.min(100, Math.max(1, opts.pageSize ?? 25)),
  });
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

  // `.select` — чтобы отличить «сохранено» от «ничего не изменилось»: если
  // политика transactions_update не пропустила строку (чужая операция без
  // finance.update_any_transaction), PostgREST отвечает без ошибки и без строк.
  const { data, error } = await supabase
    .from("transactions")
    .update({
      ...normalised,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0)
    return { error: "Операцию не удалось сохранить: нет прав на её изменение или она удалена" };

  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { error: null };
}

/** Что можно поменять сразу у нескольких операций. */
export type BulkTransactionPatch =
  | { field: "category_id"; value: string | null }
  | { field: "counterparty_id"; value: string | null }
  | { field: "venue_id"; value: string | null };

/**
 * Массовая правка: статья, контрагент или заведение у выбранных операций.
 *
 * По одной операции, а не одним UPDATE: связанные операции (выплаты
 * зарплаты, покупки формы) отклоняются триггером, и одна такая строка не
 * должна отменять правку остальных. Права — та же политика
 * transactions_update: чужие операции без update_any молча не меняются,
 * их считаем по пустому ответу. Статья и контрагент к переводам не
 * относятся — переводы пропускаются; статья ставится только операциям
 * своего типа (приход / расход).
 */
export async function bulkUpdateTransactions(
  ids: string[],
  patch: BulkTransactionPatch,
): Promise<{ updated: number; skipped: number; error: string | null }> {
  if (!["category_id", "counterparty_id", "venue_id"].includes(patch.field))
    return { updated: 0, skipped: ids.length, error: "Это поле нельзя менять массово" };
  const unique = [...new Set(ids)].slice(0, 500);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { updated: 0, skipped: unique.length, error: "Сессия устарела. Обновите страницу" };

  let categoryType: "income" | "expense" | null = null;
  if (patch.field === "category_id" && patch.value) {
    const { data: category } = await supabase
      .from("finance_categories")
      .select("type")
      .eq("id", patch.value)
      .maybeSingle();
    if (!category) return { updated: 0, skipped: unique.length, error: "Статья не найдена" };
    categoryType = category.type as "income" | "expense";
  }

  let updated = 0;
  let lastError: string | null = null;
  for (const id of unique) {
    let query = supabase
      .from("transactions")
      .update({
        [patch.field]: patch.value,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null);
    if (patch.field !== "venue_id") query = query.neq("type", "transfer");
    if (categoryType) query = query.eq("type", categoryType);
    const { data, error } = await query.select("id");
    if (error) lastError = error.message;
    else if (data && data.length > 0) updated++;
  }

  if (updated > 0) {
    revalidatePath("/finance/transactions");
    revalidatePath("/finance");
  }
  return {
    updated,
    skipped: unique.length - updated,
    error: updated === 0 ? (lastError ?? "Ни одну операцию изменить не удалось: нет прав или операции не подходят") : null,
  };
}

/**
 * Soft delete: sets deleted_at = now(). The balance trigger reverts the
 * effect on bank_accounts.balance automatically.
 */
export async function softDeleteTransaction(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_soft_delete_transaction", {
    p_id: id,
  });
  if (error) return { error: humanizeDeleteError(error.message, "delete") };
  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { error: null };
}

export async function restoreTransaction(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_restore_transaction", {
    p_id: id,
  });
  if (error) return { error: humanizeDeleteError(error.message, "restore") };
  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/finance");
  return { error: null };
}

/**
 * Тексты ошибок функций удаления и восстановления (миграция 105) начинаются
 * с имени функции и id — для экрана они технические. Ошибки связанных
 * операций (выплаты зарплаты, покупки формы) уже написаны для человека и
 * проходят как есть.
 */
function humanizeDeleteError(message: string, action: "delete" | "restore"): string {
  if (/нет права/.test(message))
    return action === "delete"
      ? "Нет прав на удаление операций"
      : "Нет прав на восстановление операций";
  if (/не найдена/.test(message))
    return action === "delete"
      ? "Операция уже удалена или недоступна"
      : "Операция уже восстановлена или недоступна";
  if (/не авторизован|нет активного account/.test(message))
    return "Сессия устарела. Обновите страницу";
  return message.replace(/^finance_[a-z_]+:\s*/, "");
}
