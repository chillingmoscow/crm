"use client";

import { useState } from "react";
import Link from "next/link";
import { PageFrame } from "@/components/shared/page-frame";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { TablePageHeader } from "@/components/shared/table";
import { AttendanceReview } from "@/app/(dashboard)/people/payroll/_components/attendance-review";
import { loadPayroll } from "@/app/(dashboard)/people/payroll/actions";
import type { PayrollData } from "@/lib/payroll/types";

export function ScheduleAttendanceClient({ initial, month, date }: {
  initial: PayrollData;
  month: string;
  date?: string;
}) {
  const [data, setData] = useState(initial);
  const calendarDate = date ?? `${month}-01`;
  return (
    <PageFrame className="space-y-6">
      <PageBreadcrumb>
        <Link href={`/schedule?date=${calendarDate}`} className="text-muted-foreground hover:text-foreground">
          Расписание
        </Link>
      </PageBreadcrumb>
      <TablePageHeader
        title="Сверка отметок"
        actions={<div id="schedule-attendance-controls" className="flex items-center gap-2" />}
      />
      <AttendanceReview
        data={data}
        month={month}
        date={date}
        onRefresh={async () => setData(await loadPayroll())}
        toolbarTargetId="schedule-attendance-controls"
      />
    </PageFrame>
  );
}
