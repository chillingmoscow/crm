"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Archive,
  ChartNoAxesCombined,
  RefreshCw,
  SearchX,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryTotal,
} from "@/components/ui/drawer-blocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { AnimatedMoney, AnimatedNumber } from "@/components/shared/animated-money";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money } from "@/components/shared/money";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
  TablePageHeader,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { metricLabels } from "@/lib/sales/types";
import {
  formatCount,
  formatShare,
  monthLabel,
} from "@/lib/sales/format";
import { csvCell } from "@/lib/sales/csv";
import { salesErrorText } from "@/lib/sales/errors";
import { formatDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  buildStatisticsRows,
  type StatisticsRow,
  type StatisticsValue,
} from "@/lib/sales/statistics-view";
import { businessDate } from "@/lib/sales/time";
import { unwrapAction } from "@/lib/actions/result";
import {
  loadStatistics,
  exportStatistics,
  requestStatisticsMonth,
  type StatisticsData,
} from "./actions";
import { StatisticsChart } from "./statistics-chart";
import { MonthPlanDrawer } from "./_components/month-plan-drawer";
import { loadPlanSummaryAction } from "./plan-actions";

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
  regularRevenue: "Оборот постоянных гостей",
  regularShare: "Доля постоянных гостей",
  averageCheck: "Средний чек",
  food: "Питание",
  payroll: "ФОТ",
  mastersSales: "Продажи мастеров",
  plan_turnover: "План оборота",
  plan_alcohol: "Доля алкоголя · план",
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
const columnConfig = [
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
  "plan_turnover",
  "plan_alcohol",
].map((id) => ({
  id,
  defaultSize: id === "month" ? 180 : 150,
  defaultVisible: defaultColumns.includes(id) || id.startsWith("plan_"),
}));
/** Столбцы плана месяца — не из показателей смен, а из «Плана на месяц». */
const planColumns = ["plan_turnover", "plan_alcohol"];
const valueColumns = columnConfig.map((c) => c.id).filter((id) => id !== "month" && !planColumns.includes(id));
const sortFields = columnConfig.map((c) => c.id);
const countKeys = new Set(["shifts", "checks", "regularGuests"]);
const reportKinds: Record<string, string> = {
  alcohol: "Алкоголь",
  regular_guests: "Постоянные гости",
  average_check: "Средний чек",
};
const weekdays = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];
const stateText = {
  ready: "Обновлено",
  error: "Не обновлено",
  pending: "Ожидает обновления",
  running: "Обновляется",
} as const;

const shiftHref = (month: string) => `/sales/shifts?month=${month.slice(0, 7)}`;
const sourceRows = (data: StatisticsData, source: "native" | "archive") =>
  buildStatisticsRows(
    data.days,
    data.reports,
    data.archives,
    source,
    data.timezone,
    data.settings?.day_start_hour ?? 9,
  );

/** Значение показателя в нужном виде: деньги, количество или доля. */
function ValueText({ id, value }: { id: string; value: number | null | undefined }) {
  if (id.endsWith("Share")) return <>{formatShare(value)}</>;
  if (countKeys.has(id)) return <>{formatCount(value)}</>;
  return <Money value={value ?? null} />;
}

/** То же, что `ValueText`, но досчитывается — для итогов в `MetricStrip`. */
function AnimatedValueText({ id, value }: { id: string; value: number | null | undefined }) {
  if (id.endsWith("Share")) return <AnimatedNumber value={value} digits={1} format={formatShare} />;
  if (countKeys.has(id)) return <AnimatedNumber value={value} format={formatCount} />;
  return <AnimatedMoney value={value ?? null} />;
}

/** Ячейка месяца: значение и одна строка состояния под ним, если оно важно. */
function Amount({ value, id }: { value?: StatisticsValue; id: string }) {
  const note =
    value?.state && value.state !== "ready"
      ? stateText[value.state]
      : value?.total != null && value.known! < value.total
        ? `${value.known} из ${countRu(value.total, "смены", "смен", "смен")}`
        : value?.through
          ? `по ${formatDayMonth(value.through)}`
          : null;
  return (
    <span className="inline-flex flex-col items-end" data-tip={value?.hint}>
      <ValueText id={id} value={value?.value} />
      {note && (
        <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
          {note}
        </span>
      )}
    </span>
  );
}

