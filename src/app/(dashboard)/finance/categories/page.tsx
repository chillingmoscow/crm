import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import {
  listFinanceCategories,
  listFinanceCategoryGroups,
} from "@/lib/finance/categories";
import { loadCategoryActivity } from "@/lib/finance/activity";
import { asLooseDb } from "@/lib/supabase/loose";
import { CategoriesClient } from "./_components/categories-client";
import type { TreeCategory, TreeGroup } from "./_components/category-tree";

export const metadata: Metadata = { title: "Статьи" };

export default async function FinanceCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string; create?: string }>;
}) {
  const [can, activeAccountId, supabase, params] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
    createClient(),
    searchParams,
  ]);
  if (!can("finance.view_categories")) redirect("/dashboard");
  const canManage = Boolean(can("finance.manage_categories"));
  const canViewTransactions = Boolean(can("finance.view_transactions"));

  // Архив, возврат и удаление проверяют владельца на сервере — им же и
  // гейтим. Архивные строки RLS отдаёт только владельцу
  // (finance_categories_select_archived_owner).
  const { data: isOwner } = activeAccountId
    ? await supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
    : { data: false };

  const [{ rows: categories }, { rows: groups }, activity] = await Promise.all([
    listFinanceCategories({ include_archived: Boolean(isOwner) }),
    listFinanceCategoryGroups(),
    // Активность — по видимым пользователю операциям; без права на них не считаем.
    canViewTransactions ? loadCategoryActivity() : Promise.resolve(null),
  ]);

  // Статья ФОТ работающей должности нужна выплатам зарплаты: её не убираем
  // в архив, пока должность не в архиве (сервер проверяет то же самое).
  const payrollRoleIds = categories
    .map((category) => category.payroll_role_id)
    .filter((id): id is string => Boolean(id));
  const archivedRoleIds = new Set<string>();
  if (payrollRoleIds.length > 0) {
    const { data: roles } = await asLooseDb(supabase)
      .from<Array<{ id: string; archived_at: string | null }>>("roles")
      .select("id, archived_at")
      .in("id", payrollRoleIds);
    for (const role of roles ?? []) if (role.archived_at) archivedRoleIds.add(role.id);
  }

  const treeGroups: TreeGroup[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    type: group.type,
    isPayroll: Boolean(group.is_payroll),
  }));
  const treeCategories: TreeCategory[] = categories.map((category) => {
    const stats = activity ? activity[category.id] : undefined;
    return {
      id: category.id,
      name: category.name,
      type: category.type,
      groupId: category.group_id,
      description: category.description,
      color: category.color,
      isSystem: category.is_system,
      isPayroll: Boolean(category.payroll_role_id),
      archived: Boolean(category.archived_at),
      archivedAt: category.archived_at,
      archiveBlocked: category.is_system
        ? "Системную статью нельзя отправить в архив"
        : category.payroll_role_id && !archivedRoleIds.has(category.payroll_role_id)
          ? "По этой статье платят зарплату должности. Её можно убрать в архив после архива должности"
          : null,
      // Нет строки в активности — по статье не было операций.
      operations: activity ? (stats?.operations ?? 0) : null,
      lastDate: stats?.lastDate ?? null,
      total: activity ? (stats?.total ?? 0) : null,
    };
  });

  return (
    <CategoriesClient
      groups={treeGroups}
      categories={treeCategories}
      canManage={canManage}
      isOwner={Boolean(isOwner)}
      canDelete={Boolean(isOwner) && Boolean(can("finance.delete_category"))}
      canViewTransactions={canViewTransactions}
      hasActivity={activity !== null}
      initialArchive={params.archive === "1" && Boolean(isOwner)}
      openCreate={params.create === "1" && canManage}
    />
  );
}
