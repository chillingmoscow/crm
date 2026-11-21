"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
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
import { SaveBarScope, SaveBarSection } from "@/components/shared/save-bar";
import type { AuditEvent } from "@/lib/audit/list";
import { formatMoney, signedAmountClass, type AmountRoundingScale } from "@/lib/format/amount";
import { formatDayMonth } from "@/lib/format/date";
import { BANK_ACCOUNT_TYPE_LABELS, bankAccountSubtitle, formatBalance } from "@/lib/finance/bank-account-labels";
import {
  bankAccountFormDirty,
  bankAccountFormFromRow,
  bankAccountPayload,
  validateBankAccountForm,
  type BankAccountFormErrors,
  type BankAccountFormState,
} from "@/lib/finance/bank-account-form";
import {
  restoreBankAccount,
  updateBankAccount,
  type BankAccountArchiveImpact,
} from "@/lib/finance/bank-accounts";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import type { BankAccountGroupRow, BankAccountRow } from "@/types/finance";
import {
  BankAccountFields,
  type BankAccountLegalEntityOption,
  type BankAccountVenueOption,
} from "../../_components/bank-account-form";
import { BankAccountIcon } from "../../_components/bank-account-icon";
import { BankAccountDangerZone } from "./bank-account-danger-zone";
import { BankAccountReconciliation } from "./bank-account-reconciliation";
import type { ReconciliationRecord } from "@/lib/finance/bank-reconciliation";

type TabKey = "main" | "history" | "danger";