export function StatisticsClient({ initial }: { initial: StatisticsData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [source, setSource] = useState<"native" | "archive">("native");
  const months = useMemo(() => sourceRows(data, source), [data, source]);
  const nativeMonths = useMemo(() => sourceRows(data, "native"), [data]);
  const [year, setYear] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<StatisticsRow | null>(null);
  // Панель закрывается с анимацией: пока она уезжает, показываем последний месяц.
  const [shownDetail, setShownDetail] = useState(detail);
  useEffect(() => {
    if (detail) setShownDetail(detail);
  }, [detail]);
  const st = useTableState({
    tableId: `sales-statistics.v3.${initial.venueId}`,
    columns: columnConfig,
  });
  const can = (p: string) => data.permissions.includes(`sales.${p}_shifts`);
  const [plans, setPlans] = useState<Map<string, { turnover: number | null; alcoholShare: number | null }>>(new Map());
  const [planMonth, setPlanMonth] = useState<string | null>(null);
  const reloadPlans = () =>
    loadPlanSummaryAction().then(unwrapAction)
      .then((list) => setPlans(new Map(list.map((p) => [p.month.slice(0, 7), p]))))
      .catch(() => undefined);
  useEffect(() => {
    void reloadPlans();
    // Ссылка «Задать план» из «Смен», «Настроек продаж» и «На разбор».
    const wanted = new URLSearchParams(window.location.search).get("plan");
    if (wanted && /^20\d{2}-(0[1-9]|1[0-2])$/.test(wanted)) setPlanMonth(wanted);
  }, []);
  const currentMonth = businessDate(
    new Date(),
    data.timezone,
    data.settings?.day_start_hour ?? 9,
  ).slice(0, 7);
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))];
  const query = st.search.toLowerCase().trim();
  const rows = useMemo(
    () =>
      months.filter(
        (m) =>
          (!year || m.month.startsWith(year)) &&
          monthLabel(m.month).toLowerCase().includes(query),
      ),
    [months, year, query],
  );
  const hasFilters = !!year;
  const isFiltered = hasFilters || !!query;
  const resetConditions = () => {
    setYear("");
    st.setSearch("");
    st.setSorting([]);
  };
  const changeSource = (next: "native" | "archive") => {
    setSource(next);
    setYear("");
    setDetail(null);
  };

  const columns = useMemo<ColumnDef<StatisticsRow>[]>(
    () => [
      {
        id: "month",
        accessorKey: "month",
        header: labels.month,
        minSize: 150,
        size: 180,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const sub = r.archive
            ? `Снимок ${formatDayMonth(r.archive.captured_at.slice(0, 10))}`
            : `${countRu(r.native!.shifts, "смена", "смены", "смен")}${r.native!.preliminary ? ` · предварительных ${r.native!.preliminary}` : ""}`;
          return (
            <div className="min-w-0">
              <button
                type="button"
                className="block max-w-full truncate text-left font-medium transition-colors duration-200 first-letter:uppercase hover:text-brand focus-visible:text-brand focus-visible:outline-none"
                onClick={() =>
                  r.archive ? setDetail(r) : router.push(shiftHref(r.month))
                }
              >
                {monthLabel(r.month)}
              </button>
              <span
                className={
                  r.native?.errors
                    ? "block truncate text-xs text-amber-700 dark:text-amber-400"
                    : "block truncate text-xs text-muted-foreground"
                }
              >
                {r.native?.errors
                  ? `Ошибок обновления: ${r.native.errors}`
                  : sub}
              </span>
            </div>
          );
        },
      },
      ...valueColumns.map(
        (id): ColumnDef<StatisticsRow> => ({
          id,
          header: labels[id],
          size: 150,
          minSize: Math.max(100, labels[id].length * 8 + 32),
          accessorFn: (r) => r.values[id]?.value ?? undefined,
          sortUndefined: "last",
          cell: ({ row }) => <Amount value={row.original.values[id]} id={id} />,
        }),
      ),
      {
        id: "plan_turnover",
        header: labels.plan_turnover,
        size: 160,
        minSize: 140,
        accessorFn: (r) => plans.get(r.month)?.turnover ?? undefined,
        sortUndefined: "last",
        cell: ({ row }) => {
          const plan = plans.get(row.original.month)?.turnover ?? null;
          const fact = row.original.values.turnover?.value ?? null;
          return (
            <button type="button" className="inline-flex flex-col items-end transition-colors hover:text-brand" data-tip="План месяца"
              onClick={() => setPlanMonth(row.original.month)}>
              {plan === null ? <span className="text-muted-foreground">—</span> : <Money value={plan} />}
              {plan !== null && fact !== null && <span className="text-xs text-muted-foreground">{Math.round((fact / plan) * 100)}% плана</span>}
            </button>
          );
        },
      },
      {
        id: "plan_alcohol",
        header: labels.plan_alcohol,
        size: 170,
        minSize: 150,
        accessorFn: (r) => plans.get(r.month)?.alcoholShare ?? undefined,
        sortUndefined: "last",
        cell: ({ row }) => {
          const plan = plans.get(row.original.month)?.alcoholShare ?? null;
          const fact = row.original.values.alcoholShare?.value ?? null;
          return (
            <button type="button" className="inline-flex flex-col items-end transition-colors hover:text-brand" data-tip="План месяца"
              onClick={() => setPlanMonth(row.original.month)}>
              {plan === null ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{plan.toLocaleString("ru-RU")}%</span>}
              {plan !== null && fact !== null && <span className="text-xs text-muted-foreground">факт {fact.toLocaleString("ru-RU")}%</span>}
            </button>
          );
        },
      },
    ],
    [router, plans],
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
  const changeSorting = (next: SortingState) => st.setSorting(next);

  // Отчёты Quick Resto считаются в очереди: пока хоть один ждёт или
  // обновляется, страница сама перечитывает статистику — отдельная кнопка
  // «обновить данные» не нужна.
  const reportsInFlight = data.reports.some(
    (r) => r.state === "pending" || r.state === "running",
  );
  useEffect(() => {
    if (!reportsInFlight) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void loadStatistics()
        .then(unwrapAction)
        .then((next) => {
          if (alive && next.venueId === initial.venueId) setData(next);
        })
        .catch(() => {
          // Сбой фонового опроса не мешает работать: попробуем на следующем шаге.
        });
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [reportsInFlight, initial.venueId]);
  async function requestReports(month: string) {
    setReportBusy(true);
    try {
      unwrapAction(await requestStatisticsMonth(month, initial.venueId));
      const next = unwrapAction(await loadStatistics());
      setData(next);
      toast.success(`Отчёты за ${monthLabel(month)} запрошены`);
    } catch (e) {
      toast.error(salesErrorText(e instanceof Error ? e.message : null, "Не удалось запросить отчёты"));
    } finally {
      setReportBusy(false);
    }
  }
  async function download() {
    setExporting(true);
    try {
      const snapshot = unwrapAction(await exportStatistics(initial.venueId));
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
              v?.state ? stateText[v.state] : null,
            ];
          }),
          row.archive ? "Архив Glide" : "Sheerly",
          row.archive?.captured_at ?? null,
          row.archive?.origin.range ?? null,
        ]);
      }
      const url = URL.createObjectURL(
        new Blob(
          ["﻿" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Статистика-${source === "archive" ? "архив-Glide" : "Sheerly"}${year ? `-${year}` : ""}.csv`;
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

  const totalOf = (key: string) => {
    const known = rows.filter((r) => r.values[key]?.value != null);
    const value = known.length
      ? known.reduce((s, r) => s + r.values[key].value!, 0)
      : null;
    const partial =
      known.length !== rows.length ||
      known.some(
        (r) =>
          r.values[key].known != null &&
          r.values[key].known !== r.values[key].total,
      );
    return { value, partial };
  };
  const strip = [
    "turnover",
    "tips_total",
    "parking",
    source === "archive" ? "alcoholRevenue" : "checks",
  ];
  const reportErrors =
    source === "native" ? data.reports.filter((r) => r.state === "error") : [];
  const reportsButton =
    source === "native" && data.reportsConfigured && can("sync") ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" disabled={reportBusy || !nativeMonths.length}>
            <RefreshCw
              className={
                reportBusy ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"
              }
            />
            {reportBusy ? "Запрашиваем…" : "Обновить отчёты"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
          {nativeMonths.slice(0, 12).map((m) => (
            <DropdownMenuItem
              key={m.month}
              className="first-letter:uppercase"
              onSelect={() => void requestReports(m.month)}
            >
              {monthLabel(m.month)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Продажи" }, { label: "Статистика" }]} />
      <TablePageHeader
        title="Статистика"
        count={isFiltered ? `${rows.length} из ${months.length}` : months.length}
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: st.setSearch,
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: "Месяц или год",
            }}
            filters={{
              active: hasFilters,
              onClick: () => setFiltersOpen((v) => !v),
            }}
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={sortFields}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder.map((id) => {
                    const c = table.getColumn(id)!;
                    return {
                      id,
                      label: labels[id],
                      visible: c.getIsVisible(),
                      canHide: c.getCanHide(),
                    };
                  })}
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
            secondaryActions={
              <>
                {data.archives.length > 0 && (
                  <TableIconButton
                    label={
                      source === "archive"
                        ? "Вернуться к статистике Sheerly"
                        : "Архив Glide"
                    }
                    active={source === "archive"}
                    pressed={source === "archive"}
                    onClick={() =>
                      changeSource(source === "archive" ? "native" : "archive")
                    }
                  >
                    <Archive />
                  </TableIconButton>
                )}
              </>
            }
            exportAction={
              can("export")
                ? {
                    label: "Экспорт CSV",
                    onClick: () => void download(),
                    disabled: !rows.length,
                    loading: exporting,
                  }
                : undefined
            }
            primaryActions={
              <>
                {source === "native" && (
                  <Button size="sm" variant="outline" onClick={() => setPlanMonth(currentMonth)}>
                    <Target className="size-4" />
                    План продаж
                  </Button>
                )}
                {reportsButton}
              </>
            }
          />
        }
      />
      <TableConditions
        label="Условия статистики"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => st.setSearch("")}
        onReset={resetConditions}
      >
        {(filtersOpen || hasFilters) && (
          <TableFilterChip
            label="Год"
            value={year}
            onChange={setYear}
            options={[
              { value: "", label: "Все годы" },
              ...years.map((y) => ({ value: y, label: `${y} год` })),
            ]}
          />
        )}
      </TableConditions>

      {source === "archive" && (
        <p role="status" className="text-sm text-muted-foreground">
          Итоги из архива Glide, без пересчёта. Прочерк: значения не было в
          источнике
        </p>
      )}
      {source === "native" && !data.reportsConfigured && (
        <p className="text-sm text-muted-foreground">
          Отчёты Quick Resto по алкоголю, постоянным гостям и среднему чеку
          ещё не подключены
        </p>
      )}
      {reportErrors.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">
            Не обновились отчёты Quick Resto: {reportErrors.length}
          </p>
          <ul className="space-y-1 text-muted-foreground">
            {reportErrors.map((r) => (
              <li key={r.id}>
                <span className="first-letter:uppercase">
                  {monthLabel(r.month.slice(0, 7))}
                </span>{" "}
                · {reportKinds[r.kind] ?? "Отчёт"}:{" "}
                {salesErrorText(r.last_error)}
              </li>
            ))}
          </ul>
          {can("sync") && (
            <p className="text-xs text-muted-foreground">
              Запросите отчёты месяца ещё раз кнопкой «Обновить отчёты»
            </p>
          )}
        </div>
      )}

      {!months.length ? (
        <EmptyState
          icon={ChartNoAxesCombined}
          title={
            source === "archive" ? "Архив пока не перенесён" : "Статистики пока нет"
          }
          description={
            source === "archive"
              ? "Вернитесь к статистике Sheerly"
              : "Месяцы появятся, когда в «Сменах» будут рабочие дни"
          }
        />
      ) : !rows.length ? (
        <EmptyState
          icon={SearchX}
          title="Месяцы не найдены"
          description="Измените условия поиска или сбросьте фильтры"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : (
        <>
          {/* Источник — как вкладка: итоги всплывают и досчитываются заново. */}
          <div key={source} className="motion-rise">
          <MetricStrip label="Итоги за выбранные месяцы">
            {strip.map((key, i) => {
              const t = totalOf(key);
              return (
                <Metric
                  key={key}
                  primary={i === 0}
                  label={labels[key]}
                  value={<AnimatedValueText id={key} value={t.value} />}
                  hint={
                    t.value === null
                      ? "Нет данных"
                      : t.partial
                        ? "По имеющимся данным"
                        : i === 0
                          ? `За ${countRu(rows.length, "месяц", "месяца", "месяцев")}`
                          : undefined
                  }
                />
              );
            })}
          </MetricStrip>
          </div>
          <StatisticsChart rows={rows} currentMonth={currentMonth} />
          <DataTable
            table={table}
            label="Статистика продаж по месяцам"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            numeric={valueColumns}
            onRowClick={(row) =>
              row.original.archive
                ? setDetail(row.original)
                : router.push(shiftHref(row.original.month))
            }
            empty={null}
            mobile={{ label: "Карточки месяцев", nameColumn: "month" }}
          />
        </>
      )}
      <MonthPlanDrawer
        open={planMonth !== null}
        onOpenChange={(v) => { if (!v) setPlanMonth(null); }}
        month={planMonth ?? currentMonth}
        currentMonth={currentMonth}
        onSaved={() => void reloadPlans()}
      />
      <EditDrawer
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        title={
          shownDetail
            ? monthLabel(shownDetail.month).replace(/^./, (c) => c.toUpperCase())
            : "Месяц из архива"
        }
        titleAccessory={<DrawerStatus label="Архив Glide" tone="neutral" />}
        description={
          shownDetail?.archive
            ? `Снимок ${formatDayMonth(shownDetail.archive.captured_at.slice(0, 10))} · суммы без пересчёта`
            : undefined
        }
      >
        {shownDetail?.archive && (
          <>
            <DrawerSummary label="Итоги месяца">
              <DrawerSummaryTotal label={labels.turnover}>
                <ValueText id="turnover" value={shownDetail.values.turnover?.value} />
              </DrawerSummaryTotal>
            </DrawerSummary>
            <DrawerSection title="Показатели">
              <dl className="divide-y">
                {valueColumns
                  .filter((key) => key !== "turnover" && key in shownDetail.values)
                  .map((key) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-4 py-2.5 text-sm"
                    >
                      <dt className="text-muted-foreground">{labels[key]}</dt>
                      <dd>
                        <ValueText id={key} value={shownDetail.values[key]?.value} />
                      </dd>
                    </div>
                  ))}
              </dl>
            </DrawerSection>
            <DrawerSection title="Средний оборот по дням недели">
              <dl className="divide-y">
                {shownDetail.archive.weekday_turnover.map((v, i) => (
                  <div key={i} className="flex justify-between gap-3 py-2.5 text-sm">
                    <dt className="text-muted-foreground">{weekdays[i]}</dt>
                    <dd>
                      <Money value={v} />
                    </dd>
                  </div>
                ))}
              </dl>
            </DrawerSection>
            {shownDetail.archive.note && (
              <DrawerSection title="Комментарий">
                <p className="whitespace-pre-wrap break-words text-sm">
                  {shownDetail.archive.note}
                </p>
              </DrawerSection>
            )}
            <p className="text-xs text-muted-foreground">
              Строка архива: {shownDetail.archive.origin.range}
            </p>
          </>
        )}
      </EditDrawer>
    </PageFrame>
  );
}
