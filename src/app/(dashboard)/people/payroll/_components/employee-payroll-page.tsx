/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageFrame } from "@/components/shared/page-frame";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import type { PayrollData } from "@/lib/payroll/types";
import { loadPayroll } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { RefreshFailedNotice, useAutoRefresh } from "./auto-refresh";
import { StaffPaySheet } from "./staff-pay-sheet";
import { EmployeeDocuments } from "../../staff/[userId]/_components/employee-documents";
import { personInitials } from "@/lib/format/initials";
import { avatarImageUrl } from "@/lib/people/avatar-thumb";
import { CasualToStaffDrawer } from "./casual-to-staff-drawer";

/**
 * Расчёт сотрудника в разделе «Зарплата». Это тот же расчётный лист, что во
 * вкладке «Оплата» карточки сотрудника: один экран на двух входах.
 */
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
  const [converting, setConverting] = useState(false);
  const router = useRouter();
  useEffect(() => setData(initial), [initial]);
  const current = `${(data.asOfDate ?? new Date().toISOString()).slice(0, 7)}-01`;
  // Нижняя граница — начало учёта, а без настроек (нет права на них) — первое
  // начисление сотрудника.
  const firstAccrual = data.accruals
    .filter((a) => a.employee_id === employeeId)
    .reduce<string | null>((min, a) => (!min || a.business_date < min ? a.business_date : min), null);
  const start = `${(data.settings?.starts_on ?? firstAccrual ?? month).slice(0, 7)}-01`;
  const minMonth = start < month ? start : month;
  const maxMonth = month > current ? month : current;
  const reload = useCallback(async () => {
    const next = unwrapAction(await loadPayroll());
    if (next.venueId !== initial.venueId) {
      router.replace("/people/payroll");
      throw new Error("Заведение изменилось. Откройте сотрудника в выбранном заведении");
    }
    setData(next);
  }, [initial.venueId, router]);
  const autoRefresh = useAutoRefresh(reload, 60000);
  const employee = data.employees.find((e) => e.id === employeeId);
  if (!employee)
    return <div className="p-6 text-sm text-muted-foreground">Расчёт сотрудника недоступен.</div>;
  return (
    <PageFrame className="min-w-0">
      <Breadcrumbs
        items={[
          { label: "Люди" },
          { label: "Зарплата", href: `/people/payroll?month=${month.slice(0, 7)}` },
          { label: employee.name },
        ]}
      />
      <div className="mx-auto mb-6 flex w-full max-w-[720px] flex-wrap items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xl font-medium text-muted-foreground">
          {employee.avatar_url ? (
            <img src={avatarImageUrl(employee.avatar_url, 128)} alt="" className="size-full object-cover" />
          ) : (
            personInitials(employee.name)
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{employee.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{employee.role_name}</p>
        </div>
        {employee.casual && !employee.local_user_id && data.permissions.includes("payroll.configure") && (
          <Button variant="outline" onClick={() => setConverting(true)}>
            Перевести в штат
          </Button>
        )}
        {employee.local_user_id && (
          <Button asChild variant="outline">
            <Link href={`/people/staff/${employee.local_user_id}`}>
              Карточка сотрудника
              <ArrowUpRight />
            </Link>
          </Button>
        )}
      </div>
      {autoRefresh.failed && <RefreshFailedNotice {...autoRefresh} />}
      {employee.casual && !employee.local_user_id && (
        <CasualToStaffDrawer
          open={converting}
          onOpenChange={setConverting}
          employee={employee}
          roles={data.roles ?? []}
        />
      )}
      <StaffPaySheet
        key={employeeId}
        context="payroll"
        data={data}
        employee={employee}
        month={month}
        minMonth={minMonth}
        maxMonth={maxMonth}
        onMonth={(value) => router.replace(`/people/payroll/${employeeId}?month=${value.slice(0, 7)}`)}
        onChange={reload}
      />
      {/* У сотрудника без карточки (разовый из Quick Resto) документы — здесь. */}
      {!employee.local_user_id && data.permissions.includes("payroll.configure") && (
        <div className="mx-auto mt-5 w-full max-w-[720px]">
          <EmployeeDocuments target={{ employeeId: employee.id }} />
        </div>
      )}
    </PageFrame>
  );
}
