import { notFound, redirect } from "next/navigation";

import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import { listAuditEvents } from "@/lib/audit/list";
import {
  getCachedActiveAccountId,
  getCachedPermissions,
  getCachedUser,
} from "@/lib/supabase/server";

import { getCachedInventoryDocumentBasics, getCachedVenueTimezone } from "../layout";

/**
 * Вкладка «Журнал» карточки акта — общий журнал событий (`EntityAuditTab`),
 * как у сотрудника, должности и кандидата: записи по дням, время под
 * записью, фильтр «Действие», «Показать события старее».
 *
 * События акта (назначения, пересчёт, исключения, пересорт, подведение
 * итогов) пишет writeInventoryAudit в audit_logs с entity_type
 * 'inventory_document'. Читать их без org.view_audit позволяет миграция 366 —
 * тем же правом inventory.view_results, что открывает эту вкладку.
 */
export default async function InventoryDocumentHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [user, accountId, permissions] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissions(),
  ]);
  const canViewResults = permissions.includes("inventory.view_results");
  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");
  // Журнал решений = часть итогов. Без права на итоги доступа нет (зеркало
  // гейта вкладки в document-act-header.tsx). Layout уже проверил доступ к
  // акту (canSeeAct + заведение).
  if (!canViewResults) redirect(`/documents/inventory/${id}`);

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  const [audit, timeZone] = await Promise.all([
    listAuditEvents({ entityType: "inventory_document", entityId: document.id }),
    document.venue_id ? getCachedVenueTimezone(document.venue_id) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[720px]">
      <EntityAuditTab
        mode="entity"
        entityType="inventory_document"
        entityId={document.id}
        canView={canViewResults}
        timeZone={timeZone ?? undefined}
        initialEvents={audit.events}
        initialHasMore={audit.hasMore}
      />
    </div>
  );
}
