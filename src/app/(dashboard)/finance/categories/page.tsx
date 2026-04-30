import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  listFinanceCategories,
  listFinanceCategoryGroups,
} from "@/lib/finance/categories";
import { CategoriesClient } from "./_components/categories-client";

export default async function FinanceCategoriesPage() {
  const supabase = await createClient();

  // Resolve both permission checks before listing — the inactive-rows
  // payload must be gated on canManage so view-only users never receive
  // hidden categories in the wire response (UI hiding alone leaks data
  // via the network tab / serialised RSC payload).
  const [{ data: canView }, { data: canManage }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_categories" }),
    supabase.rpc("has_permission", { permission_code: "finance.manage_categories" }),
  ]);
  if (!canView) redirect("/dashboard");

  const [{ rows: categories }, { rows: groups }] = await Promise.all([
    listFinanceCategories({ include_inactive: !!canManage }),
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
