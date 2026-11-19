"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Minus,
  PenLine,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { PersonAvatar } from "@/components/people/person-avatar";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import { TableBulkBar, TableIconButton } from "@/components/shared/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryItem,
} from "@/components/ui/drawer-blocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { attendanceLabels, type PayrollData } from "@/lib/payroll/types";
import {
  attendanceDecisionBlock,
  attendanceReviewRows,
  needsAttendanceReview,
  type AttendanceDecision,
  type AttendanceReviewRow,
} from "@/lib/payroll/attendance-review-rows";
import {
  reviewAttendanceDecisions,
  type AttendanceDecisionInput,
} from "../actions";
import { PayrollTable } from "./payroll-table";

const labels = {
  employee: "Сотрудник",
  date: "Рабочий день",
  plan: "План",
  actual: "Учтённое время",
  status: "Состояние",
};
type Row = AttendanceReviewRow;
type Pending = { rows: Row[]; decision: AttendanceDecision };
const search = (r: Row) => `${r.employee} ${r.role} ${r.date}`;
const formatDay = (date: string) => date.split("-").reverse().join(".");

const decisionLabel: Record<AttendanceDecision, string> = {
  confirm: "Подтвердить",
  ignore: "Не учитывать",
};

/** Готовые основания: самые частые случаи, чтобы не печатать одно и то же. */
function presets(rows: Row[], decision: AttendanceDecision): string[] {
  const kinds = new Set(
    rows.map((row) =>
      row.plannedShift ? "shift" : row.status === "unplanned" ? "unplanned" : "mark",
    ),
  );
  const kind = kinds.size === 1 ? [...kinds][0] : "mixed";
  if (decision === "confirm")
    return kind === "shift"
      ? ["Работа без отметки в Quick Resto"]
      : kind === "unplanned"
        ? ["Выход на замену", "Подработка вне графика, согласовано", "Смену не внесли в график"]
        : ["Проверено, выход верный"];
  return kind === "shift"
    ? ["Невыход на смену", "Смена отменена"]
    : kind === "mixed"
      ? ["Выхода в этот день не было"]
      : ["Ошибочная отметка", "Выхода в этот день не было"];
}

/** Что значит строка для зарплаты и что с ней сделать. */
function explanation(row: Row): string {
  if (row.awaitingSource)
    return "Данные Quick Resto за этот день ещё не получены. Отсутствие данных не означает невыход: решение станет доступно после загрузки.";
  if (row.noShow) return "Невыход подтверждён: смена не оплачивается.";
  if (row.plannedShift)
    return row.status === "confirmed"
      ? "Выход засчитан по графику и оплачивается."
      : "Смена в графике есть, а отметки в Quick Resto нет. Пока решения нет, смена не оплачивается. Подтвердите выход, если сотрудник работал, или «Не учитывать», если он не вышел.";
  const a = row.attendance;
  if (!a) return "";
  if (a.status === "ignored") return "Отметка исключена: выход не оплачивается.";
  if (a.status === "confirmed")
    return a.reviewed_by
      ? "Выход подтверждён и оплачивается."
      : "Отметка совпала с графиком, выход оплачивается.";
  if (a.status === "unplanned")
    return "В Quick Resto есть отметка, а смены в опубликованном графике нет. Выход уже идёт в зарплату. Подтвердите его, если это замена или подработка, или «Не учитывать», если отметка ошибочная.";
  if (a.status === "unlinked")
    return "Сотрудник Quick Resto не связан с сотрудником в Sheerly, поэтому начисление за день ждёт. Свяжите его в карточке сотрудника: отметка пересчитается сама.";
  if (a.status === "open" || !a.ends_at)
    return "Смена в Quick Resto не закрыта, поэтому начисление за день ждёт. Закройте смену на кассе: отметка обновится сама. Если отметка ошибочная, выберите «Не учитывать».";
  return a.issue?.includes("границ")
    ? "Отметка выходит за границы рабочего дня, поэтому начисление ждёт решения. Подтвердите выход, если сотрудник работал, или «Не учитывать»."
    : "К отметке подходит несколько смен в графике. Выход оплачивается; подтвердите его или «Не учитывать», если отметка ошибочная.";
}

