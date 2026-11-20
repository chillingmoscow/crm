import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { listAccountVenues, listLegalEntities } from "@/lib/org/legal-entities";
import { isDadataConfigured } from "@/lib/dadata/client";
import {
  LegalEntitiesClient,
  type LegalEntityListRow,
} from "./_components/legal-entities-client";

export const metadata: Metadata = { title: "Юридические лица" };

export default async function LegalEntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  // Список видят все с org.view_legal_entities; правку режет RLS
  // (org.manage_legal_entities), архив и удаление — только владелец.
  const can = await getCachedPermissionChecker();
  if (!can("org.view_legal_entities")) redirect("/dashboard");
  const canManage = Boolean(can("org.manage_legal_entities"));

  const activeAccountId = await getCachedActiveAccountId();
  const [{ rows }, { rows: venues }, { data: isOwner }, { create }] =
    await Promise.all([
      listLegalEntities(),
      listAccountVenues({ liveOnly: true }),
      activeAccountId
        ? supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
        : Promise.resolve({ data: false }),
      searchParams,
    ]);

  // Архив видит только владелец (RLS legal_entities_select_archived_owner,
  // миграция 200). Число архивных — в подсказке кнопки архива.
  let archivedCount = 0;
  if (isOwner && activeAccountId) {
    const { count } = await asLooseDb(supabase)
      .from("legal_entities")
      .select("id", { count: "exact", head: true })
      .eq("account_id", activeAccountId)
      .not("archived_at", "is", null);
    archivedCount = count ?? 0;
  }

  const venuesByEntity = new Map<string, string[]>();
  for (const venue of venues) {
    if (!venue.default_legal_entity_id) continue;
    const list = venuesByEntity.get(venue.default_legal_entity_id) ?? [];
    list.push(venue.name);
    venuesByEntity.set(venue.default_legal_entity_id, list);
  }

  const list: LegalEntityListRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    short_name: row.short_name,
    legal_form: row.legal_form,
    inn: row.inn,
    kpp: row.kpp,
    tax_system: row.tax_system,
    vat_payer: row.vat_payer,
    venues: venuesByEntity.get(row.id) ?? [],
  }));

  return (
    <LegalEntitiesClient
      rows={list}
      canManage={canManage}
      isOwner={Boolean(isOwner)}
      archivedCount={archivedCount}
      dadataEnabled={isDadataConfigured()}
      openCreate={create === "1" && canManage}
    />
  );
}
