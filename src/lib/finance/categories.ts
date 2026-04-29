"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type {
  FinanceCategoryFormInput,
  FinanceCategoryGroupFormInput,
  FinanceCategoryGroupRow,
  FinanceCategoryRow,
} from "@/types/finance";

// ─── Read helpers ────────────────────────────────────────────────────────────

export type ListCategoriesOptions = {
  /** Restrict to a single category type. */
  type?: FinanceCategoryRow["type"];
  /** When true, includes inactive categories (is_active = false). */
  include_inactive?: boolean;
};

export async function listFinanceCategories(
  opts: ListCategoriesOptions = {}
): Promise<{ rows: FinanceCategoryRow[]; error: string | null }> {
  const supabase = await createClient();
  let query = supabase.from("finance_categories").select("*");

  if (opts.type) query = query.eq("type", opts.type);
  if (!opts.include_inactive) query = query.eq("is_active", true);

  const { data, error } = await query
    .order("type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as FinanceCategoryRow[], error: null };
}

export async function getFinanceCategory(
  id: string
): Promise<{ row: FinanceCategoryRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_categories")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as FinanceCategoryRow | null) ?? null, error: null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createFinanceCategory(
  input: FinanceCategoryFormInput
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
    .from("finance_categories")
    .insert({
      account_id:   accountId as unknown as string,
      created_by:   user.id,
      name:         input.name,
      type:         input.type,
      description:  input.description ?? null,
      color:        input.color ?? null,
      icon:         input.icon ?? null,
      group_id:     input.group_id ?? null,
      sort_order:   input.sort_order ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать статью" };
  }

  revalidatePath("/finance/categories");
  return { id: data.id, error: null };
}

export async function updateFinanceCategory(
  id: string,
  patch: Partial<FinanceCategoryFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("finance_categories")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/finance/categories");
  return { error: null };
}

/**
 * Soft-deactivate a category. Hard delete is gated on
 * finance.delete_category — RLS rejects for everyone else. Hard delete
 * additionally would NULL out `transactions.category_id` (composite FK
 * with ON DELETE SET NULL on category_id, migration 040).
 */
export async function deactivateFinanceCategory(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_categories")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/categories");
  return { error: null };
}

export async function deleteFinanceCategory(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_categories")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/categories");
  return { error: null };
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function listFinanceCategoryGroups(): Promise<{
  rows: FinanceCategoryGroupRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_category_groups")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as FinanceCategoryGroupRow[], error: null };
}

export async function createFinanceCategoryGroup(
  input: FinanceCategoryGroupFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }
  const { data, error } = await supabase
    .from("finance_category_groups")
    .insert({
      account_id: accountId as unknown as string,
      name:       input.name,
      type:       input.type ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать группу" };
  }
  revalidatePath("/finance/settings/category-groups");
  return { id: data.id, error: null };
}

export async function updateFinanceCategoryGroup(
  id: string,
  patch: Partial<FinanceCategoryGroupFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_category_groups")
    .update(patch)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/settings/category-groups");
  return { error: null };
}

export async function deleteFinanceCategoryGroup(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_category_groups")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/settings/category-groups");
  return { error: null };
}