export function BankAccountDetail({
  row,
  legalEntities,
  venues,
  groups,
  canManage,
  canViewTransactions,
  isOwner,
  canHardDelete,
  canViewAudit,
  archiveImpact,
  amountRoundingScale,
  initialAuditEvents,
  initialAuditHasMore,
  createdByName,
  updatedByName,
  reconciliations,
  reconciliationsError,
  timezone,
}: {
  row: BankAccountRow;
  legalEntities: BankAccountLegalEntityOption[];
  venues: BankAccountVenueOption[];
  groups: BankAccountGroupRow[];
  canManage: boolean;
  canViewTransactions: boolean;
  /** Архив, возврат и удаление — только владелец аккаунта. */
  isOwner: boolean;
  canHardDelete: boolean;
  canViewAudit: boolean;
  archiveImpact: BankAccountArchiveImpact;
  amountRoundingScale: AmountRoundingScale;
  initialAuditEvents: AuditEvent[];
  initialAuditHasMore: boolean;
  createdByName: string | null;
  updatedByName: string | null;
  reconciliations: ReconciliationRecord[];
  reconciliationsError: string | null;
  /** Пояс аккаунта: граница дня в сверке и «сегодня» по умолчанию. */
  timezone: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("main");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, startRestore] = useTransition();

  const isArchived = !!row.deleted_at;
  const showDanger = isOwner && !isArchived;
  const legalEntity = legalEntities.find((le) => le.id === row.legal_entity_id);
  const venue = row.venue_id ? venues.find((v) => v.id === row.venue_id) : null;
  const context = [
    BANK_ACCOUNT_TYPE_LABELS[row.type] ?? row.type,
    legalEntity ? legalEntity.short_name?.trim() || legalEntity.name : null,
    venue?.name ?? null,
    bankAccountSubtitle(row) || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const restore = () => {
    setRestoreError(null);
    startRestore(async () => {
      const { error } = await restoreBankAccount(row.id);
      if (error) {
        setRestoreError(error);
        return;
      }
      setRestoreOpen(false);
      toast.success(`Счёт «${row.name}» снова в работе`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumbs
        items={[
          { label: "Финансы" },
          { label: "Счета и кассы", href: "/finance/accounts" },
          { label: row.name },
        ]}
      />
      <PageHeaderActions>
        <EntityInfoPopover
          title="О счёте"
          id={row.id}
          createdLabel="Создан"
          updatedLabel="Изменён"
          createdAt={row.created_at}
          createdByName={createdByName}
          updatedAt={row.updated_at}
          updatedByName={updatedByName}
        />
      </PageHeaderActions>

      <ProfilePageFrame>
        <SaveBarScope>
          <ProfileHeader
            name={row.name}
            wrapName
            avatar={<BankAccountIcon type={row.type} size="header" />}
            actions={
              isArchived && isOwner ? (
                <Button variant="outline" className="gap-2" onClick={() => setRestoreOpen(true)}>
                  <RotateCcw className="size-4" />
                  Вернуть из архива
                </Button>
              ) : undefined
            }
          >
            {context ? <span className="text-sm text-muted-foreground">{context}</span> : null}
            {isArchived ? <StatusBadge tone="neutral">В архиве</StatusBadge> : null}
          </ProfileHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <ProfileTabsList>
              <TabsTrigger value="main">Основное</TabsTrigger>
              {canViewAudit && <TabsTrigger value="history">Журнал</TabsTrigger>}
              {showDanger && <TabsTrigger value="danger">Опасная зона</TabsTrigger>}
            </ProfileTabsList>

            {/* Смонтирована всегда: правка не теряется при переходе на другую
                вкладку, полоса сохранения видна везде. */}
            <TabsContent value="main" forceMount className="flex flex-col gap-5 data-[state=inactive]:hidden">
              {isArchived ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  Счёт в архиве{row.deleted_at ? ` с ${formatDayMonth(row.deleted_at)}` : ""} и не предлагается в
                  новых операциях. Прежние операции и баланс сохранены
                </div>
              ) : null}
              <ProfileSection
                title="Баланс"
                description="Складывается из операций по счёту, вручную не меняется"
                actions={
                  canViewTransactions ? (
                    <Button variant="outline" size="sm" className="gap-2" asChild>
                      <Link href={`/finance/transactions?bank_account_id=${row.id}`}>
                        <ArrowLeftRight className="size-4" />
                        Операции
                      </Link>
                    </Button>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-1">
                  <span
                    className={cn(
                      "text-[28px] font-semibold leading-tight tabular-nums",
                      Number(row.balance) < 0
                        ? signedAmountClass(Number(row.balance))
                        : Number(row.balance) === 0 && "text-muted-foreground",
                    )}
                  >
                    {formatBalance(Number(row.balance), row.currency, (abs, currency) =>
                      formatMoney(abs, currency, amountRoundingScale),
                    )}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {archiveImpact.transactions > 0
                      ? countRu(archiveImpact.transactions, "операция", "операции", "операций")
                      : "Операций по счёту пока нет"}
                    {row.excluded_from_balance ? " · не входит в общий баланс" : ""}
                  </span>
                </div>
              </ProfileSection>
              {canViewTransactions ? (
                <>
                  {reconciliationsError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {reconciliationsError}
                    </p>
                  ) : null}
                  <BankAccountReconciliation
                    bankAccountId={row.id}
                    currency={row.currency}
                    anchorAt={row.balance_anchor_at ?? null}
                    timezone={timezone}
                    canReconcile={canManage && !isArchived}
                    lockMessage={
                      isArchived
                        ? "Счёт в архиве. Верните его, чтобы сверять остаток"
                        : !canManage
                          ? "Сверять остаток могут те, кто управляет счетами"
                          : null
                    }
                    rows={reconciliations}
                  />
                </>
              ) : null}
              <BankAccountEditor
                key={row.updated_at ?? row.id}
                row={row}
                readOnly={!canManage || isArchived}
                lockMessage={
                  isArchived
                    ? "Счёт в архиве. Верните его, чтобы менять данные"
                    : !canManage
                      ? "Менять данные могут те, кто управляет счетами"
                      : null
                }
                legalEntities={legalEntities}
                venues={venues}
                groups={groups}
              />
            </TabsContent>

            {canViewAudit && (
              <TabsContent value="history">
                <EntityAuditTab
                  mode="entity"
                  entityType="bank_account"
                  entityId={row.id}
                  canView={canViewAudit}
                  initialEvents={initialAuditEvents}
                  initialHasMore={initialAuditHasMore}
                />
              </TabsContent>
            )}

            {showDanger && (
              <TabsContent value="danger">
                <BankAccountDangerZone
                  bankAccountId={row.id}
                  bankAccountName={row.name}
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
        title={`Вернуть счёт «${row.name}» из архива?`}
        description="Счёт снова появится в выборе при создании операций"
        confirmLabel="Вернуть счёт"
        pendingLabel="Возвращаем…"
        busy={restoring}
        error={restoreError}
        onConfirm={restore}
      />
    </div>
  );
}

/**
 * Данные счёта — правка на месте, сохранение общей полосой карточки.
 * Компонент монтируется заново после сохранения (ключ по `updated_at`),
 * поэтому исходные значения всегда свежие.
 */
function BankAccountEditor({
  row,
  readOnly,
  lockMessage,
  legalEntities,
  venues,
  groups,
}: {
  row: BankAccountRow;
  readOnly: boolean;
  lockMessage: string | null;
  legalEntities: BankAccountLegalEntityOption[];
  venues: BankAccountVenueOption[];
  groups: BankAccountGroupRow[];
}) {
  const router = useRouter();
  const initial = bankAccountFormFromRow(row);
  const [form, setForm] = useState<BankAccountFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const dirty = !readOnly && bankAccountFormDirty(form, initial);
  const errors: BankAccountFormErrors = dirty ? validateBankAccountForm(form) : {};
  const firstError = Object.values(errors)[0] ?? null;

  async function save(): Promise<boolean> {
    if (Object.keys(validateBankAccountForm(form)).length > 0) return false;
    setSaving(true);
    try {
      const { error } = await updateBankAccount(row.id, bankAccountPayload(form));
      if (error) {
        toast.error(`Не удалось сохранить счёт: ${error}`);
        return false;
      }
      toast.success("Счёт сохранён");
      startRefresh(() => router.refresh());
      return true;
    } catch {
      toast.error("Не удалось сохранить счёт. Проверьте соединение и повторите");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const locked = lockMessage ? { tone: "locked" as const, message: lockMessage } : undefined;
  const section = (key: string, title: string, children: ReactNode) => (
    <ProfileSection key={key} title={title} locked={locked}>
      {children}
    </ProfileSection>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !saving && !firstError) void save();
      }}
    >
      {/* Enter в поле сохраняет форму; видимая кнопка — в полосе. */}
      <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
      <SaveBarSection
        dirty={dirty}
        saving={saving || refreshing}
        save={save}
        reset={() => setForm(initial)}
        blocked={firstError}
      />
      <BankAccountFields
        idPrefix="ba"
        mode="edit"
        form={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        errors={errors}
        readOnly={readOnly}
        legalEntities={legalEntities}
        venues={venues}
        groups={groups}
        section={section}
      />
    </form>
  );
}
