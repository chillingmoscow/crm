import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { listLegalEntities } from "@/lib/org/legal-entities";
import { listAuditEvents } from "@/lib/audit/list";
import type { WorkingHours } from "@/types/database";
import { getVenueArchiveImpact } from "../actions";
import { VenueDetailPage, type VenueDetail, type VenueTab } from "./_components/venue-detail-page";

export const metadata: Metadata = { title: "Заведение" };

const TABS: VenueTab[] = ["main", "payroll", "inventory", "audit"];

export default async function VenueDetailServerPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ venueId }, { tab }] = await Promise.all([params, searchParams]);
  // Настройки продаж переехали в раздел «Продажи»; старые ссылки ведут туда.
  if (tab === "sales") redirect(`/sales/settings?venue=${encodeURIComponent(venueId)}`);
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  // Карточка открывается по тому же праву, что и список. RLS venues_select
  // пускает к своим заведениям; правка — org.manage_venues (venues_update),
  // архив и удаление — владелец (assertVenueOwner на сервере).
  const can = await getCachedPermissionChecker();
  if (!can("org.view_venues")) redirect("/dashboard");
  const accountId = await getCachedActiveAccountId();
  if (!accountId) redirect("/org/venues");

  const db = asLooseDb(supabase);
  const { data: venue } = await db
    .from<VenueDetail>("venues")
    .select(
      "id, name, type, address, phone, currency, timezone, working_hours, comment, default_legal_entity_id, inventory_recount_threshold_sum, inventory_recount_threshold_percent, archived_at, created_at",
    )
    .eq("id", venueId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!venue) redirect("/org/venues");

  const canViewAudit = Boolean(can("org.view_audit"));
  const canViewStockRules = Boolean(can("inventory.view_results"));
  const canConfigurePayroll = Boolean(can("payroll.configure"));

  const [{ data: isOwner }, { data: link }, { rows: legalEntities }, archiveImpact, auditResult] =
    await Promise.all([
      supabase.rpc("is_account_owner", { p_account_id: accountId }),
      db
        .from<{ id: string }>("external_entity_links")
        .select("id")
        .eq("account_id", accountId)
        .eq("provider", "quickresto")
        .eq("entity_type", "venue")
        .eq("local_id", venueId)
        .maybeSingle(),
      can("org.view_legal_entities") ? listLegalEntities() : Promise.resolve({ rows: [] }),
      getVenueArchiveImpact(venueId),
      canViewAudit
        ? listAuditEvents({ entityType: "venue", entityId: venueId })
        : Promise.resolve({ events: [], hasMore: false, error: null }),
    ]);

  const requested = TABS.find((t) => t === tab);

  return (
    <VenueDetailPage
      key={`${venueId}:${requested ?? "main"}`}
      venue={{ ...venue, working_hours: (venue.working_hours as WorkingHours | null) ?? null }}
      initialTab={requested}
      importedFromQuickResto={Boolean(link?.id)}
      legalEntities={legalEntities.map((le) => ({ id: le.id, name: le.short_name ?? le.name }))}
      canManage={Boolean(can("org.manage_venues"))}
      isOwner={Boolean(isOwner)}
      canHardDelete={Boolean(can("org.delete_venue"))}
      canViewAudit={canViewAudit}
      canViewStockRules={canViewStockRules}
      canConfigurePayroll={canConfigurePayroll}
      archiveImpact={archiveImpact}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
    />
  );
}
