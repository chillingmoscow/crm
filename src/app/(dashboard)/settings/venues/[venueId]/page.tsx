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

  return <VenueDetailPage venue={venue} />;
}
