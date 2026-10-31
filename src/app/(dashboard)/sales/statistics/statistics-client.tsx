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
import { EditDrawer } from "@/components/ui/edit-drawer";
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
import { PageFrame } from "@/components/shared/page-frame";
import { monthBounds } from "@/lib/sales/monthly";
import { metricLabels } from "@/lib/sales/types";
import { money } from "@/lib/sales/format";
import { csvCell } from "@/lib/sales/csv";
import {
  buildStatisticsRows,
  type StatisticsRow,
  type StatisticsValue,
} from "@/lib/sales/statistics-view";
import { cn } from "@/lib/utils";
import {
  loadStatistics,
  exportStatistics,
  requestStatisticsMonth,
  type StatisticsData,
} from "./actions";
import { StatisticsChart } from "./statistics-chart";

const labels: Record<string, string> = {
  month: "Месяц",
  shifts: "Смены",
  ...metricLabels,
  tips_total: "Чаевые",
  hookahShare: "Доля кальянов",
  barShare: "Доля бара",
  perShift: "Оборот за смену",
  alcoholRevenue: "Алкоголь",
  alcoholShare: "Доля алкоголя",
  regularGuests: "Постоянные гости",
  regularRevenue: "Постоянные гости, ₽",
  regularShare: "Доля постоянных гостей",
  averageCheck: "Средний чек",
  food: "Питание",
  payroll: "ФОТ",
  mastersSales: "Продажи мастеров",
};
const defaultColumns = [
  "month",
  "turnover",
  "hookahShare",
  "barShare",
  "tips_total",
  "parking",
  "perShift",
  "averageCheck",
];
const stateColumns = [
  ...defaultColumns,
  "shifts",
  "hookah",
  "bar",
  "alcoholRevenue",
  "alcoholShare",
  "regularGuests",
  "regularRevenue",
  "regularShare",
  "taxi",
  "checks",
  "staff_checks",
  "deposits",
  "food",
  "payroll",
  "mastersSales",
].map((id) => ({
  id,
  defaultSize: id === "month" ? 190 : 155,
  defaultVisible: defaultColumns.includes(id),
}));
const unit = (key: string) =>
  ["shifts", "checks", "regularGuests"].includes(key)
    ? ""
    : key.endsWith("Share")
      ? "%"
      : "₽";
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(
    new Date(date),
  );
const shiftHref = (month: string) => {
  const b = monthBounds(month);
  return `/sales/shifts?from=${b.from}&to=${b.to}`;
};
type SortMode = `${string}:${"asc" | "desc"}`;
const codec = {
  toField: (s: SortMode) => s.split(":")[0],
  toDirection: (s: SortMode) =>
    s.endsWith(":desc") ? ("desc" as const) : ("asc" as const),
  combine: (field: string, direction: "asc" | "desc") =>
    `${field}:${direction}` as SortMode,
};
const sourceRows = (data: StatisticsData, source: "native" | "archive") =>
  buildStatisticsRows(
    data.days,
    data.reports,
    data.archives,
    source,
    data.timezone,
    data.settings?.day_start_hour ?? 9,
  );

function Amount({
  value,
  column,
}: {
  value?: StatisticsValue;
  column: string;
}) {
  return (
    <span
      className="inline-flex flex-col items-end tabular-nums"
      title={value?.hint}
    >
      <span>
        {money(value?.value ?? null)}
        {value?.value != null && (
          <span className="ml-1 text-muted-foreground">{unit(column)}</span>
        )}
      </span>
      {value?.total != null && value.known! < value.total && (
        <span className="text-xs text-muted-foreground">
          {value.known} из {value.total} смен
        </span>
      )}
      {value?.through && (
        <span className="text-xs text-muted-foreground">
          по {dateLabel(value.through + "T12:00:00Z")}
        </span>
      )}
      {value?.state && value.state !== "ready" && (
        <span className="text-xs text-muted-foreground">
          {value.state === "error" ? "Не обновлено" : "Обновляется"}
        </span>
      )}
    </span>
  );
}

