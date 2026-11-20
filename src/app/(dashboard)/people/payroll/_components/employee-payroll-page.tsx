/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import { PageFrame } from "@/components/shared/page-frame";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PayrollMonthPicker } from "./payroll-month-picker";
import { PeriodStepper } from "@/components/shared/period-stepper";
import s from "./employee-pay.module.css";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayroll } from "../actions";
import { EmployeePay } from "./employee-pay";
import { RefreshFailedNotice, useAutoRefresh } from "./auto-refresh";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { personInitials } from "@/lib/format/initials";

export function EmployeePayrollPage({
  initial,
  employeeId,
  month,
  initialTab,
}: {
  initial: PayrollData;
  employeeId: string;
  month: string;
  initialTab?: string;
}) {
  const [data, setData] = useState(initial);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const router = useRouter();
  useEffect(() => setData(initial), [initial]);
  // Нижняя граница — начало учёта, а без настроек (нет права на них) — первое
  // начисление, как в ведомости; иначе назад нельзя было листать вовсе.
  const firstAccrual = data.accruals.reduce<string | null>(
    (min, a) => (!min || a.business_date < min ? a.business_date : min),
    null,
  );
  const start = `${(data.settings?.starts_on ?? firstAccrual ?? month).slice(0, 7)}-01`;
  const minMonth = start < month ? start : month;
  const goTo = (value: string) =>
    router.replace(`/people/payroll/${employeeId}?month=${value.slice(0, 7)}`);
  const goMonth = (direction: number) => {
    const date = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    goTo(date.toISOString().slice(0, 7));
  };
  const reload = useCallback(async () => {
    const next = await loadPayroll();
    if (next.venueId !== initial.venueId) {
      router.replace("/people/payroll");
      throw new Error(
        "Заведение изменилось. Откройте сотрудника в выбранном заведении",
      );
    }
    setData(next);
  }, [initial.venueId, router]);
  const autoRefresh = useAutoRefresh(reload, 60000);
  const employee = data.employees.find(
    (employee) => employee.id === employeeId,
  );
  if (!employee)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Расчёт сотрудника недоступен.
      </div>
    );
  return (
    <PageFrame className={s.page}>
      <Breadcrumbs
        items={[
          { label: "Люди" },
          {
            label: "Зарплата",
            href: `/people/payroll?month=${month.slice(0, 7)}`,
          },
          { label: employee.name },
        ]}
      />
      <div className={s.heading}>
        <span className={s.portrait}>
          {employee.avatar_url ? (
            <img src={employee.avatar_url} alt="" />
          ) : (
            personInitials(employee.name)
          )}
        </span>
        <div>
          <h1>{employee.name}</h1>
          <p>{employee.role_name}</p>
        </div>
        {employee.local_user_id &&
          data.permissions.includes("payroll.configure") && (
            <Button asChild variant="ghost" className="ml-auto">
              <Link
                href={`/people/staff/${employee.local_user_id}?tab=documents`}
              >
                Документы сотрудника
              </Link>
            </Button>
          )}
        <Button
          variant="outline"
          className={employee.local_user_id ? "" : "ml-auto"}
          onClick={() => setConditionsOpen(true)}
        >
          Условия сотрудника
        </Button>
      </div>
      {autoRefresh.failed && <RefreshFailedNotice {...autoRefresh} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Период — как в списке «Зарплаты» и во вкладке «Оплата»:
            стрелки по месяцам и общий MonthPicker посередине. */}
        <PeriodStepper
          previous="Предыдущий месяц"
          next="Следующий месяц"
          previousDisabled={month.slice(0, 7) <= minMonth.slice(0, 7)}
          onPrevious={() => goMonth(-1)}
          onNext={() => goMonth(1)}
        >
          <PayrollMonthPicker
            variant="period"
            ariaLabel="Месяц расчёта сотрудника"
            prefix=""
            value={month}
            min={minMonth}
            onChange={(value) => goTo(value)}
          />
        </PeriodStepper>
        <div
          id="employee-payroll-controls"
          className="flex flex-wrap items-center gap-2"
        />
      </div>
      <EmployeePay
        key={`${employeeId}.${month}`}
        fullPage
        initialTab={initialTab}
        conditionsOpen={conditionsOpen}
        onConditionsOpenChange={setConditionsOpen}
        data={data}
        employee={employee}
        month={month}
        onChange={reload}
      />
    </PageFrame>
  );
}
