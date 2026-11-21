import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";
import {
  listArchivedRuleVenueIds,
  listPostingRules,
  loadPostingRuleDirectories,
} from "@/lib/finance/posting-rules/server";
import { RulesPage } from "./_components/rules-page";

export const metadata: Metadata = { title: "Правила" };

export default async function FinanceRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ rule?: string }>;
}) {
  const [can, params] = await Promise.all([getCachedPermissionChecker(), searchParams]);
  const canManage = Boolean(can("finance.manage_posting_rules"));
  if (!can("finance.view_transactions") && !canManage) redirect("/dashboard");

  // Без права на все заведения названия чужих заведений не показываем:
  // во фразе правила они станут «другим заведением».
  const viewAllVenues = Boolean(can("finance.view_all_venues"));
  const supabase = await createClient();
  const [rules, directories, activeVenue] = await Promise.all([
    listPostingRules(),
    loadPostingRuleDirectories(),
    viewAllVenues ? Promise.resolve({ data: null }) : supabase.rpc("get_active_venue_id"),
  ]);
  const archivedIds = await listArchivedRuleVenueIds(rules);
  const activeVenueId = (activeVenue.data as string | null) ?? null;
  const allowedVenueIds = viewAllVenues ? null : activeVenueId ? [activeVenueId] : [];

  const ruleParam = typeof params.rule === "string" && /^[0-9a-f-]{36}$/i.test(params.rule) ? params.rule : null;

  return (
    <RulesPage
      rules={rules}
      directories={{ ...directories, archivedIds }}
      allowedVenueIds={allowedVenueIds}
      canManage={canManage}
      initialRuleId={ruleParam}
    />
  );
}
