"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CircleDot,
  History,
  Loader2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SalesStatusBadge } from "./sales-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/shared/date-range-filter";
import {
  ResizableTableHead,
  TableColumnManager,
  TableControlPin,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  useMultiSort,
  useTableState,
} from "@/components/shared/table";
import {
  effectiveMetrics,
  metricKeys,
  metricLabels,
  metricHints,
  type MetricKey,
  type SalesData,
  type SalesDay,
} from "@/lib/sales/types";
import { businessDate } from "@/lib/sales/time";
import { csvCell } from "@/lib/sales/csv";
import { cn } from "@/lib/utils";
import { money, dayLabel } from "@/lib/sales/format";
import { exportSalesRows, loadSales, requestSalesSync } from "../actions";
import { DayDrawer } from "./day-drawer";

const compactDate = (date: string) => date.split("-").reverse().join(".");
const dateKey = (date: Date | null) =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : null;
const hidden = new Set<MetricKey>(["hookah", "bar", "tips_total"]);
const stateColumns = [
  { id: "business_date", defaultSize: 158 },
  ...metricKeys.map((id) => ({
    id,
    defaultSize: id === "checks" ? 116 : 140,
    defaultVisible: !hidden.has(id),
  })),
  { id: "status", defaultSize: 140 },
  { id: "actions", defaultSize: 48 },
];
type SortMode = `${string}:${"asc" | "desc"}`;
const sortMap = Object.fromEntries(
  ["business_date", ...metricKeys, "status"].map((k) => [k, k]),
);
const sortCodec = {
  toField: (s: SortMode) => s.split(":")[0],
  toDirection: (s: SortMode) =>
    s.endsWith(":desc") ? ("desc" as const) : ("asc" as const),
  combine: (field: string, direction: "asc" | "desc") =>
    `${field}:${direction}` as SortMode,
};
export function ShiftsClient({ initial }: { initial: SalesData }) {
  const [data, setData] = useState(initial);
  const st = useTableState({
    tableId: `sales-shifts.${initial.venueId}`,
    columns: stateColumns,
  });
  const { setSorting, setPagination } = st;
  const today = businessDate(
    new Date(),
    initial.timezone,
    initial.settings?.day_start_hour ?? 9,
  );
  const [range, setRange] = useState<DateRangeValue>({
    start: null,
    end: null,
  });
  const [preset, setPreset] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [drawer, setDrawer] = useState<{ day: SalesDay; tab: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const can = useCallback(
    (permission: string) =>
      data.permissions.includes(`sales.${permission}_shifts`),
    [data.permissions],
  );
  useEffect(() => {
    setData(initial);
    setDrawer(null);
  }, [initial]);
  useEffect(() => {
    setSorting([{ id: "business_date", desc: true }]);
  }, [initial.venueId, setSorting]);
  const refresh = useCallback(async () => {
    try {
      setData(await loadSales());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить смены",
      );
    }
  }, []);
  const running = data.jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const currentRunning = data.jobs.some(
    (j) =>
      j.business_date === today &&
      (j.status === "queued" || j.status === "running"),
  );
  const awaitingHistory = data.days.filter(
    (d) => d.status === "imported",
  ).length;
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      running ? 10000 : 60000,
    );
    return () => clearInterval(timer);
  }, [running, refresh]);
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [range, filter, st.search, setPagination]);
  const filtered = useMemo(() => {
    const from = dateKey(range.start),
      to = dateKey(range.end),
      query = st.search.toLowerCase().trim();
    return data.days.filter(
      (d) =>
        (!from || d.business_date >= from) &&
        (!to || d.business_date <= to) &&
        (!query ||
          `${compactDate(d.business_date)} ${dayLabel(d.business_date)} ${d.note}`
            .toLowerCase()
            .includes(query)) &&
        (filter === "all" ||
          (filter === "adjusted" && Object.keys(d.overrides).length > 0) ||
          (filter === "error" && !!d.sync_error) ||
          d.status === filter),
    );
  }, [data.days, range, filter, st.search]);
  const sync = useCallback(
    async (dates: string[]) => {
      setBusy(true);
      try {
        const n = await requestSalesSync(dates);
        toast.success(
          `${n === 1 ? "Смена поставлена" : "Смены поставлены"} на обновление`,
        );
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Ошибка обновления");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  const cols = useMemo<ColumnDef<SalesDay>[]>(
    () => [
      {
        id: "business_date",
        accessorKey: "business_date",
        header: "Дата",
        size: 158,
        minSize: 125,
        cell: ({ row }) => (
          <button
            className="flex flex-col text-left hover:text-brand"
            onClick={() => setDrawer({ day: row.original, tab: "values" })}
          >
            <span className="flex items-center gap-2 font-medium">
              {compactDate(row.original.business_date)}
              {row.original.business_date === today && (
                <span
                  title={`Текущая смена${row.original.synced_at ? ` · Обновлено ${new Date(row.original.synced_at).toLocaleString("ru-RU", { timeZone: data.timezone })}` : " · Ещё не обновлялась"}`}
                  aria-label="Текущая смена"
                  className="text-brand"
                >
                  {currentRunning ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CircleDot className="size-3.5" />
                  )}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(
                `${row.original.business_date}T12:00:00`,
              ).toLocaleDateString("ru-RU", { weekday: "long" })}
            </span>
          </button>
        ),
      },
      ...metricKeys.map((k) => ({
        id: k,
        accessorFn: (d: SalesDay) => effectiveMetrics(d)[k] ?? undefined,
        header: k === "checks" ? "Чеков" : metricLabels[k],
        size: 140,
        minSize: 105,
        sortUndefined: "last" as const,
        cell: ({ row }: { row: { original: SalesDay } }) => (
          <span
            title={
              k in row.original.overrides
                ? `Исправлено вручную. Исходное: ${money(row.original.calculated[k] ?? null)}`
                : metricHints[k]
            }
            className="inline-flex items-center justify-end gap-1.5 tabular-nums"
          >
            {k in row.original.overrides && (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                aria-label="Ручная корректировка"
              />
            )}
            {money(effectiveMetrics(row.original)[k])}
          </span>
        ),
      })),
      {
        id: "status",
        accessorKey: "status",
        header: "Статус",
        size: 140,
        minSize: 115,
        cell: ({ row }) => (
          <SalesStatusBadge
            status={row.original.sync_error ? "error" : row.original.status}
            title={row.original.sync_error ?? undefined}
          />
        ),
      },
      {
        id: "actions",
        size: 48,
        minSize: 48,
        enableResizing: false,
        cell: ({ row }) => (
          <TableRowMenu
            actions={[
              {
                label: can("adjust")
                  ? "Изменить показатели"
                  : "Посмотреть показатели",
                icon: <Pencil />,
                onSelect: () => setDrawer({ day: row.original, tab: "values" }),
              },
              {
                label: "История изменений",
                icon: <History />,
                onSelect: () =>
                  setDrawer({ day: row.original, tab: "history" }),
              },
              ...(can("sync")
                ? [
                    {
                      label: "Обновить из Quick Resto",
                      icon: <RefreshCw />,
                      onSelect: () => void sync([row.original.business_date]),
                      disabled: busy || running || !data.connected,
                    },
                  ]
                : []),
            ]}
          />
        ),
      },
    ],
    [
      can,
      sync,
      busy,
      running,
      currentRunning,
      today,
      data.connected,
      data.timezone,
    ],
  );
  const table = useReactTable({
    data: filtered,
    columns: cols,
    getRowId: (d) => d.id,
    state: {
      sorting: st.sorting,
      columnVisibility: st.columnVisibility,
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
      pagination: st.pagination,
    },
    onSortingChange: st.setSorting,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnOrderChange: st.setColumnOrder,
    onColumnSizingChange: st.setColumnSizing,
    onPaginationChange: st.setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode: "onChange",
    autoResetPageIndex: false,
  });
  const multi = useMultiSort({
    sorts: st.sorting.map(
      (s) => `${s.id}:${s.desc ? "desc" : "asc"}` as SortMode,
    ),
    onChange: (ss) =>
      st.setSorting(
        ss.map((s) => ({
          id: sortCodec.toField(s),
          desc: sortCodec.toDirection(s) === "desc",
        })),
      ),
    columnToField: sortMap,
    codec: sortCodec,
  });
  const totals = useMemo(
    () =>
      Object.fromEntries(
        metricKeys.map((k) => {
          const values = filtered
            .map((d) => effectiveMetrics(d)[k])
            .filter((v): v is number => v !== null);
          return [
            k,
            {
              value: values.length ? values.reduce((a, b) => a + b, 0) : null,
              partial: values.length < filtered.length,
              known: values.length,
            },
          ];
        }),
      ) as Record<
        MetricKey,
        { value: number | null; partial: boolean; known: number }
      >,
    [filtered],
  );
  const download = async () => {
    setExporting(true);
    try {
      const sorted = table.getSortedRowModel().rows;
      const records = await exportSalesRows(sorted.map((r) => r.id));
      const map = new Map(records.map((r) => [r.id, r]));
      const visible = table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== "actions");
      const lines = [
        visible.map((c) =>
          c.id === "business_date"
            ? "Дата"
            : c.id === "status"
              ? "Статус"
              : metricLabels[c.id as MetricKey],
        ),
        ...sorted.map((r) => {
          const d = map.get(r.id);
          if (!d) throw new Error("Данные изменились. Обновите таблицу");
          return visible.map((c) =>
            c.id === "business_date"
              ? compactDate(d.business_date)
              : c.id === "status"
                ? d.status === "complete"
                  ? "Завершена"
                  : d.status === "preliminary"
                    ? "Предварительно"
                    : "Ожидает пересчёта"
                : effectiveMetrics(d)[c.id as MetricKey],
          );
        }),
      ];
      const url = URL.createObjectURL(
        new Blob(
          ["\uFEFF" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Смены-${dateKey(range.start) ?? "все"}-${dateKey(range.end) ?? today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выгрузить файл");
    } finally {
      setExporting(false);
    }
  };
  const filterNames: Record<string, string> = {
    all: "Все смены",
    preliminary: "Предварительные",
    complete: "Завершённые",
    imported: "Ожидают пересчёта",
    adjusted: "С исправлениями",
    error: "С ошибками",
  };
  return (
    <div className="space-y-5 px-4 pb-8 md:px-6" key={initial.venueId}>
      <TablePageHeader title="Смены" />
      {!data.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 text-muted-foreground" />
            Подключите Quick Resto, чтобы обновлять показатели смен.
          </span>
          {can("configure") && (
            <Button variant="link" size="sm" asChild>
              <Link href="/settings/integrations">Подключить</Link>
            </Button>
          )}
        </div>
      )}
      {running && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {awaitingHistory
            ? `Идёт пересчёт истории. Осталось дней: ${awaitingHistory}.`
            : "Обновляем показатели смен."}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <TableControls
          search={{
            value: st.search,
            onChange: st.setSearch,
            open: st.searchOpen,
            onOpenChange: st.setSearchOpen,
            placeholder: "Дата или комментарий",
          }}
          filters={{
            active:
              filtersOpen || filter !== "all" || !!range.start || !!range.end,
            onClick: () => setFiltersOpen(!filtersOpen),
          }}
          sort={{
            active: st.sorting.length > 0,
            content: (
              <div className="space-y-1 p-2">
                <p className="pb-2 text-xs text-muted-foreground">
                  Нажмите на поле, чтобы добавить сортировку или изменить
                  направление.
                </p>
                {Object.keys(sortMap).map((k) => (
                  <button
                    key={k}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => multi.cycleSort(k)}
                  >
                    {k === "business_date"
                      ? "Дата"
                      : k === "status"
                        ? "Статус"
                        : metricLabels[k as MetricKey]}
                    {multi.headerIndicator(k)}
                  </button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => st.setSorting([])}
                >
                  Сбросить сортировку
                </Button>
              </div>
            ),
          }}
          columns={{
            content: (
              <TableColumnManager
                columns={table
                  .getAllLeafColumns()
                  .filter((c) => c.id !== "actions")
                  .map((c) => ({
                    id: c.id,
                    label:
                      c.id === "business_date"
                        ? "Дата"
                        : c.id === "status"
                          ? "Статус"
                          : metricLabels[c.id as MetricKey],
                    visible: c.getIsVisible(),
                    canHide: c.id !== "business_date",
                    width: c.getSize(),
                  }))}
                onVisibilityChange={(id, v) =>
                  table.getColumn(id)?.toggleVisibility(v)
                }
                onMoveColumn={(a, b) =>
                  st.setColumnOrder((order) =>
                    arrayMove(order, order.indexOf(a), order.indexOf(b)),
                  )
                }
                onReset={st.resetColumns}
              />
            ),
          }}
          exportAction={
            can("export")
              ? {
                  label: "Экспорт CSV",
                  onClick: () => void download(),
                  disabled: !filtered.length,
                  loading: exporting,
                }
              : undefined
          }
          primaryActions={
            can("sync") ? (
              <Button
                size="sm"
                disabled={
                  busy || currentRunning || !data.connected || !data.settings
                }
                title="Обновить текущую смену из Quick Resto"
                onClick={() => void sync([today])}
              >
                {busy || currentRunning ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                Обновить
              </Button>
            ) : undefined
          }
        />
      </div>
      {(filtersOpen || filter !== "all" || range.start || range.end) && (
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            value={range}
            presetLabel={preset}
            onChange={(r, p) => {
              setRange(r);
              setPreset(p);
            }}
          />
          <TableControlPin
            label={filterNames[filter]}
            active={filter !== "all"}
            onClear={filter !== "all" ? () => setFilter("all") : undefined}
          >
            {Object.entries(filterNames).map(([id, label]) => (
              <button
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent",
                  id === filter && "bg-accent",
                )}
                key={id}
                onClick={() => setFilter(id)}
              >
                {label}
                {id === filter && <Check className="size-4" />}
              </button>
            ))}
          </TableControlPin>
        </div>
      )}
      {filtered.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-y-4 rounded-lg border px-4 py-4 sm:grid-cols-4 sm:px-5">
            {(
              ["turnover", "tips_total", "checks", "deposits"] as MetricKey[]
            ).map((k) => (
              <div
                key={k}
                className="min-w-0 sm:border-r sm:last:border-0 sm:pl-5 sm:first:pl-0"
              >
                <p className="text-xs text-muted-foreground">
                  {metricLabels[k]}
                </p>
                <p
                  title={
                    totals[k].partial
                      ? "Сумма только по сменам с известным значением"
                      : "По всем отфильтрованным сменам"
                  }
                  className="mt-1 text-xl font-semibold tabular-nums tracking-tight"
                >
                  {money(totals[k].value)}
                  {totals[k].value !== null && k !== "checks" && (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      ₽
                    </span>
                  )}
                </p>
                {totals[k].partial && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Данные по {totals[k].known} из {filtered.length} смен
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-[calc(100dvh-380px)] min-h-[240px] overflow-auto">
              <table
                className="w-full table-fixed text-sm"
                style={{
                  minWidth: Math.max(
                    680,
                    table
                      .getVisibleLeafColumns()
                      .reduce((s, c) => s + c.getSize(), 0),
                  ),
                }}
              >
                <ResizableTableHead
                  table={table}
                  isControlColumn={(id) => id === "actions"}
                  isRightAligned={(id) => metricKeys.includes(id as MetricKey)}
                  sortableColumnIds={multi.sortableColumnIds}
                  onSort={multi.cycleSort}
                  headerIndicator={multi.headerIndicator}
                  headerAriaSort={multi.headerAriaSort}
                />
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="h-16 border-b last:border-0 hover:bg-muted/40"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn(
                            "overflow-hidden px-3 py-2",
                            metricKeys.includes(cell.column.id as MetricKey) &&
                              "text-right",
                            cell.column.id === "actions" && "text-center",
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 border-t bg-muted font-medium">
                  <tr className="h-12">
                    {table.getVisibleLeafColumns().map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          "px-3 py-3",
                          metricKeys.includes(c.id as MetricKey) &&
                            "text-right tabular-nums",
                        )}
                      >
                        {c.id === "business_date" ? (
                          <span>Итого · {filtered.length}</span>
                        ) : metricKeys.includes(c.id as MetricKey) ? (
                          <span
                            title={
                              totals[c.id as MetricKey].partial
                                ? "Не во всех сменах есть данные"
                                : undefined
                            }
                          >
                            {money(totals[c.id as MetricKey].value)}
                            {totals[c.id as MetricKey].partial && (
                              <span className="block text-[10px] font-normal text-muted-foreground">
                                {totals[c.id as MetricKey].known} из{" "}
                                {filtered.length} смен
                              </span>
                            )}
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filtered.length}
            hiddenCount={data.days.length - filtered.length}
            onPageChange={(p) =>
              st.setPagination((x) => ({ ...x, pageIndex: p }))
            }
            onPageSizeChange={(size) =>
              st.setPagination({ pageIndex: 0, pageSize: size })
            }
          />
        </>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title={
            data.days.length
              ? "Нет смен за выбранный период"
              : "Начните с истории смен"
          }
          description={
            data.days.length
              ? "Выберите другой период или сбросьте фильтры."
              : "Подключите Quick Resto и настройте расчёт смен в карточке заведения."
          }
          action={
            data.days.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  setRange({ start: null, end: null });
                  setPreset("Все время");
                  setFilter("all");
                  st.setSearch("");
                }}
              >
                Показать все смены
              </Button>
            ) : can("configure") ? (
              <Button variant="outline" asChild>
                <Link href={`/org/venues/${data.venueId}`}>
                  Настройки заведения
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}
      {drawer && (
        <DayDrawer
          key={drawer.day.id}
          day={drawer.day}
          tab={drawer.tab}
          canAdjust={can("adjust")}
          open
          onClose={() => setDrawer(null)}
          onSaved={(d) => {
            setData((x) => ({
              ...x,
              days: x.days.map((r) => (r.id === d.id ? d : r)),
            }));
            setDrawer(null);
          }}
        />
      )}
    </div>
  );
}
