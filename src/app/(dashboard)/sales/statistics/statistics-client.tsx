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
  monthBounds,
  sumSalesMetric,
  type MetricTotal,
  type SalesMonth,
} from "@/lib/sales/monthly";
import { metricHints, metricLabels, type MetricKey } from "@/lib/sales/types";
import { money } from "@/lib/sales/format";
import { csvCell } from "@/lib/sales/csv";
import { cn } from "@/lib/utils";
import { PageFrame } from "@/components/shared/page-frame";
import { exportSalesRows } from "../shifts/actions";
import {
  loadStatistics,
  requestStatisticsMonth,
  type StatisticsData,
} from "./actions";
import {
  combineStatisticsMonths,
  type StatisticsReport,
} from "@/lib/sales/statistics-reports";

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
  alcoholRevenue: "Алкоголь",
  regularGuests: "Постоянные гости",
  regularRevenue: "Постоянные гости, ₽",
  averageCheck: "Средний чек",
};
const reportColumns = {
  alcoholRevenue: { kind: "alcohol", field: "revenue", unit: "₽" },
  regularGuests: { kind: "regular_guests", field: "guests", unit: "" },
  regularRevenue: { kind: "regular_guests", field: "revenue", unit: "₽" },
  averageCheck: { kind: "average_check", field: "average", unit: "₽" },
} as const;
function reportMap(reports: StatisticsReport[]) {
  return new Map(reports.map((r) => [`${r.month.slice(0, 7)}:${r.kind}`, r]));
}
function reportValue(
  reports: Map<string, StatisticsReport>,
  month: string,
  column: keyof typeof reportColumns,
) {
  const c = reportColumns[column],
    r = reports.get(`${month}:${c.kind}`);
  return { report: r, value: r?.metrics?.[c.field] ?? null, unit: c.unit };
}
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
  ...Object.keys(reportColumns).map((id) => ({
    id,
    defaultSize: 165,
    defaultVisible: id !== "regularGuests",
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

export function StatisticsClient({ initial }: { initial: StatisticsData }) {
  const [data, setData] = useState(initial);
  const months = useMemo(
    () => combineStatisticsMonths(data.days, data.reports),
    [data.days, data.reports],
  );
  const reports = useMemo(() => reportMap(data.reports), [data.reports]);
  const [reportMonth, setReportMonth] = useState(months[0]?.month ?? "");
  const [reportBusy, setReportBusy] = useState(false);
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
      ...(Object.keys(reportColumns) as (keyof typeof reportColumns)[]).map(
        (key): ColumnDef<SalesMonth> => ({
          id: key,
          header: labels[key],
          accessorFn: (r) =>
            reportValue(reports, r.month, key).value ?? undefined,
          sortUndefined: "last",
          size: 165,
          cell: ({ row }) => {
            const { report, value, unit } = reportValue(
              reports,
              row.original.month,
              key,
            );
            return (
              <span
                className="inline-flex flex-col items-end tabular-nums"
                title={report?.last_error ?? undefined}
              >
                <span>
                  {money(value)}
                  {value !== null && unit && (
                    <span className="ml-1 text-muted-foreground">{unit}</span>
                  )}
                </span>
                {report?.through_date && (
                  <span className="text-xs text-muted-foreground">
                    по {report.through_date.split("-").reverse().join(".")}
                  </span>
                )}
                {report && report.state !== "ready" && (
                  <span className="text-xs text-muted-foreground">
                    {report.state === "error" ? "Не обновлено" : "Обновляется"}
                  </span>
                )}
              </span>
            );
          },
        }),
      ),
    ],
    [reports],
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
      const next = await loadStatistics();
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
  async function updateMonthReports() {
    setReportBusy(true);
    try {
      await requestStatisticsMonth(reportMonth, initial.venueId);
      const next = await loadStatistics();
      if (next.venueId !== initial.venueId)
        throw new Error("Заведение изменилось. Обновите страницу");
      setData(next);
      toast.success("Месячные отчёты запрошены");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обновить отчёты",
      );
    } finally {
      setReportBusy(false);
    }
  }
  async function download() {
    setExporting(true);
    try {
      const fresh = await exportSalesRows(days.map((d) => d.id));
      if (fresh.length !== days.length)
        throw new Error("Данные изменились. Обновите статистику");
      const snapshot = await loadStatistics();
      if (snapshot.venueId !== initial.venueId)
        throw new Error("Заведение изменилось. Обновите страницу");
      const freshReports = reportMap(snapshot.reports);
      const map = new Map(
        combineStatisticsMonths(fresh, snapshot.reports).map((r) => [
          r.month,
          r,
        ]),
      );
      const cols = table.getVisibleLeafColumns();
      const lines: unknown[][] = [
        cols.flatMap((c) =>
          keys.includes(c.id as (typeof keys)[number])
            ? [
                labels[c.id],
                `${labels[c.id]}: смен с данными`,
                `${labels[c.id]}: всего смен`,
              ]
            : c.id in reportColumns
              ? [
                  labels[c.id],
                  `${labels[c.id]}: по дату`,
                  `${labels[c.id]}: обновлено`,
                  `${labels[c.id]}: состояние`,
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
            if (c.id in reportColumns) {
              const value = reportValue(
                freshReports,
                r.month,
                c.id as keyof typeof reportColumns,
              );
              return [
                value.value,
                value.report?.through_date ?? null,
                value.report?.synced_at ?? null,
                value.report
                  ? {
                      ready: "Обновлено",
                      pending: "Ожидает обновления",
                      running: "Обновляется",
                      error: "Не обновлено",
                    }[value.report.state]
                  : "Нет данных",
              ];
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
                columns={table.getAllLeafColumns().map((c) => ({
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
      {data.reportsConfigured &&
        data.permissions.includes("sales.sync_shifts") && (
          <div className="flex flex-wrap items-center gap-3">
            <Select value={reportMonth} onValueChange={setReportMonth}>
              <SelectTrigger
                className="w-52"
                aria-label="Месяц отчётов Quick Resto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.month} value={m.month}>
                    {monthLabel(m.month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={reportBusy || !reportMonth}
              onClick={() => void updateMonthReports()}
            >
              {reportBusy ? "Загрузка…" : "Обновить отчёты Quick Resto"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Алкоголь, постоянные гости и средний чек — по завершённым рабочим
              дням.
            </p>
          </div>
        )}
      {!data.reportsConfigured && (
        <p className="text-sm text-muted-foreground">
          Дополнительные отчёты Quick Resto ещё не подключены.
        </p>
      )}
      {data.reports.some((r) => r.state === "error") && (
        <details className="rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Не обновились отчёты ·{" "}
            {data.reports.filter((r) => r.state === "error").length}
          </summary>
          <ul className="mt-3 space-y-2 text-muted-foreground">
            {data.reports
              .filter((r) => r.state === "error")
              .map((r) => (
                <li key={r.id}>
                  {monthLabel(r.month.slice(0, 7))} ·{" "}
                  {r.kind === "alcohol"
                    ? "Алкоголь"
                    : r.kind === "regular_guests"
                      ? "Постоянные гости"
                      : "Средний чек"}
                  : {r.last_error}
                </li>
              ))}
          </ul>
        </details>
      )}
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
