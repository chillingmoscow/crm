"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizableTableHead,
  TableColumnManager,
  TableControls,
  TablePageHeader,
  useMultiSort,
  useTableState,
} from "@/components/shared/table";
import {
  aggregateSalesMonths,
  monthBounds,
  sumSalesMetric,
  type MetricTotal,
  type SalesMonth,
} from "@/lib/sales/monthly";
import {
  metricHints,
  metricLabels,
  type MetricKey,
  type SalesData,
} from "@/lib/sales/types";
import { money } from "@/lib/sales/format";
import { csvCell } from "@/lib/sales/csv";
import { cn } from "@/lib/utils";
import { PageFrame } from "@/components/shared/page-frame";
import { exportSalesRows, loadSales } from "../shifts/actions";

const keys = [
  "turnover",
  "hookah",
  "bar",
  "tips_total",
  "parking",
  "taxi",
  "checks",
  "staff_checks",
  "deposits",
] as const;
const labels: Record<string, string> = {
  month: "Месяц",
  shifts: "Смены",
  ...metricLabels,
  hookahShare: "Доля кальянов",
  barShare: "Доля бара",
  perShift: "Оборот за смену",
};
const stateColumns = [
  { id: "month", defaultSize: 185 },
  { id: "shifts", defaultSize: 95 },
  ...keys.map((id) => ({
    id,
    defaultSize: 145,
    defaultVisible: !["taxi", "staff_checks", "deposits"].includes(id),
  })),
  ...["hookahShare", "barShare", "perShift"].map((id) => ({
    id,
    defaultSize: 155,
    defaultVisible: id === "perShift",
  })),
];
const sortMap = Object.fromEntries(stateColumns.map((c) => [c.id, c.id]));
type SortMode = `${string}:${"asc" | "desc"}`;
const codec = {
  toField: (s: SortMode) => s.split(":")[0],
  toDirection: (s: SortMode) =>
    s.endsWith(":desc") ? ("desc" as const) : ("asc" as const),
  combine: (field: string, direction: "asc" | "desc") =>
    `${field}:${direction}` as SortMode,
};
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
const shiftHref = (month: string) => {
  const b = monthBounds(month);
  return `/sales/shifts?from=${b.from}&to=${b.to}`;
};

function Amount({
  total,
  unit = true,
}: {
  total: MetricTotal;
  unit?: boolean;
}) {
  return (
    <span
      className="inline-flex flex-col items-end tabular-nums"
      title={
        total.known < total.total
          ? "Сумма по сменам с известным значением"
          : undefined
      }
    >
      <span>
        {money(total.value)}
        {unit && total.value !== null && (
          <span className="ml-1 text-muted-foreground">₽</span>
        )}
      </span>
      {total.known < total.total && (
        <span className="text-xs text-muted-foreground">
          {total.known} из {total.total} смен
        </span>
      )}
    </span>
  );
}

