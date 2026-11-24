"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, RotateCcw } from "lucide-react";
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
import { ProfileSection } from "@/components/shared/profile-section";
import { SaveBarScope } from "@/components/shared/save-bar";
import type { AuditEvent } from "@/lib/audit/list";
import type { CounterpartyActivity } from "@/lib/finance/activity";
import { restoreCounterparty, type CounterpartyArchiveImpact } from "@/lib/finance/counterparties";
import { formatDateCell } from "@/lib/format/date";
import { LEGAL_FORM_LABELS } from "@/lib/org/legal-entity-labels";
import type { CounterpartyRow } from "@/types/finance";
import { CounterpartyDangerZone } from "./counterparty-danger-zone";
import { CounterpartyDocuments, type CounterpartyDocument } from "./counterparty-documents";
import { CounterpartyOperations } from "./counterparty-operations";
import { CounterpartyRequisites } from "./counterparty-requisites";

export type CounterpartyOperation = {
  id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  description: string | null;
  categoryName: string | null;
  accountName: string | null;
};

type TabKey = "main" | "documents" | "operations" | "history" | "danger";

/**
 * Карточка контрагента (docs/design-system.md § «Entity detail page»):
 * шапка с плиткой, вкладки по центру колонки 720px, реквизиты правятся на
 * месте и сохраняются общей полосой.
 */
