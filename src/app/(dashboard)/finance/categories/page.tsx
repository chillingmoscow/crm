import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  listFinanceCategories,
  listFinanceCategoryGroups,
} from "@/lib/finance/categories";
import { CategoriesClient } from "./_components/categories-client";

export default async function FinanceCategoriesPage() {
  const supabase = await createClient();

  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "finance.view_categories",
  });
  if (!canView) redirect("/dashboard");

  const [{ data: canManage }, { rows: categories }, { rows: groups }] =
    await Promise.all([
      supabase.rpc("has_permission", { permission_code: "finance.manage_categories" }),
      // Show all rows (including deactivated) so manage users can restore them.
      // The client filters by is_active for the default view.
      listFinanceCategories({ include_inactive: true }),
      listFinanceCategoryGroups(),
    ]);

  return (
    <CategoriesClient
      categories={categories}
      groups={groups}
      canManage={!!canManage}
    />
  );
}
