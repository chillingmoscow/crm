import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCachedPermissionChecker, getCachedUser } from "@/lib/supabase/server";
import { unwrapAction } from "@/lib/actions/result";
import { loadAdditional } from "../actions";
import { SalesNoAccess } from "../../_components/sales-no-access";
import { UpsellRulesClient } from "./upsell-rules-client";

export const metadata: Metadata = { title: "Правила допродаж" };

/** Правила допродаж по подразделениям: ставка за проданную позицию. */
export default async function UpsellRulesPage() {
  if (!(await getCachedUser())) redirect("/login");
  const can = await getCachedPermissionChecker();
  if (!can("sales.view_shifts") || !can("sales.configure_shifts"))
    return <SalesNoAccess page="Правила допродаж" />;
  const data = unwrapAction(await loadAdditional());
  return <UpsellRulesClient key={data.venueId} initial={data} />;
}