export function StatisticsClient({ initial }: { initial: StatisticsData }) {
  const [data, setData] = useState(initial);
  const [source, setSource] = useState<"native" | "archive">("native");
  const months = useMemo(() => sourceRows(data, source), [data, source]);
  const [year, setYear] = useState("all");
  const [reportMonth, setReportMonth] = useState(
    sourceRows(initial, "native")[0]?.month ?? "",
  );
  const [busy, setBusy] = useState(false),
    [reportBusy, setReportBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<StatisticsRow | null>(null);
  const st = useTableState({
    tableId: `sales-statistics.v2.${initial.venueId}`,
    columns: stateColumns,
  });
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
  const columns = useMemo<ColumnDef<StatisticsRow>[]>(
    () => [
      {
        id: "month",
        accessorKey: "month",
        header: labels.month,
        minSize: 160,
        size: 190,
        cell: ({ row }) => {
          const r = row.original;
          const content = (
            <>
              <span className="font-medium">{monthLabel(r.month)}</span>
              {r.archive ? (
                <span className="text-xs text-muted-foreground">
                  Снимок {dateLabel(r.archive.captured_at)}
                </span>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    {r.native!.shifts} смен
                    {r.native!.preliminary
                      ? ` · предварительных: ${r.native!.preliminary}`
                      : ""}
                  </span>
                  {r.native!.errors > 0 && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      Ошибок обновления: {r.native!.errors}
                    </span>
                  )}
                </>
              )}
            </>
          );
          return r.archive ? (
            <button
              type="button"
              className="flex flex-col items-start gap-1 text-left hover:text-brand"
              onClick={() => setDetail(r)}
            >
              {content}
            </button>
          ) : (
            <Link
              className="flex flex-col items-start gap-1 hover:text-brand"
              href={shiftHref(r.month)}
            >
              {content}
            </Link>
          );
        },
      },
      ...stateColumns
        .filter((c) => c.id !== "month")
        .map(
          (c): ColumnDef<StatisticsRow> => ({
            id: c.id,
            header: labels[c.id],
            size: c.defaultSize,
            accessorFn: (r) => r.values[c.id]?.value ?? undefined,
            sortUndefined: "last",
            cell: ({ row }) => (
              <Amount value={row.original.values[c.id]} column={c.id} />
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
    onChange: (v) =>
      st.setSorting(
        v.map((s) => ({
          id: codec.toField(s),
          desc: codec.toDirection(s) === "desc",
        })),
      ),
    columnToField: Object.fromEntries(stateColumns.map((c) => [c.id, c.id])),
    codec,
  });
  async function refresh(reports = false) {
    (reports ? setReportBusy : setBusy)(true);
    try {
      if (reports) await requestStatisticsMonth(reportMonth, initial.venueId);
      const next = await loadStatistics();
      if (next.venueId !== initial.venueId)
        throw new Error("Заведение изменилось. Обновите страницу");
      setData(next);
      if (reports) toast.success("Месячные отчёты запрошены");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обновить статистику",
      );
    } finally {
      (reports ? setReportBusy : setBusy)(false);
    }
  }
  async function download() {
    setExporting(true);
    try {
      const snapshot = await exportStatistics(initial.venueId);
      const fresh = new Map(
        sourceRows(snapshot, source).map((r) => [r.month, r]),
      );
      const cols = table.getVisibleLeafColumns();
      const lines: unknown[][] = [
        [
          ...cols.flatMap((c) =>
            c.id === "month"
              ? [labels[c.id]]
              : [
                  labels[c.id],
                  `${labels[c.id]}: смен с данными`,
                  `${labels[c.id]}: всего смен`,
                  `${labels[c.id]}: по дату`,
                  `${labels[c.id]}: обновлено`,
                  `${labels[c.id]}: состояние`,
                ],
          ),
          "Источник",
          "Снимок",
          "Строка источника",
        ],
      ];
      for (const old of table.getSortedRowModel().rows) {
        const row = fresh.get(old.original.month);
        if (!row) throw new Error("Данные изменились. Обновите статистику");
        lines.push([
          ...cols.flatMap((c) => {
            if (c.id === "month") return [monthLabel(row.month)];
            const v = row.values[c.id];
            return [
              v?.value ?? null,
              v?.known ?? null,
              v?.total ?? null,
              v?.through ?? null,
              v?.updatedAt ?? null,
              v?.state
                ? {
                    ready: "Обновлено",
                    error: "Не обновлено",
                    pending: "Ожидает обновления",
                    running: "Обновляется",
                  }[v.state]
                : null,
            ];
          }),
          row.archive ? "Архив Glide" : "Sheerly",
          row.archive?.captured_at ?? null,
          row.archive?.origin.range ?? null,
        ]);
      }
      const url = URL.createObjectURL(
        new Blob(
          ["\uFEFF" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Статистика-${source === "archive" ? "Glide" : "Sheerly"}-${year}.csv`;
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
        <div className="flex min-w-0 flex-wrap gap-2">
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v as typeof source);
              setYear("all");
              setDetail(null);
            }}
          >
            <SelectTrigger className="w-44" aria-label="Источник статистики">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="native">Sheerly</SelectItem>
              <SelectItem value="archive">Архив Glide</SelectItem>
            </SelectContent>
          </Select>
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
        </div>
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
      {source === "archive" ? (
        <p className="text-sm text-muted-foreground">
          Архивные итоги Glide без пересчёта.
        </p>
      ) : data.reportsConfigured &&
        data.permissions.includes("sales.sync_shifts") ? (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={reportMonth} onValueChange={setReportMonth}>
            <SelectTrigger
              className="w-52"
              aria-label="Месяц отчётов Quick Resto"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceRows(data, "native").map((m) => (
                <SelectItem key={m.month} value={m.month}>
                  {monthLabel(m.month)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={reportBusy || !reportMonth}
            onClick={() => void refresh(true)}
          >
            {reportBusy ? "Загрузка…" : "Обновить отчёты Quick Resto"}
          </Button>
        </div>
      ) : (
        !data.reportsConfigured && (
          <p className="text-sm text-muted-foreground">
            Дополнительные отчёты Quick Resto ещё не подключены.
          </p>
        )
      )}
      {source === "native" && data.reports.some((r) => r.state === "error") && (
        <details className="rounded-lg border p-4 text-sm">
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
            className="grid grid-cols-2 gap-y-5 rounded-lg border py-5 sm:grid-cols-4"
          >
            {[
              "turnover",
              "tips_total",
              "parking",
              source === "archive" ? "alcoholRevenue" : "checks",
            ].map((key) => {
              const known = rows.filter((r) => r.values[key]?.value != null),
                total = known.length
                  ? known.reduce((s, r) => s + r.values[key].value!, 0)
                  : null;
              const partial =
                known.length !== rows.length ||
                known.some(
                  (r) =>
                    r.values[key].known != null &&
                    r.values[key].known !== r.values[key].total,
                );
              return (
                <div
                  key={key}
                  className="min-w-0 px-4 sm:border-r sm:px-5 sm:last:border-0"
                >
                  <p className="text-sm text-muted-foreground">{labels[key]}</p>
                  <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                    {money(total)}
                    {total !== null && (
                      <span className="ml-1 text-base font-normal text-muted-foreground">
                        {unit(key)}
                      </span>
                    )}
                  </p>
                  {partial && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      По имеющимся данным
                    </p>
                  )}
                </div>
              );
            })}
          </section>
          <StatisticsChart rows={rows} />
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-[65dvh] min-h-64 overflow-auto">
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
            {source === "archive"
              ? "Прочерк — значение отсутствовало в источнике. Архив не изменяет смены и финансовые операции."
              : "Доли алкоголя и постоянных гостей доступны в столбцах таблицы. Они рассчитываются только за совпадающий период; прочерк означает отсутствие полной базы."}
          </p>
        </>
      ) : (
        <EmptyState
          icon={ChartNoAxesCombined}
          title={
            source === "archive"
              ? "Архив пока не перенесён"
              : "Месяцы не найдены"
          }
          description="Измените источник, год или поисковый запрос."
        />
      )}
      <EditDrawer
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail ? monthLabel(detail.month) : "Архив статистики"}
        description={
          detail?.archive
            ? `Архив Glide · снимок ${dateLabel(detail.archive.captured_at)}`
            : undefined
        }
      >
        {detail?.archive && (
          <>
            <dl className="divide-y">
              {stateColumns
                .filter((c) => c.id in detail.values)
                .map(({ id: key }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <dt className="text-muted-foreground">
                      {labels[key] ?? key}
                    </dt>
                    <dd>
                      <Amount value={detail.values[key]} column={key} />
                    </dd>
                  </div>
                ))}
            </dl>
            <section>
              <h3 className="text-base font-semibold">
                Средний оборот по дням недели
              </h3>
              <dl className="mt-2 divide-y">
                {detail.archive.weekday_turnover.map((v, i) => (
                  <div
                    key={i}
                    className="flex justify-between gap-3 py-2 text-sm"
                  >
                    <dt className="text-muted-foreground">
                      {
                        [
                          "Понедельник",
                          "Вторник",
                          "Среда",
                          "Четверг",
                          "Пятница",
                          "Суббота",
                          "Воскресенье",
                        ][i]
                      }
                    </dt>
                    <dd className="tabular-nums">
                      {money(v)}
                      {v !== null && " ₽"}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            {detail.archive.note && (
              <section>
                <h3 className="text-base font-semibold">Комментарий</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {detail.archive.note}
                </p>
              </section>
            )}
            <p className="text-xs text-muted-foreground">
              Источник: {detail.archive.origin.range}. Прежняя методика расчёта
              сохранена.
            </p>
          </>
        )}
      </EditDrawer>
    </PageFrame>
  );
}
