"use client";

import { useState } from "react";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table";
import { AttendanceReview } from "@/app/(dashboard)/people/payroll/_components/attendance-review";
import { loadPayroll } from "@/app/(dashboard)/people/payroll/actions";
import { unwrapAction } from "@/lib/actions/result";
import type { PayrollData } from "@/lib/payroll/types";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";

export function ScheduleAttendanceClient({ initial, month, date }: {
  initial: PayrollData;
  month: string;
  date?: string;
}) {
  const [data, setData] = useState(initial);
  const calendarDate = date ?? `${month}-01`;
  return (
    <PageFrame className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "График работы" },
          { label: "Расписание", href: `/schedule?date=${calendarDate}` },
          { label: "Сверка отметок" },
        ]}
      />
      <TablePageHeader
        title="Сверка отметок"
        actions={<div id="schedule-attendance-controls" className="flex items-center gap-2" />}
      />
      <AttendanceReview
        data={data}
        month={month}
        date={date}
        onRefresh={async () => setData(unwrapAction(await loadPayroll()))}
        toolbarTargetId="schedule-attendance-controls"
      />
    </PageFrame>
  );
}
