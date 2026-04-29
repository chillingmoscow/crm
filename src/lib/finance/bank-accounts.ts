"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type {
  BankAccountFormInput,
  BankAccountGroupFormInput,
  BankAccountGroupRow,
  BankAccountRow,
} from "@/types/finance";

// ─── Read helpers ────────────────────────────────────────────────────────────

export type ListBankAccountsOptions = {
  /** When true, includes soft-deleted accounts (deleted_at is not null). */
  include_deleted?: boolean;
  /** Restrict to a single legal entity. */
  legal_entity_id?: string;
  /** Restrict to a single venue (or pass null for "no venue"). */
  venue_id?: string | null;
};

/**
 * List bank accounts of the active account. RLS gates by
 * account_id = get_active_account_id() AND finance.view_bank_accounts
 * (migration 042 §1).
 */
export async function listBankAccounts(
  opts: ListBankAccountsOptions = {}
): Promise<{ rows: BankAccountRow[]; error: string | null }> {
  const supabase = await createClient();
  let query = supabase.from("bank_accounts").select("*");

  if (!opts.include_deleted) query = query.is("deleted_at", null);
  if (opts.legal_entity_id) query = query.eq("legal_entity_id", opts.legal_entity_id);
  if (opts.venue_id !== undefined) {
    query = opts.venue_id === null
      ? query.is("venue_id", null)
      : query.eq("venue_id", opts.venue_id);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as BankAccountRow[], error: null };
}

export async function getBankAccount(
  id: string
): Promise<{ row: BankAccountRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as BankAccountRow | null) ?? null, error: null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Create a bank account in the active account. Caller must have
 * finance.manage_bank_accounts — RLS enforces this.
 *
 * NOTE: balance starts at 0 and is only updated by the transactions
 * trigger (migration 040). Don't pass balance here.
 */
export async function createBankAccount(
  input: BankAccountFormInput
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

  const { data, error } = await supabase
    .from("bank_accounts")
    .insert({
      account_id: accountId as unknown as string,
      created_by: user.id,
      legal_entity_id:        input.legal_entity_id,
      venue_id:               input.venue_id ?? null,
      name:                   input.name,
      type:                   input.type,
      currency:               input.currency ?? "RUB",
      description:            input.description ?? null,
      group_id:               input.group_id ?? null,
      bank_name:              input.bank_name ?? null,
      bik:                    input.bik ?? null,
      account_number:         input.account_number ?? null,
      correspondent_account:  input.correspondent_account ?? null,
      acquiring_percentage:   input.acquiring_percentage ?? null,
      card_holder:            input.card_holder ?? null,
      card_number_last4:      input.card_number_last4 ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать счёт" };
  }

  revalidatePath("/finance/accounts");
  return { id: data.id, error: null };
}

/**
 * Patch a bank account. Pass only the fields you want to change.
 * The balance column is never accepted here — it's enforced by a guard
 * trigger (migration 040 `bank_account_balance_guard`).
 */
export async function updateBankAccount(
  id: string,
  patch: Partial<BankAccountFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("bank_accounts")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/finance/accounts");
  revalidatePath(`/finance/accounts/${id}`);
  return { error: null };
}

/**
 * Soft-delete a bank account by setting deleted_at. The transactions
 * trigger keeps balance consistent — but RESTRICT on bank_account_id
 * means the account can't be hard-deleted while transactions reference
 * it. Soft delete sidesteps that.
 */
export async function softDeleteBankAccount(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("bank_accounts")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      is_active: false,
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/finance/accounts");
  return { error: null };
}

export async function restoreBankAccount(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_accounts")
    .update({ deleted_at: null, deleted_by: null, is_active: true })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/accounts");
  return { error: null };
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function listBankAccountGroups(): Promise<{
  rows: BankAccountGroupRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_account_groups")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as BankAccountGroupRow[], error: null };
}

export async function createBankAccountGroup(
  input: BankAccountGroupFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }
  const { data, error } = await supabase
    .from("bank_account_groups")
    .insert({
      account_id:  accountId as unknown as string,
      name:        input.name,
      description: input.description ?? null,
      sort_order:  input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать группу" };
  }
  revalidatePath("/finance/settings/account-groups");
  return { id: data.id, error: null };
}

export async function updateBankAccountGroup(
  id: string,
  patch: Partial<BankAccountGroupFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_account_groups")
    .update(patch)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/settings/account-groups");
  return { error: null };
}

export async function deleteBankAccountGroup(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_account_groups")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/settings/account-groups");
  return { error: null };
}
