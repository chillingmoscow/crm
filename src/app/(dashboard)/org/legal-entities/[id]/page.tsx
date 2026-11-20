import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import {
  getLegalEntity,
  getLegalEntityArchiveImpact,
  listAccountVenues,
  listLegalEntities,
} from "@/lib/org/legal-entities";
import { isDadataConfigured } from "@/lib/dadata/client";
import { listAuditEvents } from "@/lib/audit/list";
import { LegalEntityDetailClient } from "./_components/legal-entity-detail";

export const metadata: Metadata = { title: "Юрлицо" };

type AuditProfile = { id: string; first_name: string | null; last_name: string | null };

export default async function LegalEntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, supabase] = await Promise.all([getCachedUser(), createClient()]);
  if (!user) redirect("/login");

  const can = await getCachedPermissionChecker();
  if (!can("org.view_legal_entities")) redirect("/dashboard");

  const { row, error } = await getLegalEntity(id);
  if (error || !row) redirect("/org/legal-entities");

  // Привязка заведений пишет venues.default_legal_entity_id — это
  // политика venues_update (org.manage_venues, миграция 034 §7.2), а не
  // права на юрлица. Бухгалтер с manage_legal_entities без manage_venues
  // получил бы ошибку RLS — кнопки ему не показываем.
  const canManage = Boolean(can("org.manage_legal_entities"));
  const canDelete = Boolean(can("org.delete_legal_entity"));
  const canManageVenues = Boolean(can("org.manage_venues"));
  const canViewAudit = Boolean(can("org.view_audit"));

  const activeAccountId = await getCachedActiveAccountId();
  const [{ rows: venues }, { rows: legalEntities }, archiveImpact, { data: isOwner }, auditResult] =
    await Promise.all([
      listAccountVenues({ liveOnly: true }),
      listLegalEntities(),
      getLegalEntityArchiveImpact(id),
      // Архив, восстановление и удаление проверяют владельца на сервере
      // (assertLegalEntityOwner) — гейтим ими же, а не canManage.
      activeAccountId
        ? supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
        : Promise.resolve({ data: false }),
      canViewAudit
        ? listAuditEvents({ entityType: "legal_entity", entityId: id })
        : Promise.resolve({ events: [], hasMore: false, error: null }),
    ]);

  // Кто создал и менял — для «О юрлице» в верхней панели. created_by /
  // updated_by есть в таблице, но не в LegalEntityRow.
  const audit = row as unknown as { created_by?: string | null; updated_by?: string | null };
  const auditIds = [audit.created_by, audit.updated_by].filter((v): v is string => !!v);
  const { data: profiles } = auditIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name").in("id", auditIds)
    : { data: [] as AuditProfile[] };
  const profileName = (uid: string | null | undefined) => {
    const p = (profiles as AuditProfile[] | null)?.find((x) => x.id === uid);
    if (!p) return null;
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    if (!first && !last) return null;
    return last ? `${first} ${last.charAt(0)}.`.trim() : first;
  };

  const legalEntityNames: Record<string, string> = {};
  for (const le of legalEntities) legalEntityNames[le.id] = le.short_name ?? le.name;

  return (
    <LegalEntityDetailClient
      row={row}
      venues={venues}
      legalEntityNames={legalEntityNames}
      canManage={canManage}
      canDelete={canDelete}
      canManageVenues={canManageVenues}
      isOwner={Boolean(isOwner)}
      canViewAudit={canViewAudit}
      archiveImpact={archiveImpact}
      dadataEnabled={isDadataConfigured()}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      createdByName={profileName(audit.created_by)}
      updatedByName={profileName(audit.updated_by)}
    />
  );
}
