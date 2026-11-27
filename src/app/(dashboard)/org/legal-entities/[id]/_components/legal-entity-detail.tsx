"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileBadge2, RotateCcw, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProfileTabsList, Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { EntityAuditTab } from "@/components/audit/entity-audit-tab";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { PageHeaderActions } from "@/components/shared/page-header-actions";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { ProfileHeader } from "@/components/shared/profile-header";
import { SaveBarScope } from "@/components/shared/save-bar";
import type { AuditEvent } from "@/lib/audit/list";
import {
  restoreLegalEntity,
  type AccountVenueRow,
  type LegalEntityArchiveImpact,
  type LegalEntityRow,
} from "@/lib/org/legal-entities";
import { legalFormLabel } from "@/lib/org/legal-entity-labels";
import { LegalEntityDangerZone } from "./legal-entity-danger-zone";
import { LegalEntityRequisites } from "./legal-entity-requisites";
import { LegalEntityVenues } from "./legal-entity-venues";

type TabKey = "main" | "venues" | "history" | "danger";

export function LegalEntityDetailClient({
  row,
  venues,
  legalEntityNames,
  canManage,
  canDelete,
  canManageVenues,
  isOwner,
  canViewAudit,
  archiveImpact,
  dadataEnabled,
  initialAuditEvents,
  initialAuditHasMore,
  createdByName,
  updatedByName,
}: {
  row: LegalEntityRow;
  venues: AccountVenueRow[];
  legalEntityNames: Record<string, string>;
  canManage: boolean;
  canDelete: boolean;
  canManageVenues: boolean;
  /** Архив, восстановление и удаление — только владелец аккаунта. */
  isOwner: boolean;
  canViewAudit: boolean;
  archiveImpact: LegalEntityArchiveImpact;
  dadataEnabled: boolean;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
  createdByName: string | null;
  updatedByName: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("main");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, startRestore] = useTransition();

  const isArchived = !!row.archived_at;
  const title = row.short_name?.trim() || row.name;
  const readOnly = !canManage || isArchived;
  const lockMessage = isArchived
    ? "Юрлицо в архиве. Восстановите его, чтобы менять реквизиты"
    : !canManage
      ? "Менять реквизиты могут те, кто управляет юрлицами"
      : null;
  const showDanger = isOwner && !isArchived;

  const context = [
    legalFormLabel(row.legal_form),
    row.inn ? `ИНН ${row.inn}` : null,
    row.kpp ? `КПП ${row.kpp}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const restore = () => {
    setRestoreError(null);
    startRestore(async () => {
      const { error } = await restoreLegalEntity(row.id);
      if (error) {
        setRestoreError(error);
        return;
      }
      setRestoreOpen(false);
      toast.success(`Юрлицо «${title}» восстановлено`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumbs
        items={[
          { label: "Организация" },
          { label: "Юридические лица", href: "/org/legal-entities" },
          { label: title },
        ]}
      />
      <PageHeaderActions>
        <EntityInfoPopover
          title="О юрлице"
          id={row.id}
          createdLabel="Создано"
          updatedLabel="Изменено"
          createdAt={row.created_at}
          createdByName={createdByName}
          updatedAt={row.updated_at}
          updatedByName={updatedByName}
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <SaveBarScope>
          <ProfileHeader
            name={title}
            wrapName
            avatar={
              <div
                aria-hidden
                className="flex size-14 items-center justify-center rounded-[14px] bg-muted text-muted-foreground"
              >
                <FileBadge2 className="size-7" />
              </div>
            }
            actions={
              isArchived && isOwner ? (
                <Button variant="outline" size="sm" onClick={() => setRestoreOpen(true)}>
                  <RotateCcw className="size-4" />
                  Восстановить
                </Button>
              ) : undefined
            }
          >
            {context ? <span className="text-sm text-muted-foreground">{context}</span> : null}
            {isArchived ? <StatusBadge tone="neutral">В архиве</StatusBadge> : null}
          </ProfileHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <ProfileTabsList>
              <TabsTrigger value="main">Реквизиты</TabsTrigger>
              <TabsTrigger value="venues">Заведения</TabsTrigger>
              {canViewAudit && <TabsTrigger value="history">Журнал</TabsTrigger>}
              {showDanger && <TabsTrigger value="danger">Опасная зона</TabsTrigger>}
            </ProfileTabsList>

            {/* Смонтирована всегда: правка реквизитов не теряется при
                переходе на другую вкладку, полоса сохранения видна везде. */}
            <TabsContent
              value="main"
              forceMount
              className="flex flex-col gap-5 data-[state=inactive]:hidden"
            >
              {isArchived ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Юрлицо в архиве и не предлагается в новых счетах, операциях и заведениях.
                  История по нему сохранена
                </div>
              ) : null}
              <LegalEntityRequisites
                key={`${row.updated_at ?? ""}|${row.dadata_synced_at ?? ""}`}
                row={row}
                readOnly={readOnly}
                lockMessage={lockMessage}
                dadataEnabled={dadataEnabled}
              />
            </TabsContent>

            <TabsContent value="venues">
              <LegalEntityVenues
                legalEntityId={row.id}
                venues={venues}
                legalEntityNames={legalEntityNames}
                canEdit={canManageVenues && !isArchived}
              />
            </TabsContent>

            {canViewAudit && (
              <TabsContent value="history">
                <EntityAuditTab
                  mode="entity"
                  entityType="legal_entity"
                  entityId={row.id}
                  canView={canViewAudit}
                  initialEvents={initialAuditEvents}
                  initialHasMore={initialAuditHasMore}
                />
              </TabsContent>
            )}

            {showDanger && (
              <TabsContent value="danger">
                <LegalEntityDangerZone
                  legalEntityId={row.id}
                  legalEntityName={row.name}
                  impact={archiveImpact}
                  canHardDelete={canDelete}
                />
              </TabsContent>
            )}
          </Tabs>
        </SaveBarScope>
      </ProfilePageFrame>

      <ConfirmDialog
        icon={ArchiveRestore}
        open={restoreOpen}
        onOpenChange={(open) => {
          setRestoreOpen(open);
          if (!open) setRestoreError(null);
        }}
        title={`Восстановить юрлицо «${title}»?`}
        description="Юрлицо снова появится в выборах при создании счетов, операций и заведений"
        confirmLabel="Восстановить юрлицо"
        pendingLabel="Восстанавливаем…"
        busy={restoring}
        error={restoreError}
        onConfirm={restore}
      />
    </div>
  );
}
