"use server";

import { revalidatePath } from "next/cache";

import { writeAuditEvent } from "@/lib/audit/write";
import {
  parseBankBalance,
  type ReconciliationRecord,
  type ReconciliationSearch,
  type ReconciliationSuspect,
} from "@/lib/finance/bank-reconciliation";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";

// Сверка остатка счёта с банком (миграция 374). Остаток на дату и
// расчётный остаток сверки считает база; здесь — права, журнал и
// перевод ошибок базы в понятные фразы.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIMEZONE = "Europe/Moscow";
const NOTE_MAX = 500;

/** Ошибки триггера сверки (миграция 374) уже написаны для человека. */
function friendlyError(error: { message: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "22023" || error.code === "P0002") return error.message;
  if (error.code === "42501") return "Сверять остаток могут те, кто управляет счетами";
  return fallback;
}

/** Пояс аккаунта (миграция 370): граница дня и «сегодня» по умолчанию. */
export async function getReconciliationTimezone(): Promise<string> {
  const supabase = await createClient();
  // Функция из миграции 370; в сгенерированных типах её пока нет.
  const { data } = await asLooseDb(supabase).rpc("get_active_account_timezone");
  return typeof data === "string" && data.trim() ? data.trim() : DEFAULT_TIMEZONE;
}

/** Остаток счёта по операциям на конец дня. null — дата раньше контрольного остатка. */
export async function getBankAccountBalanceAt(
  bankAccountId: string,
  day: string,
): Promise<{ balance: number | null; error: string | null }> {
  if (!ISO_DAY.test(day)) return { balance: null, error: "Укажите дату" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bank_account_balance_at", {
    p_bank_account_id: bankAccountId,
    p_date: day,
  });
  if (error) return { balance: null, error: "Не удалось посчитать остаток. Повторите попытку" };
  return { balance: data === null || data === undefined ? null : Number(data), error: null };
}

type AuditProfile = { id: string; first_name: string | null; last_name: string | null };

function shortName(p: AuditProfile | undefined): string | null {
  if (!p) return null;
  const first = (p.first_name ?? "").trim();
  const last = (p.last_name ?? "").trim();
  if (!first && !last) return null;
  return last ? `${first} ${last.charAt(0)}.`.trim() : first;
}

/** История сверок счёта, новые сверху, с текущим расчётом на их дату. */
export async function listBankAccountReconciliations(
  bankAccountId: string,
): Promise<{ rows: ReconciliationRecord[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bank_account_reconciliation_history", {
    p_bank_account_id: bankAccountId,
  });
  if (error) return { rows: [], error: "Не удалось загрузить сверки" };
  const raw = data ?? [];
  const authorIds = [...new Set(raw.map((r) => r.created_by).filter((v): v is string => !!v))];
  const { data: profiles } = authorIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name").in("id", authorIds)
    : { data: [] as AuditProfile[] };
  const byId = new Map(((profiles ?? []) as AuditProfile[]).map((p) => [p.id, p]));
  return {
    rows: raw.map((r) => ({
      id: r.id,
      balance_date: r.balance_date,
      bank_balance: Number(r.bank_balance),
      calculated_balance: Number(r.calculated_balance),
      current_calculated_balance:
        r.current_calculated_balance === null ? null : Number(r.current_calculated_balance),
      source: r.source === "bank" ? "bank" : "manual",
      note: r.note,
      created_at: r.created_at,
      created_by: r.created_by,
      created_by_name: shortName(r.created_by ? byId.get(r.created_by) : undefined),
    })),
    error: null,
  };
}

/** Операции за период поиска и те, чья сумма объясняет разницу. */
export async function searchReconciliationDiscrepancy(
  bankAccountId: string,
  window: { from: string | null; to: string },
  diff: number,
): Promise<{ search: ReconciliationSearch | null; error: string | null }> {
  if (!ISO_DAY.test(window.to) || (window.from !== null && !ISO_DAY.test(window.from))) {
    return { search: null, error: "Неверный период" };
  }
  const supabase = await createClient();
  const { data, error } = await asLooseDb(supabase).rpc("bank_account_reconciliation_search", {
    p_bank_account_id: bankAccountId,
    p_from: window.from,
    p_to: window.to,
    p_diff: diff,
  });
  if (error || !data) return { search: null, error: "Не удалось найти операции за период" };
  const value = data as { operations?: unknown; suspects?: unknown };
  const suspects = Array.isArray(value.suspects)
    ? (value.suspects as ReconciliationSuspect[]).map((s) => ({ ...s, amount: Number(s.amount) }))
    : [];
  return { search: { operations: Number(value.operations ?? 0), suspects }, error: null };
}

