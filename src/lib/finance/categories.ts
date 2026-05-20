"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
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
  /** When true, includes archived categories (archived_at IS NOT NULL). */
  include_archived?: boolean;
  /** @deprecated Use include_archived. Backwards-compat alias. */
  include_inactive?: boolean;
};

export async function listFinanceCategories(
  opts: ListCategoriesOptions = {}
): Promise<{ rows: FinanceCategoryRow[]; error: string | null }> {
  const supabase = await createClient();
  // archived_at — миграция 202, ещё не в Database-типах → asLooseDb
  const db = asLooseDb(supabase);
  let query = db.from("finance_categories").select("*");

  if (opts.type) query = query.eq("type", opts.type);
  // Codex P1 #373 lesson: явный фильтр в коде, не полагаться на RLS
  // (owner получает archived через PERMISSIVE policy OR).
  const includeArchived = opts.include_archived ?? opts.include_inactive ?? false;
  if (!includeArchived) {
    query = (query as unknown as {
      is: (col: string, val: null) => typeof query;
    }).is("archived_at", null);
  }

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

// ────────────────────────────────────────────────────────────────────────
//  Archive / Restore / Hard-delete — docs/CONVENTIONS.md §2
//
//  finance_categories — full archive + hard-delete. transactions имеют
//  composite FK ON DELETE SET NULL (category_id) — hard-delete безопасен,
//  история сохраняется.
// ────────────────────────────────────────────────────────────────────────

export type FinanceCategoryArchiveImpact = {
  /** Транзакций с этой статьёй (SET NULL — отвяжутся при hard-delete). */
  transactions: number;
};

async function assertCategoryOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId: string,
  userId: string,
): Promise<{ ok: true; account_id: string; name: string } | { ok: false; error: string }> {
  const { data: row } = await supabase
    .from("finance_categories")
    .select("id, name, account_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Статья не найдена" };

  const { data: account } = await supabase
    .from("accounts")
    .select("owner_id")
    .eq("id", row.account_id)
    .maybeSingle();
  if (!account || account.owner_id !== userId) {
    return { ok: false, error: "Действие доступно только владельцу аккаунта" };
  }
  return { ok: true, account_id: row.account_id, name: row.name };
}

export async function getFinanceCategoryArchiveImpact(
  id: string
): Promise<FinanceCategoryArchiveImpact> {
  const supabase = await createClient();
  const headOpts = { count: "exact" as const, head: true };
  const { count } = await supabase
    .from("transactions")
    .select("id", headOpts)
    .eq("category_id", id);
  return { transactions: count ?? 0 };
}

export async function archiveFinanceCategory(
  id: string,
  opts: { confirmName: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertCategoryOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  const db = asLooseDb(supabase);
  const { data: row } = await db
    .from<{ id: string; name: string; archived_at: string | null; is_system: boolean }>(
      "finance_categories",
    )
    .select("id, name, archived_at, is_system")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Статья не найдена" };
  if (row.is_system) return { error: "Системную статью нельзя архивировать" };
  if (row.archived_at) return { error: null }; // идемпотентно

  if (opts.confirmName.trim() !== row.name.trim()) {
    return { error: "Введите название точно как у статьи" };
  }

  const { error } = await db
    .from("finance_categories")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user.id,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/finance/categories");
  revalidatePath("/finance/categories/archive");
  return { error: null };
}

/** @deprecated Use archiveFinanceCategory. */
export async function deactivateFinanceCategory(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("finance_categories")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Статья не найдена" };
  return archiveFinanceCategory(id, { confirmName: row.name });
}

export async function restoreFinanceCategory(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertCategoryOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  const db = asLooseDb(supabase);
  const { error } = await db
    .from("finance_categories")
    .update({
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/categories");
  revalidatePath("/finance/categories/archive");
  return { error: null };
}

/** @deprecated Use restoreFinanceCategory. */
export async function reactivateFinanceCategory(
  id: string
): Promise<{ error: string | null }> {
  return restoreFinanceCategory(id);
}

export async function deleteFinanceCategory(
  id: string,
  opts?: { confirmName?: string }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const ownerCheck = await assertCategoryOwner(supabase, id, user.id);
  if (!ownerCheck.ok) return { error: ownerCheck.error };

  // confirmName опционален для обратной совместимости со старыми вызовами
  if (opts?.confirmName !== undefined && opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у статьи" };
  }

  const { error } = await supabase
    .from("finance_categories")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/categories");
  revalidatePath("/finance/categories/archive");
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
