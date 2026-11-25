"use client";
import {
  officialAccountSelectable,
  paymentJournalRows,
  type PaymentJournalRow,
} from "@/lib/payroll/payment-journal";
import { canChangeOfficialAccount, checkingBanks } from "@/lib/payroll/official-payment";
import { countRu } from "@/lib/format/plural";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import type { AdeskSync, Payment, PayrollData } from "@/lib/payroll/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Check,
  Loader2,
  Trash2,
  ArrowUpRight,
  Landmark,
} from "lucide-react";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TransactionHistory } from "@/components/audit/transaction-history";
import {
  changeOfficialPaymentsAccount,
  loadPayrollTransactionDetails,
  retryPayrollAdeskSync,
} from "../actions";
import { TableBulkBar } from "@/components/shared/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { OptionSelect } from "@/components/ui/option-select";
import { Label } from "@/components/ui/label";
import { unwrapAction } from "@/lib/actions/result";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/ui/status-badge";
import { PayrollTable, type PayrollTableFilters } from "./payroll-table";
import { PayrollEmployeeCell } from "./payroll-employee-cell";
const labels = {
  date: "Дата",
  employee: "Сотрудник",
  kind: "Статья",
  amount: "Сумма",
  status: "Статус",
};
const numeric = ["amount"];

