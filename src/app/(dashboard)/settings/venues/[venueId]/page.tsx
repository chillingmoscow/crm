import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VenueDetailPage } from "./_components/venue-detail-page";
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

  if (!account) redirect("/settings/venues");

  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, type, address, phone, currency, timezone, working_hours, comment")
    .eq("id", venueId)
    .eq("account_id", account.id)
    .returns<VenueDetail[]>()
    .maybeSingle();

  if (!venue) redirect("/settings/venues");

  const importedVenueResult = (await db
    .from("external_entity_links")
    .select("id")
    .eq("account_id", account.id)
    .eq("provider", "quickresto")
    .eq("entity_type", "venue")
    .eq("local_id", venueId)
    .maybeSingle()) as unknown as { data: { id: string } | null };

  return <VenueDetailPage venue={venue} importedFromQuickResto={Boolean(importedVenueResult.data?.id)} />;
}
