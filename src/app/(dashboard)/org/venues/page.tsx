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
import { VenuesClient } from "./_components/venues-client";
import type { WorkingHours } from "@/types/database";

export const metadata: Metadata = { title: "Заведения" };

export type VenueRow = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  working_hours: WorkingHours | null;
  /** Название юрлица по умолчанию; null — не выбрано или нет права видеть юрлица. */
  legal_entity_name: string | null;
  imported_from_quickresto: boolean;
};

type RawVenue = Omit<VenueRow, "legal_entity_name" | "imported_from_quickresto"> & {
  default_legal_entity_id: string | null;
};

export default async function VenuesPage() {
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  // Список — по праву «Видеть заведения», как и пункт меню. RLS venues_select
  // отдаёт владельцу все заведения аккаунта, остальным — те, где у них
  // есть активная роль. Правка — org.manage_venues (venues_update),
  // создание, архив и удаление — только владелец (venues_insert/_delete).
  const can = await getCachedPermissionChecker();
  if (!can("org.view_venues")) redirect("/dashboard");

  const accountId = await getCachedActiveAccountId();
  if (!accountId) redirect("/dashboard");

  const db = asLooseDb(supabase);
  const [{ data: isOwner }, { data: venuesRaw }, { rows: legalEntities }, { data: links }] =
    await Promise.all([
      supabase.rpc("is_account_owner", { p_account_id: accountId }),
      db
        .from<RawVenue[]>("venues")
        .select(
          "id, name, type, address, phone, currency, timezone, working_hours, default_legal_entity_id",
        )
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("name"),
      can("org.view_legal_entities") ? listLegalEntities() : Promise.resolve({ rows: [] }),
      db
        .from<{ local_id: string }[]>("external_entity_links")
        .select("local_id")
        .eq("account_id", accountId)
        .eq("provider", "quickresto")
        .eq("entity_type", "venue"),
    ]);

  let archivedCount = 0;
  if (isOwner) {
    const { count } = await db
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .not("archived_at", "is", null);
    archivedCount = count ?? 0;
  }

  const legalEntityNames = new Map(legalEntities.map((le) => [le.id, le.short_name ?? le.name]));
  const imported = new Set((links ?? []).map((l) => l.local_id));
  const venues: VenueRow[] = (venuesRaw ?? []).map(({ default_legal_entity_id, ...v }) => ({
    ...v,
    legal_entity_name: default_legal_entity_id
      ? legalEntityNames.get(default_legal_entity_id) ?? null
      : null,
    imported_from_quickresto: imported.has(v.id),
  }));

  return (
    <VenuesClient
      venues={venues}
      archivedCount={archivedCount}
      canCreate={Boolean(isOwner)}
    />
  );
}
