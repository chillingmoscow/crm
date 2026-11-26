"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  PayrollTable,
  type PayrollTableFilters,
} from "@/app/(dashboard)/people/payroll/_components/payroll-table";
import { statementRows } from "@/lib/payroll/calculate";
import type { PayrollData } from "@/lib/payroll/types";
import { formatAmount } from "@/lib/format/amount";
import { officialExpectedNote } from "@/lib/payroll/official";
import { Money } from "@/components/shared/money";
import { PayrollEmployeeCell } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-cell";

type Row = ReturnType<typeof statementRows>[number];
const labels = {
  employee: "Сотрудник",
  shifts: "Смены",
  earned: "Начислено",
  bonuses: "Премии",
  deductions: "Удержания",
  opening: "Перенос в этот месяц",
  paid: "Выплачено",
  transferredOut: "Перенесено далее",
  officialExpected: "Официальная часть",
  remaining: "К выплате",
  tips: "Чаевые",
};
/** Без официальной части за месяц столбца нет совсем, даже в выборе столбцов. */
const labelsWithoutOfficial: Record<string, string> = Object.fromEntries(
  Object.entries(labels).filter(([id]) => id !== "officialExpected"),
);
const numericAll = Object.keys(labels).filter((id) => id !== "employee");
const numericWithoutOfficial = numericAll.filter((id) => id !== "officialExpected");
const hidden = ["opening", "transferredOut", "tips"];
const searchText = (row: Row) =>
  `${row.employee.name} ${row.employee.role_name}`;
/** Число столбца для сортировки и итога; официальная часть — ожидаемая сумма. */
const cellValue = (row: Row, id: string) =>
  id === "officialExpected"
    ? (row.officialExpected?.amount ?? 0)
    : Number(row[id as keyof Omit<Row, "employee" | "officialExpected">]);

export function PayrollLedger({
  data,
  month,
  rows,
  query,
  onQuery,
  onEmployee,
  actions,
  filters,
  onExport,
  exporting = false,
}: {
  data: PayrollData;
  month: string;
  rows: Row[];
  query: string;
  onQuery: (query: string) => void;
  onEmployee: (row: Row) => void;
  actions: ReactNode;
  onExport: () => void;
  exporting?: boolean;
  filters: PayrollTableFilters;
}) {
  const hasOfficial = rows.some((row) => row.officialExpected);
  const visibleLabels: Record<string, string> = hasOfficial ? labels : labelsWithoutOfficial;
  const numeric = hasOfficial ? numericAll : numericWithoutOfficial;
  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      Object.entries(visibleLabels).map(([id, label]) => ({
        id,
        header: label,
        // Длинный заголовок целиком, со стрелкой сортировки: иначе при
        // обычной ширине «Официальная часть» обрезается до «Официальная…».
        ...(id === "officialExpected" ? { minSize: label.length * 8 + 32 } : {}),
        accessorFn: (row) =>
          id === "employee" ? row.employee.name : cellValue(row, id),
        cell: ({ row }) => {
          const record = row.original;
          if (id === "employee")
            return (
              <PayrollEmployeeCell name={record.employee.name} role={record.employee.role_name} avatarUrl={record.employee.avatar_url} href={`/people/payroll/${record.employee.id}?month=${month.slice(0, 7)}`} />
            );
          const pending = data.legacyPayments.some(
            (p) =>
              p.employee_id === record.employee.id &&
              p.month === month &&
              p.state === "review",
          );
          if (["paid", "remaining"].includes(id) && pending)
            return (
              <span
                className="text-muted-foreground"
                data-tip="Сумма появится после сверки прежних выплат"
              >
                —
              </span>
            );
          if (id === "officialExpected") {
            const official = record.officialExpected;
            // Месяц увольнения: сумма неизвестна и в «К выплате» не вычтена.
            if (official && official.amount === null)
              return <span className="text-muted-foreground">уточняется</span>;
            return (
              <span data-tip={official ? officialExpectedNote(official, month) : undefined}>
                <Money value={-(official?.amount ?? 0)} signed />
              </span>
            );
          }
          const value = cellValue(record, id);
          if (id === "shifts") return formatAmount(value, 0);
          // Премии со знаком «+», удержания хранятся положительными и
          // показываются со знаком «−»; ноль серый, без цвета.
          if (id === "bonuses") return <Money value={value} signed />;
          if (id === "deductions") return <Money value={-value} signed />;
          return (
            <Money
              value={value}
              className={
                id === "earned" || id === "remaining"
                  ? "font-semibold"
                  : undefined
              }
            />
          );
        },
      })),
    [data.legacyPayments, month, visibleLabels],
  );
  return (
    <PayrollTable
      // Ключ сохранённых настроек столбцов: остался от прежнего названия
      // экрана, менять нельзя — у всех сбросятся порядок и ширина столбцов.
      id={`payroll.concept.statement.${data.venueId}`}
      label="Ведомость"
      rows={rows}
      columns={columns}
      labels={visibleLabels}
      numeric={numeric}
      searchText={searchText}
      onRow={onEmployee}
      actions={actions}
      defaultSort="earned"
      defaultSortDesc
      hiddenColumns={hidden}
      toolbarTargetId="payroll-workspace-controls"
      externalSearch={{ value: query, onChange: onQuery }}
      filters={filters}
      exportAction={{ label: "Экспорт ведомости", onClick: onExport, loading: exporting }}
      totals={(visible) => {
        // Сумма по столбцу неизвестна, если хоть у одной строки в нём прочерк.
        const unknown = (id: string) =>
          visible.some(
            (record) =>
              ["paid", "remaining"].includes(id) &&
              data.legacyPayments.some(
                (p) =>
                  p.employee_id === record.employee.id &&
                  p.month === month &&
                  p.state === "review",
              ),
          );
        return Object.fromEntries(
          numeric.map((id) => [
            id,
            unknown(id) ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              totalCell(
                id,
                visible.reduce((sum, record) => sum + cellValue(record, id), 0),
              )
            ),
          ]),
        );
      }}
    />
  );
}

/** Итог столбца в том же виде, что и ячейки: смены числом, деньги через Money. */
function totalCell(id: string, value: number) {
  if (id === "shifts") return formatAmount(value, 0);
  if (id === "bonuses") return <Money value={value} signed />;
  if (id === "deductions") return <Money value={-value} signed />;
  if (id === "officialExpected") return <Money value={-value} signed />;
  return <Money value={value} />;
}