function statusView(row: Row): { label: string; tone: StatusTone } {
  if (row.noShow) return { label: "Невыход подтверждён", tone: "neutral" };
  if (row.awaitingSource) return { label: "Ожидаем данные", tone: "neutral" };
  if (row.plannedShift && row.status === "confirmed")
    return { label: "Засчитана", tone: "success" };
  return {
    label: attendanceLabels[row.status],
    tone:
      row.status === "confirmed"
        ? "success"
        : row.status === "ignored"
          ? "neutral"
          : "warning",
  };
}

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
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingReason, setPendingReason] = useState("");
  const [pendingError, setPendingError] = useState<string | null>(null);
  const period = data.periods.find((period) => period.month === `${month}-01`);
  const canReview =
    data.permissions.includes("payroll.review") &&
    (!period || period.status === "draft");
  const ctx = useMemo(
    () => ({ canReviewSchedule: data.permissions.includes("schedule.view_all") }),
    [data.permissions],
  );
  const blockOf = useCallback(
    (r: Row, decision: AttendanceDecision) => attendanceDecisionBlock(r, decision, ctx),
    [ctx],
  );
  const decidable = useCallback(
    (r: Row) =>
      canReview &&
      needsAttendanceReview(r) &&
      (!blockOf(r, "confirm") || !blockOf(r, "ignore")),
    [canReview, blockOf],
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
  const selectedRows = rows.filter((r) => selection[r.id] && decidable(r));

  const item = useCallback(
    (r: Row): AttendanceDecisionInput["items"][number] | null => {
      if (r.attendance)
        return { kind: "attendance", id: r.attendance.id, version: r.attendance.version };
      const shift = r.plannedShift;
      const synced = data.sources.find((s) => s.business_date === r.date)?.synced_at;
      if (!shift?.user_id || !synced) return null;
      return {
        kind: "shift",
        id: shift.id,
        version: shift.version,
        synced_at: synced,
        date: r.date,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        user_id: shift.user_id,
      };
    },
    [data.sources],
  );

  /** Сохраняет решение; возвращает текст ошибки, если хотя бы одна строка не прошла. */
  const decide = useCallback(
    async (targets: Row[], decision: AttendanceDecision, text: string) => {
      const items = targets.flatMap((r) => {
        const value = item(r);
        return value ? [value] : [];
      });
      if (!items.length) return "Нет строк, по которым можно принять это решение";
      const result = await reviewAttendanceDecisions({ decision, reason: text, items });
      if (result.done.length) {
        setSelection((current) => {
          const next = { ...current };
          // Не прошедшие строки остаются выбранными: их можно повторить.
          for (const id of result.done) delete next[id];
          return next;
        });
        await onRefresh().catch(() => undefined);
        const done = result.done.length;
        if (!result.warning) toast.success(
          done === 1
            ? decision === "confirm"
              ? "Выход подтверждён. Начисления пересчитываются."
              : "Выход не учитывается. Начисления пересчитываются."
            : `Решение принято по ${done} выходам. Начисления пересчитываются.`,
        );
      }
      if (result.warning) toast.warning(result.warning);
      if (!result.failed.length) return null;
      const names = new Map(targets.map((r) => [r.attendance?.id ?? r.id, r]));
      return result.failed
        .map((f) => {
          const r = names.get(f.id);
          return `${r ? `${r.employee}, ${formatDay(r.date)}` : "Строка"}: ${f.message}`;
        })
        .join("\n");
    },
    [item, onRefresh],
  );

  const ask = useCallback((targets: Row[], decision: AttendanceDecision) => {
    setPending({ rows: targets, decision });
    setPendingReason("");
    setPendingError(null);
  }, []);
  const quick = useCallback(
    async (r: Row, decision: AttendanceDecision, text: string) => {
      try {
        const error = await decide([r], decision, text);
        if (error) toast.error(error);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось сохранить решение");
      }
    },
    [decide],
  );

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "employee",
        header: labels.employee,
        accessorKey: "employee",
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3">
            <PersonAvatar name={row.original.employee} src={row.original.avatar} />
            <span className="min-w-0 break-words text-left">
              <span className="block font-medium">{row.original.employee}</span>
              <span className="block text-xs text-muted-foreground">
                {row.original.role}
                {row.original.attendance?.source === "schedule" ? " · по графику" : ""}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "date",
        header: labels.date,
        accessorKey: "date",
        cell: ({ row }) => formatDay(row.original.date),
      },
      { id: "plan", header: labels.plan, accessorKey: "plan" },
      { id: "actual", header: labels.actual, accessorKey: "actual" },
      {
        id: "status",
        header: labels.status,
        accessorKey: "status",
        cell: ({ row }) => {
          const status = statusView(row.original);
          return (
            <StatusBadge tone={status.tone} tip={row.original.issue ?? undefined}>
              {status.label}
            </StatusBadge>
          );
        },
      },
      {
        id: "actions",
        size: 312,
        minSize: 312,
        maxSize: 312,
        enableHiding: false,
        enableResizing: false,
        enableSorting: false,
        cell: ({ row }) =>
          decidable(row.original) ? (
            <span className="flex justify-end gap-2">
              {(["confirm", "ignore"] as const).map((decision) => (
                <DecisionMenu
                  key={decision}
                  decision={decision}
                  block={blockOf(row.original, decision)}
                  presets={presets([row.original], decision)}
                  onPick={(text) => void quick(row.original, decision, text)}
                  onCustom={() => ask([row.original], decision)}
                />
              ))}
            </span>
          ) : canReview && needsAttendanceReview(row.original) &&
            row.original.attendance && !row.original.attendance.employee_id ? (
            <span className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href="/people/staff">Связать сотрудника</Link>
              </Button>
            </span>
          ) : null,
      },
    ],
    [ask, blockOf, canReview, decidable, quick],
  );

  const save = async (decision: AttendanceDecision) => {
    if (!row) return;
    setBusy(true);
    try {
      const error = await decide([row], decision, reason.trim());
      if (error) toast.error(error);
      else setRow(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось проверить выход");
    } finally {
      setBusy(false);
    }
  };

  const pendingTargets = pending
    ? pending.rows.filter((r) => !blockOf(r, pending.decision))
    : [];
  const skipped = pending ? pending.rows.length - pendingTargets.length : 0;
  const rowStatus = row ? statusView(row) : null;
  const drawerDecisions = row && canReview
    ? (["ignore", "confirm"] as const).filter((d) => !blockOf(row, d))
    : [];

  return (
    <div className={selectedRows.length ? "min-w-0 space-y-4 pb-28 md:pb-24" : "min-w-0 space-y-4"}>
      <div className="flex flex-wrap items-center gap-2" aria-label="Список выходов">
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
        onRow={open}
        toolbarTargetId={toolbarTargetId}
        externalSearch={{ value: query, onChange: setQuery }}
        selection={
          canReview
            ? {
                value: selection,
                onChange: setSelection,
                getRowId: (r) => r.id,
                canSelect: decidable,
                rowLabel: (r) => `Выбрать выход: ${r.employee}, ${formatDay(r.date)}`,
                pageLabel: "Выбрать все выходы на странице",
              }
            : undefined
        }
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
      {canReview ? (
        <TableBulkBar
          floating
          selectedCount={selectedRows.length}
          onClear={() => setSelection({})}
          actions={(["confirm", "ignore"] as const).map((decision) => {
            const count = selectedRows.filter((r) => !blockOf(r, decision)).length;
            return (
              <span
                key={decision}
                className="inline-flex"
                data-tip={count ? undefined : "Для выбранных выходов это решение недоступно"}
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!count}
                  onClick={() => ask(selectedRows, decision)}
                >
                  {decision === "confirm" ? <Check className="mr-2 size-4" /> : <Minus className="mr-2 size-4" />}
                  {decisionLabel[decision]}
                </Button>
              </span>
            );
          })}
        />
      ) : null}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(next) => !next && setPending(null)}
        title={
          pending?.rows.length === 1
            ? `${decisionLabel[pending.decision]} выход · ${pending.rows[0].employee}`
            : `${pending ? decisionLabel[pending.decision] : ""} выходы: ${pendingTargets.length}`
        }
        description={
          pending
            ? `${pending.decision === "confirm"
                ? "Выход будет оплачен."
                : "Выход не будет оплачен, а если отметки нет — невыход будет подтверждён."} Решение и основание попадут в журнал событий, рабочие дни пересчитаются.${
                skipped ? ` Пропустим ${skipped}: для них это решение недоступно.` : ""
              }`
            : undefined
        }
        confirmLabel={
          pending
            ? pendingTargets.length === 1
              ? decisionLabel[pending.decision]
              : `${decisionLabel[pending.decision]} (${pendingTargets.length})`
            : ""
        }
        pendingLabel="Сохраняем…"
        busy={busy}
        confirmDisabled={pendingReason.trim().length < 3 || !pendingTargets.length}
        error={pendingError ? <span className="whitespace-pre-line">{pendingError}</span> : undefined}
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          setPendingError(null);
          try {
            const error = await decide(pendingTargets, pending.decision, pendingReason.trim());
            if (error) setPendingError(error);
            else setPending(null);
          } catch (e) {
            setPendingError(e instanceof Error ? e.message : "Не удалось сохранить решение");
          } finally {
            setBusy(false);
          }
        }}
      >
        {pending ? (
          <ReasonField
            id="attendance-bulk-reason"
            value={pendingReason}
            onChange={setPendingReason}
            presets={presets(pendingTargets, pending.decision)}
            placeholder={
              pending.decision === "confirm"
                ? "Например, согласованная замена"
                : "Например, ошибочная отметка"
            }
          />
        ) : null}
      </ConfirmDialog>
      <EditDrawer
        open={!!row}
        onOpenChange={(open) => !open && setRow(null)}
        title={row?.employee ?? ""}
        titleAccessory={rowStatus ? <DrawerStatus label={rowStatus.label} tone={rowStatus.tone} /> : undefined}
        description={row ? `${formatDay(row.date)}${row.role ? ` · ${row.role}` : ""}` : undefined}
        footer={
          drawerDecisions.length ? (
            <>
              {drawerDecisions.map((decision) => (
                <Button
                  key={decision}
                  variant={decision === "confirm" ? "default" : "outline"}
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void save(decision)}
                >
                  {decision === "confirm" ? "Подтвердить выход" : "Не учитывать"}
                </Button>
              ))}
            </>
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
          {row?.issue ? (
            <p className="rounded-lg bg-muted p-3 text-sm">{row.issue}</p>
          ) : null}
          {row ? <p className="text-sm text-muted-foreground">{explanation(row)}</p> : null}
          {drawerDecisions.length ? (
            <ReasonField
              id="attendance-reason"
              value={reason}
              onChange={setReason}
              presets={[...new Set(
                [...drawerDecisions].reverse().flatMap((d) => presets([row!], d)),
              )]}
            />
          ) : null}
        </div>
      </EditDrawer>
    </div>
  );
}

/** Кнопка решения в строке: готовые основания и «Другое основание…». */
function DecisionMenu({
  decision,
  block,
  presets,
  onPick,
  onCustom,
}: {
  decision: AttendanceDecision;
  block: string | null;
  presets: string[];
  onPick: (reason: string) => void;
  onCustom: () => void;
}) {
  const button = (
    <Button variant="outline" size="sm" disabled={!!block}>
      {decisionLabel[decision]}
      <ChevronDown className="ml-1 size-4 text-muted-foreground" />
    </Button>
  );
  if (block)
    return (
      <span className="inline-flex" data-tip={block}>
        {button}
      </span>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {presets.map((text) => (
          <DropdownMenuItem key={text} onSelect={() => onPick(text)}>
            {text}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCustom}>
          <PenLine className="size-4" />
          Другое основание…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReasonField({
  id,
  value,
  onChange,
  presets,
  placeholder = "Например, согласованная замена",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  presets: string[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Основание</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {presets.length ? (
        <div className="flex flex-wrap gap-2">
          {presets.map((text) => (
            <Button
              key={text}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onChange(text)}
            >
              {text}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
