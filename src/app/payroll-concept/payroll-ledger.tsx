"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PayrollTable } from "@/app/(dashboard)/people/payroll/_components/payroll-table";
import { statementRows } from "@/lib/payroll/calculate";
import type { PayrollData } from "@/lib/payroll/types";
import s from "./payroll-concept.module.css";
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
  remaining: "К выплате",
  tips: "Чаевые",
};
const numeric = Object.keys(labels).filter((id) => id !== "employee");
const hidden = ["opening", "transferredOut", "tips"];
const searchText = (row: Row) =>
  `${row.employee.name} ${row.employee.role_name}`;
const format = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);

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
}: {
  data: PayrollData;
  month: string;
  rows: Row[];
  query: string;
  onQuery: (query: string) => void;
  onEmployee: (row: Row) => void;
  actions: ReactNode;
  onExport: () => void;
  filters: { active: boolean; content: ReactNode };
}) {
  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      Object.entries(labels).map(([id, label]) => ({
        id,
        header: label,
        accessorFn: (row) =>
          id === "employee"
            ? row.employee.name
            : row[id as keyof Omit<Row, "employee">],
        cell: ({ row }) => {
          const record = row.original;
          if (id === "employee")
            return (
              <PayrollEmployeeCell name={record.employee.name} role={record.employee.role_name} avatarUrl={record.employee.avatar_url} />
            );
          const pending = data.legacyPayments.some(
            (p) =>
              p.employee_id === record.employee.id &&
              p.month === month &&
              p.state === "review",
          );
          if (
            (["paid", "remaining"].includes(id) && pending) ||
            (["opening", "remaining"].includes(id) &&
              !record.employee.opening_confirmed)
          )
            return (
              <span
                className="text-muted-foreground"
                title="Сумма появится после уточнения выплат и переносов"
              >
                —
              </span>
            );
          const value = Number(record[id as keyof Omit<Row, "employee">]);
          return (
            <span
              className={
                id === "earned" || id === "remaining"
                  ? "font-semibold"
                  : id === "bonuses"
                    ? s.bonus
                    : id === "deductions"
                      ? s.deduction
                      : undefined
              }
            >
              {id === "bonuses" && value > 0
                ? "+"
                : id === "deductions" && value > 0
                  ? "−"
                  : ""}
              {format(value)}
            </span>
          );
        },
      })),
    [data.legacyPayments, month],
  );
  return (
    <PayrollTable
      id={`payroll.concept.statement.${data.venueId}`}
      rows={rows}
      columns={columns}
      labels={labels}
      numeric={numeric}
      searchText={searchText}
      onRow={onEmployee}
      actions={actions}
      defaultSort="earned"
      defaultSortDesc
      hiddenColumns={hidden}
      toolbarTargetId="payroll-concept-controls"
      externalSearch={{ value: query, onChange: onQuery }}
      filters={filters}
      scrollMode="page"
      exportAction={{ label: "Экспорт ведомости", onClick: onExport }}
    />
  );
}
