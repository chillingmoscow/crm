import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VenueDetailPage } from "./_components/venue-detail-page";
import { listLegalEntities } from "@/lib/org/legal-entities";
import { listAuditEvents } from "@/lib/audit/list";
import type { WorkingHours } from "@/types/database";

type VenueDetail = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  working_hours: WorkingHours | null;
  comment: string | null;
  default_legal_entity_id: string | null;
};

export default async function VenueDetailServerPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  const supabase = await createClient();
  type LooseQueryBuilder = {
    select: (columns: string) => LooseQueryBuilder;
    eq: (column: string, value: unknown) => LooseQueryBuilder;
    maybeSingle: () => Promise<{ data: unknown }>;
  };
  const db = supabase as unknown as { from: (table: string) => LooseQueryBuilder };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only account owner can manage venues
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!account) redirect("/org/venues");

  const { data: venue } = await supabase
    .from("venues")
    .select(
      "id, name, type, address, phone, currency, timezone, working_hours, comment, default_legal_entity_id"
    )
    .eq("id", venueId)
    .eq("account_id", account.id)
    .returns<VenueDetail[]>()
    .maybeSingle();

  if (!venue) redirect("/org/venues");

  const importedVenueResult = (await db
    .from("external_entity_links")
    .select("id")
    .eq("account_id", account.id)
    .eq("provider", "quickresto")
    .eq("entity_type", "venue")
    .eq("local_id", venueId)
    .maybeSingle()) as unknown as { data: { id: string } | null };

  // Account legal entities for the picker. Fetched here so the client
  // component doesn't need to call a server action just to populate
  // a select.
  const { rows: legalEntities } = await listLegalEntities();

  // Журнал. Префетч первой страницы, если у юзера есть org.view_audit.
  const { data: canViewAudit } = await supabase.rpc("has_permission", {
    permission_code: "org.view_audit",
  });
  const auditResult = canViewAudit
    ? await listAuditEvents({ entityType: "venue", entityId: venueId })
    : { events: [], hasMore: false, error: null };

  return (
    <VenueDetailPage
      venue={venue}
      importedFromQuickResto={Boolean(importedVenueResult.data?.id)}
      legalEntities={legalEntities.map((le) => ({
        id: le.id,
        name: le.short_name ?? le.name,
        legal_form: le.legal_form,
      }))}
      canViewAudit={Boolean(canViewAudit)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
    />
  );
}