export function CounterpartyCard({
  row,
  groups,
  attachments,
  operations,
  activity,
  canManage,
  canUploadAttachments,
  canDeleteAttachments,
  canViewTransactions,
  canViewAudit,
  isOwner,
  canHardDelete,
  archiveImpact,
  dadataEnabled,
  initialAuditEvents,
  initialAuditHasMore,
  createdByName,
  updatedByName,
  period,
  today,
}: {
  row: CounterpartyRow;
  groups: { id: string; name: string }[];
  attachments: CounterpartyDocument[];
  operations: CounterpartyOperation[];
  /** `null` — нет права на операции или сбой подсчёта. */
  activity: CounterpartyActivity | null;
  canManage: boolean;
  canUploadAttachments: boolean;
  canDeleteAttachments: boolean;
  canViewTransactions: boolean;
  canViewAudit: boolean;
  /** Архив, возврат и удаление — только владелец аккаунта. */
  isOwner: boolean;
  canHardDelete: boolean;
  archiveImpact: CounterpartyArchiveImpact;
  dadataEnabled: boolean;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
  createdByName: string | null;
  updatedByName: string | null;
  /** Период вкладки «Операции» из адреса (`?period=`); null — всё время. */
  period: string | null;
  /** Сегодня (`ГГГГ-ММ-ДД`) с сервера: край листания периода. */
  today: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("main");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, startRestore] = useTransition();

  const archived = Boolean(row.deleted_at);
  const readOnly = !canManage || archived;
  const lockMessage = archived
    ? "Контрагент в архиве. Верните его, чтобы менять данные"
    : !canManage
      ? "Менять данные могут те, кто управляет контрагентами"
      : null;
  const showDanger = isOwner && !archived;
  const groupName = row.group_id ? groups.find((group) => group.id === row.group_id)?.name ?? null : null;

  const context = [
    LEGAL_FORM_LABELS[row.legal_form],
    row.inn ? `ИНН ${row.inn}` : null,
    groupName,
  ]
    .filter(Boolean)
    .join(" · ");

  const restore = () => {
    setRestoreError(null);
    startRestore(async () => {
      const { error } = await restoreCounterparty(row.id);
      if (error) {
        setRestoreError(error);
        return;
      }
      setRestoreOpen(false);
      toast.success(`Контрагент «${row.name}» возвращён из архива`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumbs
        items={[
          { label: "Финансы" },
          { label: "Контрагенты", href: "/finance/counterparties" },
          { label: row.name },
        ]}
      />
      <PageHeaderActions>
        <EntityInfoPopover
          title="О контрагенте"
          id={row.id}
          createdLabel="Добавлен"
          updatedLabel="Изменён"
          createdAt={row.created_at}
          createdByName={createdByName}
          updatedAt={row.updated_at}
          updatedByName={updatedByName}
          extraRows={[
            {
              label: "Сверка с ЕГРЮЛ",
              value: formatDateCell(row.dadata_synced_at),
            },
          ]}
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <SaveBarScope>
          <ProfileHeader
            name={row.name}
            wrapName
            avatar={
              <div
                aria-hidden
                className="flex size-14 items-center justify-center rounded-[14px] bg-muted text-muted-foreground"
              >
                <Building2 className="size-7" />
              </div>
            }
            actions={
              archived && isOwner ? (
                <Button variant="outline" className="gap-2" onClick={() => setRestoreOpen(true)}>
                  <RotateCcw className="size-4" />
                  Вернуть из архива
                </Button>
              ) : undefined
            }
          >
            {context ? <span className="text-sm text-muted-foreground">{context}</span> : null}
            {archived ? <StatusBadge tone="neutral">В архиве</StatusBadge> : null}
          </ProfileHeader>

          <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
            <ProfileTabsList>
              <TabsTrigger value="main">Данные</TabsTrigger>
              <TabsTrigger value="documents">
                {attachments.length > 0 ? `Документы · ${attachments.length}` : "Документы"}
              </TabsTrigger>
              {canViewTransactions && <TabsTrigger value="operations">Операции</TabsTrigger>}
              {canViewAudit && <TabsTrigger value="history">Журнал</TabsTrigger>}
              {showDanger && <TabsTrigger value="danger">Опасная зона</TabsTrigger>}
            </ProfileTabsList>

            {/* Смонтирована всегда: правка не теряется при переходе на другую
                вкладку, полоса сохранения видна везде. */}
            <TabsContent value="main" forceMount className="flex flex-col gap-5 data-[state=inactive]:hidden">
              {archived ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Контрагент в архиве и не предлагается в новых операциях. История операций и документы сохранены
                </div>
              ) : null}
              <CounterpartyRequisites
                key={`${row.updated_at ?? ""}|${row.dadata_synced_at ?? ""}`}
                row={row}
                groups={groups}
                readOnly={readOnly}
                lockMessage={lockMessage}
                dadataEnabled={dadataEnabled}
              />
            </TabsContent>

            <TabsContent value="documents">
              <ProfileSection
                title="Документы"
                description="Договоры, акты, счета, банковская карточка и другие файлы контрагента"
                locked={readOnly && lockMessage ? { tone: "locked", message: lockMessage } : undefined}
              >
                <CounterpartyDocuments
                  counterpartyId={row.id}
                  documents={attachments}
                  readOnly={readOnly}
                  canUpload={canUploadAttachments}
                  canDelete={canDeleteAttachments}
                />
              </ProfileSection>
            </TabsContent>

            {canViewTransactions && (
              <TabsContent value="operations">
                <CounterpartyOperations
                  counterpartyId={row.id}
                  activity={activity}
                  operations={operations}
                  period={period}
                  today={today}
                />
              </TabsContent>
            )}

            {canViewAudit && (
              <TabsContent value="history">
                <EntityAuditTab
                  mode="entity"
                  entityType="counterparty"
                  entityId={row.id}
                  canView={canViewAudit}
                  initialEvents={initialAuditEvents}
                  initialHasMore={initialAuditHasMore}
                />
              </TabsContent>
            )}

            {showDanger && (
              <TabsContent value="danger">
                <CounterpartyDangerZone
                  counterpartyId={row.id}
                  counterpartyName={row.name}
                  impact={archiveImpact}
                  canHardDelete={canHardDelete}
                />
              </TabsContent>
            )}
          </Tabs>
        </SaveBarScope>
      </ProfilePageFrame>

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={(open) => {
          setRestoreOpen(open);
          if (!open) setRestoreError(null);
        }}
        title={`Вернуть контрагента «${row.name}» из архива?`}
        description="Контрагент снова появится в списке и в выборе при новых операциях"
        confirmLabel="Вернуть контрагента"
        pendingLabel="Возвращаем…"
        busy={restoring}
        error={restoreError}
        onConfirm={restore}
      />
    </div>
  );
}
