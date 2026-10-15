"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HelpCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TablePageHeader } from "@/components/shared/table";
import { PayrollTable } from "../../people/payroll/_components/payroll-table";
import { loadPayroll, payrollCommand } from "../../people/payroll/actions";
import {
  attendanceLabels,
  type Attendance,
  type PayrollData,
} from "@/lib/payroll/types";
import { businessDate } from "@/lib/sales/time";
import { cn } from "@/lib/utils";
const labels = {
  employee: "Сотрудник",
  date: "Рабочий день",
  plan: "План",
  actual: "Учтённое время",
  status: "Состояние",
};
type Row = {
  id: string;
  employee: string;
  role: string;
  date: string;
  plan: string;
  actual: string;
  status: Attendance["status"];
  issue: string | null;
  attendance: Attendance | null;
  plannedShift: PayrollData["plannedShifts"][number] | null;
  noShow: boolean;
};
const search = (r: Row) => `${r.employee} ${r.role} ${r.date}`;
export function AttendanceClient({ initial }: { initial: PayrollData }) {
  const [data, setData] = useState(initial),
    [month, setMonth] = useState("2026-09"),
    [row, setRow] = useState<Row | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [onlyReview, setOnlyReview] = useState(false);
  const reload = useCallback(async () => {
      const next = await loadPayroll();
      if (next.venueId === initial.venueId) setData(next);
    }, [initial.venueId]),
    canReview = data.permissions.includes("payroll.review");
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    setData(initial);
    setRow(null);
  }, [initial]);
  const time = useCallback(
    (s: string) =>
      new Date(s).toLocaleTimeString("ru-RU", {
        timeZone: data.timezone,
        hour: "2-digit",
        minute: "2-digit",
      }),
    [data.timezone],
  );
  const rows = useMemo(() => {
    const actual = data.attendance
      .filter((a) => a.business_date.startsWith(month))
      .map((a) => {
        const e = data.employees.find((e) => e.id === a.employee_id),
          shift = data.plannedShifts.find((s) => s.id === a.shift_id);
        return {
          id: a.id,
          employee: e?.name ?? `Quick Resto · ${a.external_id}`,
          role: a.role_name,
          date: a.business_date,
          plan: shift ? `${time(shift.starts_at)}–${time(shift.ends_at)}` : "—",
          actual: `${time(a.starts_at)}–${a.ends_at ? time(a.ends_at) : "…"}`,
          status: a.status,
          issue: a.reviewed_by ? a.review_reason : a.issue,
          attendance: a,
          plannedShift: null,
          noShow: false,
        };
      });
    const missing = data.plannedShifts
      .filter(
        (s) =>
          s.published &&
          s.user_id &&
          businessDate(
            new Date(s.starts_at),
            data.timezone,
            data.dayStartHour,
          ).startsWith(month) &&
          Date.parse(s.ends_at) < Date.now() &&
          !data.attendance.some((a) => a.shift_id === s.id),
      )
      .map((s) => {
        const date = businessDate(
            new Date(s.starts_at),
            data.timezone,
            data.dayStartHour,
          ),
          source = data.sources.find((d) => d.business_date === date),
          e = data.employees.find((e) => e.local_user_id === s.user_id),
          reviewed = data.scheduleReviews.find(
            (review) =>
              review.shift_id === s.id &&
              review.snapshot.user_id === s.user_id &&
              Date.parse(review.snapshot.starts_at) ===
                Date.parse(s.starts_at) &&
              Date.parse(review.snapshot.ends_at) === Date.parse(s.ends_at),
          );
        return {
          id: s.id,
          employee: e?.name ?? s.title,
          role: e?.role_name ?? "",
          date,
          plan: `${time(s.starts_at)}–${time(s.ends_at)}`,
          actual: "—",
          status: reviewed ? ("ignored" as const) : ("missing" as const),
          issue:
            reviewed?.reason ??
            (source?.state === "complete"
              ? "В Quick Resto нет отметки выхода"
              : "Источник ещё не проверен. Отсутствие данных не означает невыход."),
          attendance: null,
          plannedShift: s,
          noShow: !!reviewed,
        };
      });
    return [...actual, ...missing].filter(
      (r) => !onlyReview || !["confirmed", "ignored"].includes(r.status),
    );
  }, [data, month, time, onlyReview]);
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "employee",
        header: labels.employee,
        accessorKey: "employee",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.employee}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.original.role}
              {row.original.attendance?.source === "schedule"
                ? " · по графику"
                : ""}
            </p>
          </div>
        ),
      },
      {
        id: "date",
        header: labels.date,
        accessorKey: "date",
        cell: ({ row }) => row.original.date.split("-").reverse().join("."),
      },
      { id: "plan", header: labels.plan, accessorKey: "plan" },
      { id: "actual", header: labels.actual, accessorKey: "actual" },
      {
        id: "status",
        header: labels.status,
        accessorKey: "status",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
              row.original.status === "confirmed"
                ? "bg-emerald-50 text-emerald-700"
                : row.original.status === "ignored"
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-50 text-amber-700",
            )}
          >
            {row.original.noShow
              ? "Невыход подтверждён"
              : attendanceLabels[row.original.status]}
          </span>
        ),
      },
    ],
    [],
  );
  const save = async (status: string) => {
    if (!row) return;
    setBusy(true);
    try {
      if (row.attendance)
        await payrollCommand("attendance", {
          id: row.attendance.id,
          version: row.attendance.version,
          status,
          reason,
        });
      else if (row.plannedShift)
        await payrollCommand("missing_shift", {
          id: row.plannedShift.id,
          date: row.date,
          starts_at: row.plannedShift.starts_at,
          ends_at: row.plannedShift.ends_at,
          user_id: row.plannedShift.user_id,
          reason,
        });
      else return;
      await reload();
      setRow(null);
      toast.success(
        row.attendance ? "Факт выхода проверен" : "Невыход подтверждён",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось проверить выход",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <TablePageHeader
        className="flex-row items-center"
        title="Табель"
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Справка о табеле">
                <HelpCircle className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3 text-sm">
              <p>
                План берём из опубликованного графика Sheerly. Факт — из
                персональной смены Quick Resto.
              </p>
              <p>
                Отклонение — разница времени более 15 минут или неоднозначная
                связь. Незакрытые смены, выходы без графика и отсутствующие
                отметки требуют проверки.
              </p>
              <p>
                При сбое интеграции отсутствие данных не считается невыходом.
                Частичная смена не уменьшает дневную ставку автоматически.
              </p>
            </PopoverContent>
          </Popover>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DateRangeFilter
            monthOnly
            ariaLabel="Месяц табеля"
            value={{ start: new Date(`${month}-01T12:00:00`), end: null }}
            presetLabel={null}
            minDate={
              data.settings
                ? new Date(`${data.settings.starts_on}T12:00:00`)
                : undefined
            }
            onChange={(value) => {
              if (value.start)
                setMonth(
                  `${value.start.getFullYear()}-${String(value.start.getMonth() + 1).padStart(2, "0")}`,
                );
            }}
          />
          <Button
            variant={onlyReview ? "secondary" : "outline"}
            onClick={() => setOnlyReview(!onlyReview)}
          >
            На проверке
          </Button>
        </div>
        <Link href="/schedule" className="text-sm text-brand hover:underline">
          График работы →
        </Link>
      </div>
      <PayrollTable
        id={`attendance.${data.venueId}`}
        defaultSort="date"
        rows={rows}
        columns={columns}
        labels={labels}
        searchText={search}
        onRow={(r) => {
          setRow(r);
          setReason("");
        }}
        actions={
          <Button
            variant="outline"
            onClick={() => void reload().catch((e) => toast.error(e.message))}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        }
      />
      <EditDrawer
        open={!!row}
        onOpenChange={(open) => !open && setRow(null)}
        title={row?.employee ?? ""}
        description={row?.date}
        footer={
          canReview && row?.attendance ? (
            <>
              <Button
                variant="outline"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void save("ignored")}
              >
                Не учитывать
              </Button>
              <Button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void save("confirmed")}
              >
                Подтвердить выход
              </Button>
            </>
          ) : canReview && row?.plannedShift && !row.noShow ? (
            <Button
              disabled={
                busy ||
                reason.trim().length < 3 ||
                !data.sources.some(
                  (s) => s.business_date === row.date && s.state === "complete",
                )
              }
              onClick={() => void save("missing")}
            >
              Подтвердить невыход
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">План</p>
              <p className="mt-2 font-medium">{row?.plan}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Факт</p>
              <p className="mt-2 font-medium">{row?.actual}</p>
            </div>
          </div>
          <p className="rounded-lg bg-muted p-3 text-sm">
            {row?.issue ?? "Выход соответствует графику"}
          </p>
          {canReview && row && !row.noShow && (
            <div className="space-y-2">
              <Label htmlFor="attendance-reason">Основание проверки</Label>
              <Input
                id="attendance-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например, согласованная замена"
              />
            </div>
          )}
          {!row?.attendance && (
            <p className="text-sm text-muted-foreground">
              Проверьте источник и график. Плановая смена сама по себе не
              подтверждает фактический выход.
            </p>
          )}
        </div>
      </EditDrawer>
    </div>
  );
}
