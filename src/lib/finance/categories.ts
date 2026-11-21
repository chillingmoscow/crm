"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { writeAuditEvent } from "@/lib/audit/write";
import type {
  FinanceCategoryFormInput,
  FinanceCategoryGroupFormInput,
  FinanceCategoryGroupRow,
  FinanceCategoryRow,
} from "@/types/finance";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const TYPE_GENITIVE: Record<FinanceCategoryRow["type"], string> = {
  income: "доходов",
  expense: "расходов",
};

/** Статьи видны в списке, форме операции и на дашборде — обновляем все три. */
function revalidateCategories() {
  revalidatePath("/finance/categories");
  revalidatePath("/finance/transactions");
  revalidatePath("/finance");
}

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

// ─── Mutations ───────────────────────────────────────────────────────────────

type CategoryGuardRow = {
  id: string;
  name: string;
  type: FinanceCategoryRow["type"];
  group_id: string | null;
  is_system: boolean;
  payroll_role_id: string | null;
  archived_at: string | null;
};

async function loadCategory(supabase: Supabase, id: string): Promise<CategoryGuardRow | null> {
  const { data } = await asLooseDb(supabase)
    .from<CategoryGuardRow>("finance_categories")
    .select("id, name, type, group_id, is_system, payroll_role_id, archived_at")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/**
 * Статья ФОТ должности (миграция 246) нужна выплатам зарплаты: выплата
 * ищет её по должности сотрудника. Пока должность работает, статью нельзя
 * переименовать, перенести в другую группу или убрать — иначе выплаты
 * упадут с «Проверьте статью ФОТ для должности».
 */
async function payrollRoleIsActive(supabase: Supabase, roleId: string): Promise<boolean> {
  const { data } = await asLooseDb(supabase)
    .from<{ archived_at: string | null }>("roles")
    .select("archived_at")
    .eq("id", roleId)
    .maybeSingle();
  // Должность не видна (нет прав) — считаем рабочей: так безопаснее.
  return !data || data.archived_at === null;
}

/** Такое же название среди живых статей того же типа — подсказываем заранее. */
async function findDuplicate(
  supabase: Supabase,
  name: string,
  type: FinanceCategoryRow["type"],
  exceptId?: string,
): Promise<string | null> {
  const { data } = await asLooseDb(supabase)
    .from<Array<{ id: string; name: string }>>("finance_categories")
    .select("id, name")
    .eq("type", type)
    .is("archived_at", null)
    .ilike("name", name.replace(/[\\%_]/g, (c) => `\\${c}`));
  const match = (data ?? []).find((row) => row.id !== exceptId);
  return match ? match.name : null;
}

/** Группа подходит статье: у группы без типа или «любой» — любые статьи. */
async function groupMismatch(
  supabase: Supabase,
  groupId: string | null | undefined,
  type: FinanceCategoryRow["type"],
): Promise<string | null> {
  if (!groupId) return null;
  const { data } = await asLooseDb(supabase)
    .from<{ type: string | null; is_payroll: boolean }>("finance_category_groups")
    .select("type, is_payroll")
    .eq("id", groupId)
    .maybeSingle();
  if (!data) return "Группа не найдена";
  if (data.is_payroll) return "В группу «Фонд оплаты труда» статьи попадают сами, из должностей";
  if (data.type && data.type !== "mixed" && data.type !== type) {
    return `Эта группа для статей ${TYPE_GENITIVE[data.type as FinanceCategoryRow["type"]] ?? ""}`.trim();
  }
  return null;
}

export async function createFinanceCategory(
  input: FinanceCategoryFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const name = input.name.trim();
  if (!name) return { id: null, error: "Укажите название статьи" };

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }

  const duplicate = await findDuplicate(supabase, name, input.type);
  if (duplicate) {
    return { id: null, error: `Статья «${duplicate}» уже есть среди ${TYPE_GENITIVE[input.type]}` };
  }
  const mismatch = await groupMismatch(supabase, input.group_id, input.type);
  if (mismatch) return { id: null, error: mismatch };

  const { data, error } = await supabase
    .from("finance_categories")
    .insert({
      account_id:   accountId as unknown as string,
      created_by:   user.id,
      name,
      type:         input.type,
      description:  input.description?.trim() || null,
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

  revalidateCategories();
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

  const row = await loadCategory(supabase, id);
  if (!row) return { error: "Статья не найдена" };

  const next: Partial<FinanceCategoryFormInput> = { ...patch };
  if (next.name !== undefined) next.name = next.name.trim();
  if (next.description !== undefined) next.description = next.description?.trim() || null;

  // Тип статьи не меняется: старые операции остались бы в чужом разделе.
  if (next.type !== undefined && next.type !== row.type) {
    return { error: "Тип статьи изменить нельзя. Создайте новую статью нужного типа" };
  }
  delete next.type;

  const renamed = next.name !== undefined && next.name !== row.name;
  const regrouped = next.group_id !== undefined && (next.group_id ?? null) !== row.group_id;

  if (row.is_system && renamed) {
    return { error: "Системную статью нельзя переименовать" };
  }
  if (row.payroll_role_id && (renamed || regrouped)) {
    return {
      error: "Название и группу статьи ФОТ задаёт должность. Переименуйте должность в разделе «Должности»",
    };
  }
  if (renamed) {
    if (!next.name) return { error: "Укажите название статьи" };
    const duplicate = await findDuplicate(supabase, next.name, row.type, id);
    if (duplicate) {
      return { error: `Статья «${duplicate}» уже есть среди ${TYPE_GENITIVE[row.type]}` };
    }
  }
  if (regrouped) {
    const mismatch = await groupMismatch(supabase, next.group_id, row.type);
    if (mismatch) return { error: mismatch };
  }

  const { error } = await supabase
    .from("finance_categories")
    .update({
      ...next,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidateCategories();
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
  supabase: Supabase,
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

  const row = await loadCategory(supabase, id);
  if (!row) return { error: "Статья не найдена" };
  if (row.is_system) return { error: "Системную статью нельзя отправить в архив" };
  if (row.archived_at) return { error: null }; // идемпотентно
  if (row.payroll_role_id && (await payrollRoleIsActive(supabase, row.payroll_role_id))) {
    return {
      error: "По этой статье платят зарплату должности. Её можно убрать в архив после архива должности",
    };
  }

  if (opts.confirmName.trim() !== row.name.trim()) {
    return { error: "Введите название точно как у статьи" };
  }

  const { error } = await asLooseDb(supabase)
    .from("finance_categories")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user.id,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateCategories();
  return { error: null };
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

  const row = await loadCategory(supabase, id);
  if (!row) return { error: "Статья не найдена" };
  // Пока статья лежала в архиве, могли завести новую с тем же названием.
  const duplicate = await findDuplicate(supabase, row.name, row.type, id);
  if (duplicate) {
    return {
      error: `Среди ${TYPE_GENITIVE[row.type]} уже есть статья «${duplicate}». Переименуйте её, чтобы вернуть эту`,
    };
  }

  const { error } = await asLooseDb(supabase)
    .from("finance_categories")
    .update({
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateCategories();
  return { error: null };
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

  const row = await loadCategory(supabase, id);
  if (!row) return { error: "Статья не найдена" };
  if (row.is_system) return { error: "Системную статью нельзя удалить" };
  // Статью ФОТ база пересоздаёт только при переименовании должности:
  // удалённая статья оставила бы выплаты по должности без статьи.
  if (row.payroll_role_id) {
    return { error: "Статью ФОТ нельзя удалить навсегда. Она останется в архиве" };
  }

  // confirmName опционален для обратной совместимости со старыми вызовами
  if (opts?.confirmName !== undefined && opts.confirmName.trim() !== ownerCheck.name.trim()) {
    return { error: "Введите название точно как у статьи" };
  }

  const { error } = await supabase
    .from("finance_categories")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateCategories();
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

type GroupGuardRow = {
  id: string;
  account_id: string;
  name: string;
  type: string | null;
  is_payroll: boolean;
};

async function loadCategoryGroup(supabase: Supabase, id: string): Promise<GroupGuardRow | null> {
  const { data } = await asLooseDb(supabase)
    .from<GroupGuardRow>("finance_category_groups")
    .select("id, account_id, name, type, is_payroll")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

async function duplicateGroupName(
  supabase: Supabase,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const { data } = await asLooseDb(supabase)
    .from<Array<{ id: string }>>("finance_category_groups")
    .select("id")
    .ilike("name", name.replace(/[\\%_]/g, (c) => `\\${c}`));
  return (data ?? []).some((row) => row.id !== exceptId);
}

const GROUP_TYPE_LABEL: Record<string, string> = {
  income: "доходы",
  expense: "расходы",
  mixed: "любые",
};

export async function createFinanceCategoryGroup(
  input: FinanceCategoryGroupFormInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const name = input.name.trim();
  if (!name) return { id: null, error: "Укажите название группы" };

  const { data: accountId, error: accountErr } = await supabase.rpc(
    "get_active_account_id"
  );
  if (accountErr || !accountId) {
    return { id: null, error: "Не удалось определить активный аккаунт" };
  }
  if (await duplicateGroupName(supabase, name)) {
    return { id: null, error: `Группа «${name}» уже есть` };
  }

  const { data, error } = await supabase
    .from("finance_category_groups")
    .insert({
      account_id: accountId as unknown as string,
      name,
      type:       input.type ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { id: null, error: error?.message ?? "Не удалось создать группу" };
  }
  await writeAuditEvent({
    accountId: accountId as unknown as string,
    userId: user.id,
    actionCode: "finance.category_group.created",
    entityType: "finance_category_group",
    entityId: data.id,
    details: { name, type: input.type ?? null },
  });
  revalidateCategories();
  return { id: data.id, error: null };
}

export async function updateFinanceCategoryGroup(
  id: string,
  patch: Partial<FinanceCategoryGroupFormInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const group = await loadCategoryGroup(supabase, id);
  if (!group) return { error: "Группа не найдена" };

  const next: Partial<FinanceCategoryGroupFormInput> = { ...patch };
  if (next.name !== undefined) {
    next.name = next.name.trim();
    if (!next.name) return { error: "Укажите название группы" };
    if (next.name !== group.name && (await duplicateGroupName(supabase, next.name, id))) {
      return { error: `Группа «${next.name}» уже есть` };
    }
  }
  if (next.type !== undefined && (next.type ?? null) !== group.type) {
    if (group.is_payroll) return { error: "Группа «Фонд оплаты труда» только для расходов" };
    // Группа «только доходы» не может держать статьи расходов, и наоборот.
    if (next.type === "income" || next.type === "expense") {
      const other = next.type === "income" ? "expense" : "income";
      const { count } = await supabase
        .from("finance_categories")
        .select("id", { count: "exact", head: true })
        .eq("group_id", id)
        .eq("type", other);
      if ((count ?? 0) > 0) {
        return {
          error: `В группе есть статьи ${TYPE_GENITIVE[other]}. Перенесите их в другую группу или выберите «Любые»`,
        };
      }
    }
  }

  const { error } = await supabase
    .from("finance_category_groups")
    .update(next)
    .eq("id", id);
  if (error) return { error: error.message };

  const changes: Array<{ field: string; old: unknown; new: unknown }> = [];
  if (next.name !== undefined && next.name !== group.name) {
    changes.push({ field: "name", old: group.name, new: next.name });
  }
  if (next.type !== undefined && (next.type ?? null) !== group.type) {
    changes.push({
      field: "type",
      old: GROUP_TYPE_LABEL[group.type ?? "mixed"],
      new: GROUP_TYPE_LABEL[next.type ?? "mixed"],
    });
  }
  if (changes.length > 0) {
    await writeAuditEvent({
      accountId: group.account_id,
      userId: user.id,
      actionCode: "finance.category_group.updated",
      entityType: "finance_category_group",
      entityId: id,
      details: { name: next.name ?? group.name, changes },
    });
  }
  revalidateCategories();
  return { error: null };
}

/** Статьи группы не удаляются: они остаются без группы (FK ON DELETE SET NULL). */
export async function deleteFinanceCategoryGroup(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const group = await loadCategoryGroup(supabase, id);
  if (!group) return { error: "Группа не найдена" };
  if (group.is_payroll) {
    return { error: "Группу «Фонд оплаты труда» нельзя удалить: в неё попадают статьи должностей" };
  }

  const { error } = await supabase
    .from("finance_category_groups")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  await writeAuditEvent({
    accountId: group.account_id,
    userId: user.id,
    actionCode: "finance.category_group.deleted",
    entityType: "finance_category_group",
    entityId: id,
    details: { name: group.name },
  });
  revalidateCategories();
  return { error: null };
}
