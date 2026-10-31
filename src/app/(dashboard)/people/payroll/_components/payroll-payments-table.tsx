"use client";
import {
  paymentJournalRows,
  type PaymentJournalRow,
} from "@/lib/payroll/payment-journal";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Payment, PayrollData } from "@/lib/payroll/types";
import { Button } from "@/components/ui/button";
import {
  Check,
  Loader2,
  MoreHorizontal,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TransactionHistory } from "@/components/audit/transaction-history";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { loadPayrollTransactionDetails } from "../actions";
import { money } from "@/lib/sales/format";
import { PayrollTable } from "./payroll-table";
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
  toolbarTargetId = "payroll-table-controls",
  tableId,
  externalSearch,
  filters,
  exportAction,
  scrollMode,
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
  toolbarTargetId?: string;
  tableId?: string;
  exportAction?: { label: string; onClick: () => void };
  scrollMode?: "contained" | "page";
  externalSearch?: { value: string; onChange: (value: string) => void };
  filters?: { active?: boolean; content: React.ReactNode };
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
            <span className="font-semibold tabular-nums">
              {money(row.original.amount)}{" "}
              <span className="font-normal text-muted-foreground">₽</span>
            </span>
          ) : id === "employee" ? (
            <PayrollEmployeeCell
              name={row.original.employee}
              role={row.original.roleName}
              avatarUrl={row.original.avatarUrl}
            />
          ) : id === "status" ? (
            <PaymentStatus posted={row.original.posted} />
          ) : (
            row.original[id as "employee" | "kind" | "status"]
          ),
      })),
    [data.timezone],
  );
  const selected = rows.find((row) => row.id === selectedId);
  return (
    <>
      <PayrollTable
        id={tableId ?? `payroll.payments.${data.venueId}`}
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
        scrollMode={scrollMode}
        actions={actions}
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
    </>
  );
}

function PaymentStatus({ posted }: { posted: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${posted ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
    >
      {posted ? <Check size={12} /> : <Trash2 size={12} />}
      {posted ? "Проведена" : "Удалена"}
    </span>
  );
}
function PaymentDetails({
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
  const [details, setDetails] = useState<Awaited<
    ReturnType<typeof loadPayrollTransactionDetails>
  > | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (row.transactionId)
      loadPayrollTransactionDetails(row.transactionId)
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
  return (
    <PayrollDetailDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Выплата"
      description={
        row.earningMonths.length
          ? `За ${row.earningMonths.map((m) => new Date(`${m}T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).replace(" г.", "")).join(", ")}`
          : "Зарплатная операция"
      }
      employee={{
        name: row.employee,
        role: row.roleName,
        avatarUrl: row.avatarUrl,
      }}
      amount={<>{money(row.amount)} ₽</>}
      amountLabel="Выдано сотруднику"
      status={<PaymentStatus posted={row.posted} />}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {row.transactionId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/finance/transactions?id=${row.transactionId}`}>
                Транзакция
                <ArrowUpRight className="ml-2 size-3.5" />
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Действия с выплатой"
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.transactionId && (
                <DropdownMenuItem asChild>
                  <Link href={`/finance/transactions?id=${row.transactionId}`}>
                    <ArrowUpRight className="mr-2 size-4" />
                    Открыть в финансах
                  </Link>
                </DropdownMenuItem>
              )}
              {!row.external &&
                row.posted &&
                data.permissions.includes("payroll.pay") &&
                data.permissions.includes("finance.delete_transaction") && (
                  <DropdownMenuItem
                    disabled={busy}
                    className="text-destructive focus:text-destructive"
                    onSelect={onCancel}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Удалить выплату
                  </DropdownMenuItem>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Детали</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          {row.settledAmount !== undefined && (
            <dl className="mb-5 divide-y rounded-xl border px-4 text-sm">
              {[
                ["Выдано сотруднику", row.amount],
                ["Удержанный налог", row.taxAmount ?? 0],
                ["Погашено по зарплате", row.settledAmount],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="whitespace-nowrap font-medium tabular-nums">
                    {money(Number(value))} ₽
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : details ? (
            <dl className="space-y-4 border-y py-5 text-sm">
              {[
                ...(row.earningMonths.length
                  ? [
                      [
                        "За месяц",
                        row.earningMonths
                          .map((m) =>
                            new Date(`${m}T12:00:00Z`).toLocaleDateString(
                              "ru-RU",
                              {
                                month: "long",
                                year: "numeric",
                                timeZone: "UTC",
                              },
                            ),
                          )
                          .join(", "),
                      ],
                    ]
                  : []),
                [
                  "Дата",
                  new Date(details.date).toLocaleDateString("ru-RU", {
                    timeZone: data.timezone,
                  }),
                ],
                ["Счёт", details.bankName],
                ["Статья ФОТ", details.categoryName],
                ["Номер транзакции", `№ ${details.public_id}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
              {details.description && (
                <div className="space-y-2 border-t pt-4">
                  <dt className="text-muted-foreground">Комментарий</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {details.description}
                  </dd>
                </div>
              )}
            </dl>
          ) : row.transactionId ? (
            <p
              role="status"
              className="flex gap-2 text-sm text-muted-foreground"
            >
              <Loader2 size={15} className="animate-spin" />
              Загружаем реквизиты…
            </p>
          ) : null}
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