export function PayrollPaymentsTable({
  data,
  payments,
  busy,
  actions,
  onCancel,
  onChange,
  toolbarTargetId = "payroll-table-controls",
  tableId,
  externalSearch,
  filters,
  exportAction,
  financeMonth,
  financeRole,
}: {
  data: PayrollData;
  financeMonth?: string;
  financeRole?: string;
  payments: Payment[];
  busy: boolean;
  actions: React.ReactNode;
  onCancel: (id: string) => Promise<void>;
  /** Перечитать данные после массового действия («Сменить счёт»). */
  onChange?: () => Promise<void>;
  toolbarTargetId?: string;
  tableId?: string;
  exportAction?: { label: string; onClick: () => void; loading?: boolean };
  externalSearch?: { value: string; onChange: (value: string) => void };
  filters?: PayrollTableFilters;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(
    () => paymentJournalRows(data, payments, financeMonth, financeRole),
    [data, payments, financeMonth, financeRole],
  );
  const columns = useMemo<ColumnDef<PaymentJournalRow>[]>(
    () =>
      Object.entries(labels).map(([id, label]) => ({
        id,
        header: label,
        accessorFn: (row) => row[id as keyof PaymentJournalRow],
        cell: ({ row }) =>
          id === "date" ? (
            <time dateTime={row.original.date} className="whitespace-nowrap">
              {new Date(row.original.date).toLocaleDateString("ru-RU", {
                timeZone: data.timezone,
              })}
            </time>
          ) : id === "amount" ? (
            <Money value={row.original.amount} className="font-semibold" />
          ) : id === "employee" ? (
            <PayrollEmployeeCell
              name={row.original.employee}
              role={row.original.roleName}
              avatarUrl={row.original.avatarUrl}
            />
          ) : id === "status" ? (
            <span className="inline-flex items-center gap-2">
              <PaymentStatus posted={row.original.posted} />
              {["error", "review"].includes(
                data.adeskSync?.find((x) => x.payment_id === row.original.id)?.state ?? "",
              ) && (
                <AlertCircle
                  className="size-3.5 text-muted-foreground"
                  aria-label="Не отправлена в Adesk"
                />
              )}
            </span>
          ) : id === "kind" && (row.original.bonus || row.original.official) ? (
            // Бейдж переносится под статью, когда в столбце не хватает места:
            // иначе он вылезает из ячейки и обрезается соседним столбцом.
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {row.original.kind}
                {row.original.bonus && <small className="text-muted-foreground"> · Премия</small>}
              </span>
              {row.original.official && <StatusBadge tone="info">Официальная</StatusBadge>}
            </span>
          ) : (
            row.original[id as "employee" | "kind" | "status"]
          ),
      })),
    [data.timezone, data.adeskSync],
  );
  const selected = rows.find((row) => row.id === selectedId);
  // «Сменить счёт»: выбор только проведённых официальных выплат и только с
  // правами на проведение и удаление операций.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [accountOpen, setAccountOpen] = useState(false);
  const canChangeAccount = canChangeOfficialAccount(data.permissions);
  const selectable = canChangeAccount && rows.some(officialAccountSelectable);
  const selectedOfficial = selectable
    ? rows.filter((row) => rowSelection[row.id] && officialAccountSelectable(row))
    : [];
  return (
    <div className={selectedOfficial.length ? "min-w-0 pb-28 md:pb-24" : "min-w-0"}>
      <PayrollTable
        id={tableId ?? `payroll.payments.${data.venueId}`}
        label="Выплаты"
        rows={rows}
        onRow={(row) => setSelectedId(row.id)}
        columns={columns}
        labels={labels}
        numeric={numeric}
        searchText={(row) => `${row.employee} ${row.kind} ${row.status}`}
        defaultSort="date"
        toolbarTargetId={toolbarTargetId}
        externalSearch={externalSearch}
        filters={filters}
        exportAction={exportAction}
        actions={actions}
        selection={
          selectable
            ? {
                value: rowSelection,
                onChange: setRowSelection,
                getRowId: (row) => row.id,
                canSelect: officialAccountSelectable,
                rowLabel: (row) => `Выбрать официальную выплату: ${row.employee}`,
                pageLabel: "Выбрать все официальные выплаты на странице",
              }
            : undefined
        }
        totals={(visible) => ({
          amount: (
            <Money
              value={visible
                .filter((row) => row.posted)
                .reduce((sum, row) => sum + row.amount, 0)}
            />
          ),
        })}
      />
      {selected && (
        <PaymentDetails
          key={`${selected.id}:${selected.posted}`}
          row={selected}
          data={data}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onCancel={() => {
            setSelectedId(null);
            void onCancel(selected.id);
          }}
        />
      )}
      {selectable && (
        <TableBulkBar
          floating
          selectedCount={selectedOfficial.length}
          onClear={() => setRowSelection({})}
          actions={
            <Button variant="outline" size="sm" onClick={() => setAccountOpen(true)}>
              <Landmark className="mr-2 size-4" />
              Сменить счёт
            </Button>
          }
        />
      )}
      {accountOpen && (
        <ChangeAccountDialog
          data={data}
          paymentIds={selectedOfficial.map((row) => row.id)}
          onClose={() => setAccountOpen(false)}
          onDone={async () => {
            setAccountOpen(false);
            setRowSelection({});
            await onChange?.();
          }}
        />
      )}
    </div>
  );
}

/** Перенос выбранных официальных выплат на другой расчётный счёт. */
function ChangeAccountDialog({
  data,
  paymentIds,
  onClose,
  onDone,
}: {
  data: PayrollData;
  paymentIds: string[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const banks = checkingBanks(data.banks);
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = countRu(paymentIds.length, "официальная выплата", "официальные выплаты", "официальных выплат");
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Сменить счёт выплат"
      description={`Выбрано: ${count}. Прежние операции в финансах удалятся, на выбранном счёте появятся такие же с той же датой и суммой.`}
      confirmLabel="Сменить счёт"
      pendingLabel="Переносим…"
      busy={busy}
      confirmDisabled={!bank || !paymentIds.length}
      restriction={banks.length ? undefined : "Нет расчётного счёта: официальные выплаты проводят только с него."}
      error={error ?? undefined}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          const moved = unwrapAction(
            await changeOfficialPaymentsAccount({ paymentIds, bankAccountId: bank }),
          );
          toast.success(
            `Счёт изменён: ${countRu(moved.length, "выплата", "выплаты", "выплат")}`,
          );
          await onDone();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось сменить счёт выплат");
        } finally {
          setBusy(false);
        }
      }}
    >
      {banks.length ? (
        <div className="space-y-2">
          <Label htmlFor="payroll-official-account">Расчётный счёт</Label>
          <OptionSelect
            id="payroll-official-account"
            value={bank}
            onValueChange={setBank}
            placeholder="Выберите счёт"
            disabled={busy}
            options={banks.map((b) => ({ value: b.id, label: b.name }))}
          />
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

function PaymentStatus({ posted }: { posted: boolean }) {
  return (
    <StatusBadge
      tone={posted ? "success" : "neutral"}
      icon={posted ? <Check /> : <Trash2 />}
    >
      {posted ? "Проведена" : "Удалена"}
    </StatusBadge>
  );
}
const ADESK_MAX_ATTEMPTS = 10;
function AdeskStatus({
  sync,
  posted,
  canRetry,
}: {
  sync: AdeskSync | undefined;
  posted: boolean;
  canRetry: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [retried, setRetried] = useState(false);
  // Historical payouts came from Glide and are already in Adesk; tips are not mirrored.
  if (!sync) return null;
  const waiting = retried || ["pending", "sending"].includes(sync.state);
  const stopped =
    sync.state === "review" ||
    (sync.state === "error" && sync.attempts >= ADESK_MAX_ATTEMPTS);
  const text = waiting
    ? "Ждёт отправки"
    : sync.state === "synced"
      ? posted
        ? `Отправлена · № ${sync.adesk_id}`
        : "Удалена из Adesk"
      : sync.state === "review"
        ? "Нужна проверка"
        : stopped
          ? "Не отправлена"
          : "Не отправлена, повторим автоматически";
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">Adesk</dt>
        <dd className="text-right font-medium">{text}</dd>
      </div>
      {!waiting && sync.state !== "synced" && sync.last_error && (
        <p className="mt-1 text-xs text-muted-foreground">{sync.last_error}</p>
      )}
      {!waiting && stopped && canRetry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              unwrapAction(await retryPayrollAdeskSync(sync.payment_id));
              setRetried(true);
              toast.success("Выплата снова отправится в Adesk в течение минуты");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Не удалось повторить отправку");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="mr-2 size-3.5 animate-spin" />}
          Отправить снова
        </Button>
      )}
    </div>
  );
}

const monthName = (m: string) =>
  new Date(`${m}T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .replace(" г.", "");

/** Подпись и значение одной строки в панели выплаты. */
function DetailRow({ label, children, strong = false }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{children}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <dl className="divide-y border-y text-sm">{children}</dl>
    </section>
  );
}

export function PaymentDetails({
  row,
  data,
  busy,
  onClose,
  onCancel,
}: {
  row: PaymentJournalRow;
  data: PayrollData;
  busy: boolean;
  onClose: () => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState<Extract<
    Awaited<ReturnType<typeof loadPayrollTransactionDetails>>,
    { ok: true }
  >["data"] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (row.transactionId)
      loadPayrollTransactionDetails(row.transactionId)
        .then(unwrapAction)
        .then((value) => {
          if (active) setDetails(value);
        })
        .catch((e) => {
          if (active)
            setError(
              e instanceof Error ? e.message : "Не удалось загрузить выплату",
            );
        });
    return () => {
      active = false;
    };
  }, [row.transactionId]);
  const canDelete =
    !row.external &&
    row.posted &&
    data.permissions.includes("payroll.pay") &&
    data.permissions.includes("finance.delete_transaction");
  const adesk = data.adeskSync?.find((x) => x.payment_id === row.id);
  return (
    <PayrollDetailDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row.bonus ? "Выплата премии" : row.official ? "Официальная выплата" : "Выплата"}
      description={
        row.earningMonths.length
          ? `За ${row.earningMonths.map(monthName).join(", ")}`
          : "Зарплатная операция"
      }
      employee={{
        name: row.employee,
        role: row.roleName,
        avatarUrl: row.avatarUrl,
      }}
      amount={<Money value={row.amount} fraction />}
      amountLabel="Выдано сотруднику"
      status={<PaymentStatus posted={row.posted} />}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {canDelete ? (
            <Button
              variant="ghost"
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onCancel}
            >
              <Trash2 className="size-4" />
              Удалить
            </Button>
          ) : <span />}
          {row.transactionId && (
            <Button asChild variant="outline">
              <Link href={`/finance/transactions?id=${row.transactionId}`}>
                Открыть в финансах
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          )}
        </div>
      }
    >
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Детали</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-6">
          {row.settledAmount !== undefined && (
            <DetailSection title="Расчёт">
              <DetailRow label="Выдано на руки"><Money value={row.amount} fraction /></DetailRow>
              <DetailRow label="Удержан налог"><Money value={row.taxAmount ?? 0} fraction /></DetailRow>
              <DetailRow label="Закрыто по зарплате" strong><Money value={row.settledAmount} fraction /></DetailRow>
            </DetailSection>
          )}
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : details ? (
            <DetailSection title="Операция">
              <DetailRow label="Дата">
                {new Date(details.date).toLocaleDateString("ru-RU", { timeZone: data.timezone })}
              </DetailRow>
              <DetailRow label="Счёт">{details.bankName}</DetailRow>
              <DetailRow label="Статья">{details.categoryName}</DetailRow>
              <DetailRow label="Транзакция">
                <Link
                  href={`/finance/transactions?id=${details.id}`}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  № {details.public_id}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </DetailRow>
              <AdeskStatus
                sync={adesk}
                posted={row.posted}
                canRetry={data.permissions.includes("payroll.pay")}
              />
            </DetailSection>
          ) : row.transactionId ? (
            <p
              role="status"
              className="flex gap-2 text-sm text-muted-foreground"
            >
              <Loader2 size={15} className="animate-spin" />
              Загружаем реквизиты…
            </p>
          ) : adesk ? (
            <DetailSection title="Операция">
              <AdeskStatus
                sync={adesk}
                posted={row.posted}
                canRetry={data.permissions.includes("payroll.pay")}
              />
            </DetailSection>
          ) : null}
          {details?.description && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Комментарий</h3>
              <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-[13px] leading-relaxed">
                {details.description}
              </p>
            </section>
          )}
        </TabsContent>
        <TabsContent value="history">
          {row.transactionId ? (
            <TransactionHistory transactionId={row.transactionId} />
          ) : (
            <p className="text-sm text-muted-foreground">
              У этой записи нет связанной транзакции.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </PayrollDetailDialog>
  );
}