export type CreateReconciliationInput = {
  bankAccountId: string;
  balanceDate: string;
  /** Как ввёл пользователь: «1 234,56». */
  bankBalance: string;
  note?: string;
};

export async function createBankAccountReconciliation(
  input: CreateReconciliationInput,
): Promise<{ row: { id: string; calculated_balance: number } | null; error: string | null }> {
  const [supabase, user, accountId, can] = await Promise.all([
    createClient(),
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  if (!user) return { row: null, error: "Не авторизован" };
  if (!accountId) return { row: null, error: "Не удалось определить активный аккаунт" };
  if (!can("finance.manage_bank_accounts")) {
    return { row: null, error: "Сверять остаток могут те, кто управляет счетами" };
  }
  if (!ISO_DAY.test(input.balanceDate)) return { row: null, error: "Укажите дату" };
  const bankBalance = parseBankBalance(input.bankBalance);
  if (bankBalance === null) return { row: null, error: "Остаток — число, не больше двух знаков после запятой" };
  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX) return { row: null, error: `Комментарий — не длиннее ${NOTE_MAX} символов` };

  const { data: account } = await supabase
    .from("bank_accounts")
    .select("id, name, currency, venue_id")
    .eq("id", input.bankAccountId)
    .maybeSingle();
  if (!account) return { row: null, error: "Счёт не найден" };

  // calculated_balance, автора и время ставит триггер — передаём заглушку.
  const { data, error } = await supabase
    .from("bank_account_reconciliations")
    .insert({
      account_id: accountId,
      bank_account_id: input.bankAccountId,
      balance_date: input.balanceDate,
      bank_balance: bankBalance,
      calculated_balance: 0,
      note,
    })
    .select("id, balance_date, bank_balance, calculated_balance")
    .maybeSingle();
  if (error || !data) {
    return { row: null, error: friendlyError(error, "Не удалось сохранить сверку. Повторите попытку") };
  }

  const calculated = Number(data.calculated_balance);
  await writeAuditEvent({
    accountId,
    venueId: account.venue_id,
    userId: user.id,
    actionCode: "finance.bank_account_reconciliation.created",
    entityType: "bank_account",
    entityId: input.bankAccountId,
    details: {
      reconciliation_id: data.id,
      name: account.name,
      currency: account.currency,
      balance_date: data.balance_date,
      bank_balance: Number(data.bank_balance),
      calculated_balance: calculated,
    },
  });

  revalidatePath(`/finance/accounts/${input.bankAccountId}`);
  return { row: { id: data.id, calculated_balance: calculated }, error: null };
}

export async function deleteBankAccountReconciliation(
  reconciliationId: string,
): Promise<{ error: string | null }> {
  const [supabase, user, accountId, can] = await Promise.all([
    createClient(),
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  if (!user) return { error: "Не авторизован" };
  if (!accountId) return { error: "Не удалось определить активный аккаунт" };
  if (!can("finance.manage_bank_accounts")) {
    return { error: "Удалять сверки могут те, кто управляет счетами" };
  }

  // RLS молча удалила бы 0 строк — проверяем, что строка правда ушла.
  const { data, error } = await supabase
    .from("bank_account_reconciliations")
    .delete()
    .eq("id", reconciliationId)
    .select("id, bank_account_id, balance_date, bank_balance, calculated_balance");
  if (error) return { error: "Не удалось удалить сверку. Повторите попытку" };
  const removed = data?.[0];
  if (!removed) return { error: "Сверка уже удалена или счёт в архиве" };

  const { data: account } = await supabase
    .from("bank_accounts")
    .select("name, currency, venue_id")
    .eq("id", removed.bank_account_id)
    .maybeSingle();

  await writeAuditEvent({
    accountId,
    venueId: account?.venue_id ?? null,
    userId: user.id,
    actionCode: "finance.bank_account_reconciliation.deleted",
    entityType: "bank_account",
    entityId: removed.bank_account_id,
    details: {
      reconciliation_id: removed.id,
      name: account?.name ?? null,
      currency: account?.currency ?? "RUB",
      balance_date: removed.balance_date,
      bank_balance: Number(removed.bank_balance),
      calculated_balance: Number(removed.calculated_balance),
    },
  });

  revalidatePath(`/finance/accounts/${removed.bank_account_id}`);
  return { error: null };
}
