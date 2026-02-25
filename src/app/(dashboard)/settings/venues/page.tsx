import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VenuesClient } from "./_components/venues-client";
import type { WorkingHours } from "@/types/database";

export type VenueRow = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  working_hours: WorkingHours | null;
  halls_count: number;
  tables_count: number;
};

export default async function VenuesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!account) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Заведения</h1>
        <p className="text-muted-foreground mt-2">
          Управление заведениями доступно только владельцу аккаунта.
        </p>
      </div>
    );
  }

  const { data: venuesRaw } = await supabase
    .from("venues")
    .select("id, name, type, address, phone, currency, timezone, working_hours")
    .eq("account_id", account.id)
    .order("name");

  const rawList = venuesRaw ?? [];
  const venueIds = rawList.map((v) => v.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const hallCountMap: Record<string, number> = {};
  const tableCountMap: Record<string, number> = {};

  if (venueIds.length > 0) {
    const { data: hallsData } = await db
      .from("venue_halls")
      .select("id, venue_id")
      .in("venue_id", venueIds);

    const halls = (hallsData ?? []) as { id: string; venue_id: string }[];
    halls.forEach((h) => {
      hallCountMap[h.venue_id] = (hallCountMap[h.venue_id] ?? 0) + 1;
    });

    const hallIds = halls.map((h) => h.id);
    if (hallIds.length > 0) {
      const { data: layoutsData } = await db
        .from("hall_layouts")
        .select("hall_id, objects")
        .in("hall_id", hallIds);

      const hallVenueMap: Record<string, string> = {};
      halls.forEach((h) => { hallVenueMap[h.id] = h.venue_id; });

      (layoutsData ?? []).forEach((layout: { hall_id: string; objects: unknown }) => {
        const venueId = hallVenueMap[layout.hall_id];
        if (!venueId) return;
        const objects = Array.isArray(layout.objects) ? layout.objects : [];
        const tableCount = (objects as { kind?: string }[]).filter((o) => o.kind === "table").length;
        tableCountMap[venueId] = (tableCountMap[venueId] ?? 0) + tableCount;
      });
    }
  }

  const venues: VenueRow[] = rawList.map((v) => ({
    ...v,
    working_hours: (v.working_hours as WorkingHours | null) ?? null,
    halls_count: hallCountMap[v.id] ?? 0,
    tables_count: tableCountMap[v.id] ?? 0,
  }));

  return <VenuesClient venues={venues} />;
}