export function StatisticsClient({ initial }: { initial: SalesData }) {
  const [data, setData] = useState(initial);
  const months = useMemo(() => aggregateSalesMonths(data.days), [data.days]);
  const [year, setYear] = useState(months[0]?.month.slice(0, 4) ?? "all");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const st = useTableState({
    tableId: `sales-statistics.${initial.venueId}`,
    columns: stateColumns,
  });
  // The input already has newest months first. Keep that natural order out of
  // explicit sorting, so the first chosen column can actually become primary.
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))];
  const rows = useMemo(
    () =>
      months.filter(
        (m) =>
          (year === "all" || m.month.startsWith(year)) &&
          monthLabel(m.month)
            .toLowerCase()
            .includes(st.search.toLowerCase().trim()),
      ),
    [months, year, st.search],
  );
  const visibleMonths = new Set(rows.map((r) => r.month));
  const days = data.days.filter((d) =>
    visibleMonths.has(d.business_date.slice(0, 7)),
  );
  const columns = useMemo<ColumnDef<SalesMonth>[]>(
    () => [
      {
        id: "month",
        accessorKey: "month",
        header: labels.month,
        size: 185,
        minSize: 160,
        cell: ({ row }) => (
          <Link
            href={shiftHref(row.original.month)}
            className="group inline-flex flex-col text-left outline-offset-4 focus-visible:outline focus-visible:outline-brand"
          >
            <span className="font-medium capitalize group-hover:text-brand">
              {monthLabel(row.original.month)}
            </span>
            {row.original.preliminary > 0 && (
              <span className="text-xs text-muted-foreground">
                Предварительных смен: {row.original.preliminary}
              </span>
            )}
            {row.original.errors > 0 && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Ошибок обновления: {row.original.errors}
              </span>
            )}
          </Link>
        ),
      },
      { id: "shifts", accessorKey: "shifts", header: labels.shifts, size: 95 },
      ...keys.map(
        (key): ColumnDef<SalesMonth> => ({
          id: key,
          accessorFn: (r) => r.totals[key].value ?? undefined,
          sortUndefined: "last",
          header: labels[key],
          size: 145,
          cell: ({ row }) => (
            <Amount total={row.original.totals[key]} unit={key !== "checks"} />
          ),
        }),
      ),
      ...(["hookahShare", "barShare", "perShift"] as const).map(
        (key): ColumnDef<SalesMonth> => ({
          id: key,
          accessorFn: (r) => r[key] ?? undefined,
          sortUndefined: "last",
          header: labels[key],
          size: 155,
          cell: ({ row }) => (
            <span
              title={
                key === "perShift"
                  ? `По ${row.original.totals.turnover.known} сменам с известным оборотом`
                  : "Доля в обороте; только при полной базе показателей за месяц"
              }
            >
              {money(row.original[key])}
              {row.original[key] !== null
                ? key === "perShift"
                  ? " ₽"
                  : "%"
                : ""}
            </span>
          ),
        }),
      ),
    ],
    [],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.month,
    state: {
      sorting: st.sorting,
      columnOrder: st.columnOrder,
      columnVisibility: st.columnVisibility,
      columnSizing: st.columnSizing,
    },
    onSortingChange: st.setSorting,
    onColumnOrderChange: st.setColumnOrder,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange",
  });
  const multi = useMultiSort({
    sorts: st.sorting.map(
      (s) => `${s.id}:${s.desc ? "desc" : "asc"}` as SortMode,
    ),
    onChange: (values) =>
      st.setSorting(
        values.map((v) => ({
          id: codec.toField(v),
          desc: codec.toDirection(v) === "desc",
        })),
      ),
    columnToField: sortMap,
    codec,
  });
  async function refresh() {
    setBusy(true);
    try {
      const next = await loadSales();
      if (next.venueId !== initial.venueId)
        throw new Error("Заведение изменилось. Обновите страницу");
      setData(next);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось загрузить статистику",
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setExporting(true);
    try {
      const fresh = await exportSalesRows(days.map((d) => d.id));
      if (fresh.length !== days.length)
        throw new Error("Данные изменились. Обновите статистику");
      const map = new Map(aggregateSalesMonths(fresh).map((r) => [r.month, r]));
      const cols = table.getVisibleLeafColumns();
      const lines: unknown[][] = [
        cols.flatMap((c) =>
          keys.includes(c.id as (typeof keys)[number])
            ? [
                labels[c.id],
                `${labels[c.id]}: смен с данными`,
                `${labels[c.id]}: всего смен`,
              ]
            : [labels[c.id]],
        ),
      ];
      for (const row of table.getSortedRowModel().rows) {
        const r = map.get(row.original.month);
        if (!r) throw new Error("Данные изменились. Обновите статистику");
        lines.push(
          cols.flatMap((c) => {
            if (keys.includes(c.id as (typeof keys)[number])) {
              const t = r.totals[c.id as MetricKey];
              return [t.value, t.known, t.total];
            }
            return [
              c.id === "month"
                ? monthLabel(r.month)
                : r[c.id as "shifts" | "hookahShare" | "barShare" | "perShift"],
            ];
          }),
        );
      }
      const url = URL.createObjectURL(
        new Blob(
          ["\uFEFF" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Статистика-${year === "all" ? "все-годы" : year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выгрузить статистику",
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <PageFrame className="space-y-6">
      <TablePageHeader title="Статистика" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-36" aria-label="Год статистики">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все годы</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={y}>
                {y} год
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TableControls
          search={{
            value: st.search,
            onChange: st.setSearch,
            open: st.searchOpen,
            onOpenChange: st.setSearchOpen,
            placeholder: "Месяц или год",
          }}
          sort={{
            active: st.sorting.length > 0,
            content: (
              <div className="space-y-1 p-2">
                {stateColumns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-muted"
                    onClick={() => multi.cycleSort(c.id)}
                  >
                    {labels[c.id]}
                    {multi.headerIndicator(c.id)}
                  </button>
                ))}
                <Button
                  className="w-full"
                  size="sm"
                  variant="ghost"
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
                  .map((c) => ({
                    id: c.id,
                    label: labels[c.id],
                    visible: c.getIsVisible(),
                    canHide: c.id !== "month",
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
            data.permissions.includes("sales.export_shifts")
              ? {
                  label: "Экспорт CSV",
                  onClick: () => void download(),
                  disabled: !rows.length,
                  loading: exporting,
                }
              : undefined
          }
          secondaryActions={
            <Button
              variant="outline"
              size="icon"
              aria-label="Обновить статистику"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  busy && "animate-spin motion-reduce:animate-none",
                )}
              />
            </Button>
          }
        />
      </div>
      {rows.length ? (
        <>
          <section
            aria-label="Итоги статистики"
            className="grid grid-cols-2 gap-y-5 rounded-xl border py-5 sm:grid-cols-4"
          >
            {(
              ["turnover", "tips_total", "parking", "checks"] as MetricKey[]
            ).map((key) => {
              const total = sumSalesMetric(days, key);
              return (
                <div
                  key={key}
                  className="min-w-0 px-5 sm:border-r sm:last:border-0"
                >
                  <p
                    className="text-sm text-muted-foreground"
                    title={metricHints[key]}
                  >
                    {metricLabels[key]}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                    {money(total.value)}
                    {key !== "checks" && total.value !== null && (
                      <span className="ml-1 text-base font-normal text-muted-foreground">
                        ₽
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {total.known < total.total
                      ? `Данные по ${total.known} из ${total.total} смен`
                      : `${days.length} смен за выбранный период`}
                  </p>
                </div>
              );
            })}
          </section>
          <div className="overflow-hidden rounded-xl border">
            <div className="max-h-[calc(100dvh-360px)] min-h-64 overflow-auto">
              <table
                aria-label="Статистика продаж по месяцам"
                className="w-full table-fixed text-sm"
                style={{ minWidth: Math.max(680, table.getTotalSize()) }}
              >
                <ResizableTableHead
                  table={table}
                  isControlColumn={() => false}
                  isRightAligned={(id) => id !== "month"}
                  sortableColumnIds={multi.sortableColumnIds}
                  onSort={multi.cycleSort}
                  headerIndicator={multi.headerIndicator}
                  headerAriaSort={multi.headerAriaSort}
                />
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="h-20 border-b last:border-0 hover:bg-muted/40"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-3 py-3 tabular-nums",
                            cell.column.id !== "month" && "text-right",
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
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Месяц открывает исходные смены. Ручные исправления учтены. Чеки
            включают сотрудников; прочерк означает отсутствие данных.
          </p>
        </>
      ) : (
        <EmptyState
          icon={ChartNoAxesCombined}
          title={
            data.days.length
              ? "Месяцы не найдены"
              : "Статистика появится после загрузки смен"
          }
          description={
            data.days.length
              ? "Измените год или поисковый запрос."
              : "Загрузите данные в разделе «Продажи → Смены»."
          }
          action={
            <Button variant="outline" asChild>
              <Link href="/sales/shifts">Перейти к сменам</Link>
            </Button>
          }
        />
      )}
    </PageFrame>
  );
}
