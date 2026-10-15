"use client";

import { Button } from "@/components/ui/button";
import { PageFrame } from "@/components/shared/page-frame";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PayrollMonthPicker } from "./payroll-month-picker";
import s from "./employee-pay.module.css";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayroll } from "../actions";
import { EmployeePay } from "./employee-pay";

export function EmployeePayrollPage({
  initial,
  employeeId,
  month,
}: {
  initial: PayrollData;
  employeeId: string;
  month: string;
}) {
  const [data, setData] = useState(initial);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const router = useRouter();
  useEffect(() => setData(initial), [initial]);
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
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [reload]);
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
      <PageBreadcrumb>
        <Link
          href={`/payroll-concept?month=${month.slice(0, 7)}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Зарплата
        </Link>
      </PageBreadcrumb>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className={s.heading}><span className={s.portrait}>{employee.avatar_url ? <img src={employee.avatar_url} alt=""/> : employee.name.split(/\s+/).slice(0,2).map(w=>w[0]).join("")}</span><div><h1>{employee.name}</h1><p>{employee.role_name}</p></div><Button variant="outline" className="ml-auto" onClick={()=>setConditionsOpen(true)}>Условия сотрудника</Button></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="w-fit min-w-44"><PayrollMonthPicker variant="field" ariaLabel="Месяц расчёта сотрудника" prefix="" value={month} min={data.settings?.starts_on??"2026-09-01"} onChange={value=>router.replace(`/people/payroll/${employeeId}?month=${value.slice(0,7)}`)}/></div><div id="employee-payroll-controls" className="flex flex-wrap items-center gap-2"/></div>
      <EmployeePay
        key={`${employeeId}.${month}`}
        fullPage
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
