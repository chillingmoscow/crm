"use client";
import { useCallback, useMemo, useState } from "react";
import {
  CalendarClock,
  ClipboardCheck,
  Clock,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { PersonAvatar } from "@/components/people/person-avatar";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import { TableIconButton } from "@/components/shared/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSummary, DrawerSummaryItem } from "@/components/ui/drawer-blocks";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  attendanceLabels,
  type PayrollData,
} from "@/lib/payroll/types";
import {
  attendanceReviewRows,
  needsAttendanceReview,
  type AttendanceReviewRow,
} from "@/lib/payroll/attendance-review-rows";
import { payrollCommand } from "../actions";
import { PayrollTable } from "./payroll-table";

const labels = {
  employee: "Сотрудник",
  date: "Рабочий день",
  plan: "План",
  actual: "Учтённое время",
  status: "Состояние",
};
type Row = AttendanceReviewRow;
const search = (r: Row) => `${r.employee} ${r.role} ${r.date}`;
export function AttendanceReview({
  data,
  month,
  date,
  onRefresh,
  toolbarTargetId,
}: {
  data: PayrollData;
  month: string;
  date?: string;
  onRefresh: () => Promise<void>;
  toolbarTargetId: string;
}) {
  const [row, setRow] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState("review");
  const [query, setQuery] = useState("");
  const period = data.periods.find((period) => period.month === `${month}-01`);
  const canReview =
    data.permissions.includes("payroll.review") &&
    (!period || period.status === "draft");
  const canConfirmMissing =
    !!row?.plannedShift &&
    data.sources.some(
      (source) =>
        source.business_date === row.date && source.state === "complete",
    );
  const open = useCallback((record: Row) => {
    setRow(record);
    setReason("");
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось обновить выходы",
      );
    } finally {
      setRefreshing(false);
    }
  };
  const allRows = useMemo(
    () => attendanceReviewRows(data, month, date),
    [data, month, date],
  );
  const needsReview = allRows.filter(needsAttendanceReview);
  const rows = view === "review" ? needsReview : allRows;
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "employee",
        header: labels.employee,
        accessorKey: "employee",
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3">
            <PersonAvatar
              name={row.original.employee}
              src={row.original.avatar}
            />
            <button
              type="button"
              className="min-w-0 break-words text-left"
              onClick={() => open(row.original)}
            >
              <span className="block font-medium hover:text-brand">
                {row.original.employee}
              </span>
              <span className="block text-xs text-muted-foreground">
                {row.original.role}
                {row.original.attendance?.source === "schedule"
                  ? " · по графику"
                  : ""}
              </span>
            </button>
          </span>
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
          <StatusBadge
            tone={
              row.original.status === "confirmed"
                ? "success"
                : !row.original.awaitingSource &&
                    row.original.status !== "ignored"
                  ? "warning"
                  : "neutral"
            }
          >
            {row.original.noShow
              ? "Невыход подтверждён"
              : row.original.awaitingSource
                ? "Ожидаем данные"
                : attendanceLabels[row.original.status]}
          </StatusBadge>
        ),
      },
    ],
    [open],
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
      await onRefresh();
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
    <div className="min-w-0 space-y-4">
      <div
        className="flex flex-wrap items-center gap-2"
        aria-label="Список выходов"
      >
        <TableFilterChip
          label={`На проверке · ${needsReview.length}`}
          value={view === "review" ? "" : "all"}
          options={[
            { value: "", label: `На проверке · ${needsReview.length}` },
            { value: "all", label: "Все выходы" },
          ]}
          onChange={(value) => setView(value === "all" ? "all" : "review")}
        />
      </div>
      <PayrollTable
        id={`attendance.${data.venueId}`}
        label="Выходы сотрудников"
        defaultSort="date"
        rows={rows}
        columns={columns}
        labels={labels}
        searchText={search}
        toolbarTargetId={toolbarTargetId}
        externalSearch={{ value: query, onChange: setQuery }}
        actions={
          <TableIconButton
            label="Обновить выходы"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-4" />
          </TableIconButton>
        }
        empty={
          <EmptyState
            icon={query.trim() ? SearchX : ClipboardCheck}
            title={
              query.trim()
                ? "Выходы не найдены"
                : view === "review"
                  ? "Нет выходов на проверке"
                  : "Нет выходов за этот месяц"
            }
            description={
              query.trim()
                ? "Измените поисковый запрос."
                : view === "review"
                  ? "Полный список включает проверенные выходы и смены, по которым ещё ждём данные."
                  : undefined
            }
            action={
              query.trim() ? (
                <Button variant="outline" onClick={() => setQuery("")}>
                  Сбросить поиск
                </Button>
              ) : view === "review" && allRows.length > 0 ? (
                <Button variant="outline" onClick={() => setView("all")}>
                  Все выходы
                </Button>
              ) : undefined
            }
          />
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
              disabled={busy || reason.trim().length < 3 || !canConfirmMissing}
              onClick={() => void save("missing")}
            >
              Подтвердить невыход
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          <DrawerSummary label="План и факт">
            <DrawerSummaryItem icon={<CalendarClock />} label="План">
              <span className="font-medium">{row?.plan}</span>
            </DrawerSummaryItem>
            <DrawerSummaryItem icon={<Clock />} label="Факт">
              <span className="font-medium">{row?.actual}</span>
            </DrawerSummaryItem>
          </DrawerSummary>
          <p className="rounded-lg bg-muted p-3 text-sm">
            {row?.issue ?? "Выход соответствует графику"}
          </p>
          {canReview &&
            row &&
            !row.noShow &&
            (row.attendance || canConfirmMissing) && (
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
