"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, RotateCcw, ArchiveRestore } from "lucide-react";
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
import { venueTypeLabel } from "@/lib/org/venue-labels";
import type { WorkingHours } from "@/types/database";
import { PayrollSettings } from "@/app/(dashboard)/people/payroll/_components/payroll-settings";
import { restoreVenue, type VenueArchiveImpact } from "../../actions";
import { RecountThresholdsSection } from "./recount-thresholds-section";
import { StockSettingsTab } from "./stock-settings-tab";
import { VenueDangerZone } from "./venue-danger-zone";
import { VenueMainSections } from "./venue-main-sections";

export type VenueDetail = {
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
  inventory_recount_threshold_sum: number | null;
  inventory_recount_threshold_percent: number | null;
  archived_at: string | null;
  created_at: string;
};

/** Вкладки, на которые можно сослаться через `?tab=`. */
export type VenueTab = "main" | "payroll" | "inventory" | "audit";
type TabKey = VenueTab | "danger";

export function VenueDetailPage({
  venue,
  initialTab,
  importedFromQuickResto,
  legalEntities,
  canManage,
  isOwner,
  canHardDelete,
  canViewAudit,
  canViewStockRules,
  canConfigurePayroll,
  archiveImpact,
  initialAuditEvents,
  initialAuditHasMore,
}: {
  venue: VenueDetail;
  initialTab?: VenueTab;
  importedFromQuickResto: boolean;
  legalEntities: { id: string; name: string }[];
  /** Право правки заведения (org.manage_venues). */
  canManage: boolean;
  /** Архив, восстановление и удаление — только владелец аккаунта. */
  isOwner: boolean;
  canHardDelete: boolean;
  canViewAudit: boolean;
  canViewStockRules: boolean;
  /** «Оплата труда» — по праву настройки зарплаты, а не продаж. */
  canConfigurePayroll: boolean;
  archiveImpact: VenueArchiveImpact;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
}) {
  const router = useRouter();
  const isArchived = !!venue.archived_at;
  const available: Record<TabKey, boolean> = {
    main: true,
    payroll: canConfigurePayroll && !isArchived,
    inventory: canViewStockRules && !isArchived,
    audit: canViewAudit,
    danger: isOwner && !isArchived,
  };
  const [tab, setTab] = useState<TabKey>(
    initialTab && available[initialTab] ? initialTab : "main",
  );
  // Вкладки с правкой на месте после первого открытия остаются
  // смонтированными: несохранённые правки не пропадают при переключении,
  // а полоса сохранения видна на любой вкладке (DS «SaveBar»).
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set([tab]));
  const openTab = (next: TabKey) => {
    setTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, startRestore] = useTransition();

  const readOnly = !canManage || isArchived;
  const lockMessage = isArchived
    ? "Заведение в архиве. Восстановите его, чтобы менять настройки"
    : !canManage
      ? "Менять заведение могут те, кто управляет заведениями"
      : null;

  const context = [venueTypeLabel(venue.type), venue.address].filter(Boolean).join(" · ");

  const restore = () => {
    setRestoreError(null);
    startRestore(async () => {
      const { error } = await restoreVenue(venue.id);
      if (error) {
        setRestoreError(error);
        return;
      }
      setRestoreOpen(false);
      toast.success(`Заведение «${venue.name}» восстановлено`);
      router.refresh();
    });
  };

  const kept = (key: TabKey) => visited.has(key);

  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumbs
        items={[
          { label: "Организация" },
          { label: "Заведения", href: "/org/venues" },
          { label: venue.name },
        ]}
      />
      <PageHeaderActions>
        <EntityInfoPopover
          title="О заведении"
          id={venue.id}
          createdLabel="Создано"
          createdAt={venue.created_at}
          createdByName={null}
          updatedAt={null}
          updatedByName={null}
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <SaveBarScope>
          <ProfileHeader
            name={venue.name}
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
            {importedFromQuickResto ? (
              <StatusBadge tone="neutral" tip="Заведение пришло из Quick Resto">
                Quick Resto
              </StatusBadge>
            ) : null}
          </ProfileHeader>

          <Tabs value={tab} onValueChange={(v) => openTab(v as TabKey)}>
            <ProfileTabsList>
              <TabsTrigger value="main">Основное</TabsTrigger>
              {available.payroll && <TabsTrigger value="payroll">Оплата труда</TabsTrigger>}
              {available.inventory && <TabsTrigger value="inventory">Инвентаризация</TabsTrigger>}
              {available.audit && <TabsTrigger value="audit">Журнал</TabsTrigger>}
              {available.danger && <TabsTrigger value="danger">Опасная зона</TabsTrigger>}
            </ProfileTabsList>

            <TabsContent
              value="main"
              forceMount
              className="flex flex-col gap-5 data-[state=inactive]:hidden"
            >
              {isArchived ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Заведение в архиве: его нет в списках и переключателе заведений.
                  Документы, операции и склады сохранены
                </div>
              ) : null}
              <VenueMainSections
                key={JSON.stringify([
                  venue.name,
                  venue.type,
                  venue.address,
                  venue.phone,
                  venue.comment,
                  venue.currency,
                  venue.timezone,
                  venue.default_legal_entity_id,
                  venue.working_hours,
                ])}
                venue={venue}
                legalEntities={legalEntities}
                readOnly={readOnly}
                lockMessage={lockMessage}
              />
            </TabsContent>

            {available.payroll && kept("payroll") && (
              <TabsContent
                value="payroll"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <PayrollSettings venueId={venue.id} />
              </TabsContent>
            )}

            {available.inventory && kept("inventory") && (
              <TabsContent
                value="inventory"
                forceMount
                className="flex flex-col gap-5 data-[state=inactive]:hidden"
              >
                <RecountThresholdsSection
                  key={`${venue.inventory_recount_threshold_sum}|${venue.inventory_recount_threshold_percent}`}
                  venueId={venue.id}
                  initialSum={venue.inventory_recount_threshold_sum}
                  initialPercent={venue.inventory_recount_threshold_percent}
                  canEdit={!readOnly}
                  currency={venue.currency}
                />
                <StockSettingsTab key={venue.id} venueId={venue.id} />
              </TabsContent>
            )}

            {available.audit && (
              <TabsContent value="audit">
                <EntityAuditTab
                  mode="entity"
                  entityType="venue"
                  entityId={venue.id}
                  canView={canViewAudit}
                  initialEvents={initialAuditEvents}
                  initialHasMore={initialAuditHasMore}
                />
              </TabsContent>
            )}

            {available.danger && (
              <TabsContent value="danger">
                <VenueDangerZone
                  venueId={venue.id}
                  venueName={venue.name}
                  impact={archiveImpact}
                  canHardDelete={canHardDelete}
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
        title={`Восстановить заведение «${venue.name}»?`}
        description="Заведение вернётся в списки и переключатель, сотрудники снова смогут в него переключиться"
        confirmLabel="Восстановить заведение"
        pendingLabel="Восстанавливаем…"
        busy={restoring}
        error={restoreError}
        onConfirm={restore}
      />
    </div>
  );
}
