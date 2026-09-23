import { redirect } from "next/navigation";

import { getCachedPermissionChecker } from "@/lib/supabase/server";
import {
  listFinanceCategories,
  listFinanceCategoryGroups,
} from "@/lib/finance/categories";
import { CategoriesClient } from "./_components/categories-client";

export default async function FinanceCategoriesPage() {
  // Resolve both permission checks before listing — the inactive-rows
  // payload must be gated on canManage so view-only users never receive
  // hidden categories in the wire response (UI hiding alone leaks data
  // via the network tab / serialised RSC payload).
  const can = await getCachedPermissionChecker();
  const canView = can("finance.view_categories");
  const canManage = can("finance.manage_categories");
  if (!canView) redirect("/dashboard");

  // Подгружаем все строки (включая архивные если canManage), чтобы
  // посчитать archivedCount; live-список фильтрует в клиенте.
  const [{ rows: categories }, { rows: groups }] = await Promise.all([
    listFinanceCategories({ include_archived: !!canManage }),
    listFinanceCategoryGroups(),
  ]);

  const archivedCount = categories.filter((c) => c.archived_at).length;

  return (
    <CategoriesClient
      categories={categories}
      groups={groups}
      canManage={!!canManage}
      archivedCount={archivedCount}
    />
  );
}
