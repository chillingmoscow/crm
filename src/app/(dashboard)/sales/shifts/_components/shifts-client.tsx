"use client";
import { unwrapAction } from "@/lib/actions/result";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  CalendarDays,
  CircleDot,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  SearchX,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/ui/color-dot";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { AnimatedMoney } from "@/components/shared/animated-money";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money, formatRub } from "@/components/shared/money";
import { MonthPicker } from "@/components/shared/month-picker";
import { PageFrame } from "@/components/shared/page-frame";
import { PeriodStepper } from "@/components/shared/period-stepper";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import {
  effectiveMetrics,
  metricKeys,
  metricHints,
  metricLabels,
  type MetricKey,
  type SalesData,
  type SalesDay,
} from "@/lib/sales/types";
import { businessDate } from "@/lib/sales/time";
import { csvCell } from "@/lib/sales/csv";
import { salesErrorText } from "@/lib/sales/errors";
import { formatCount, weekdayLabel } from "@/lib/sales/format";
import { formatDateCell, formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  exportSalesRows,
  loadSalesForClient,
  requestSalesSync,
} from "../actions";
import { DayScreen } from "./day-screen";
import { TurnoverMetric } from "./month-plan";
import {
  SalesStatusBadge,
  salesDayStatus,
  salesStatuses,
} from "./sales-status-badge";
import { SalesBodySkeleton } from "../../_components/sales-loading";

/** Подписи столбцов: заголовки таблицы, карточки на телефоне, экспорт. */
const labels: Record<string, string> = {
  business_date: "Дата",
  ...metricLabels,
  checks: "Чеки",
  avg_check: "Средний чек гостя",
  status: "Статус",
};
/** Счётные показатели — без знака валюты. */
const counts = new Set<MetricKey>(["checks"]);
// По умолчанию — столбцы, которые сверяют каждый день; составляющие (кальяны,
// бар, чаевые без сбора, сбор) и чеки сотрудников включаются в «Столбцах».
// Иначе таблица не помещается в ширину и уходит в горизонтальную прокрутку.
const hiddenByDefault = new Set<MetricKey>([
  "hookah",
  "bar",
  "tips",
  "service",
  "staff_checks",
]);
const columnConfig = [
  { id: "business_date", defaultSize: 150 },
  ...metricKeys.map((id) => ({
    id,
    defaultSize: id === "checks" ? 110 : 140,
    defaultVisible: !hiddenByDefault.has(id),
  })),
  { id: "avg_check", defaultSize: 150, defaultVisible: false },
  { id: "status", defaultSize: 170 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
/** Ширина столбца не уже заголовка: длинные подписи шире. */
const minWidth: Partial<Record<MetricKey, number>> = {
  tips_total: 150,
  service: 140,
  staff_checks: 150,
  deposits: 110,
  checks: 90,
};
const sortFields = ["business_date", ...metricKeys, "avg_check", "status"];
const statusFilterOptions = [
  { value: "", label: "Все смены" },
  ...(["preliminary", "complete", "imported", "adjusted", "error"] as const).map(
    (value) => ({ value, label: salesStatuses[value].label }),
  ),
];
const MIN_MONTH = "2000-01";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function matchesStatus(day: SalesDay, status: string) {
  if (!status) return true;
  if (status === "adjusted") return Object.keys(day.overrides).length > 0;
  if (status === "error") return !!day.sync_error;
  return day.status === status;
}

/** Гостевые чеки смены (без Staff) — из сводки расчёта; у старых смен их нет до обновления. */
function guestChecks(day: SalesDay): number | null {
  const n = day.source_summary?.guest_checks;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Средний чек гостя за смену: оборот (он без Staff) на гостевой чек. */
function averageCheck(day: SalesDay): number | null {
  const guests = guestChecks(day);
  const turnover = effectiveMetrics(day).turnover;
  return guests && turnover !== null ? turnover / guests : null;
}

/** Средний чек гостя за набор смен: оборот и чеки только смен, где известны оба. */
function averageCheckOf(days: SalesDay[]) {
  let turnover = 0,
    guests = 0,
    known = 0;
  for (const d of days) {
    const g = guestChecks(d);
    const t = effectiveMetrics(d).turnover;
    if (!g || t === null) continue;
    turnover += t;
    guests += g;
    known++;
  }
  return { value: guests ? turnover / guests : null, guests, known };
}

/** Сумма показателя по сменам: неизвестные значения не считаются нулём. */
function sumMetric(days: SalesDay[], key: MetricKey) {
  const values = days
    .map((d) => effectiveMetrics(d)[key])
    .filter((v): v is number => v !== null);
  return {
    value: values.length ? values.reduce((a, b) => a + b, 0) : null,
    known: values.length,
  };
}

export function ShiftsClient({
  initial,
  selection,
}: {
  /** Смены одного месяца (`initial.month`): из ссылки или текущий. */
  initial: SalesData;
  selection?: { date: string; tab: string };
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  useEffect(() => setData(initial), [initial]);
  const st = useTableState({
    tableId: `sales-shifts.v2.${initial.venueId}`,
    columns: columnConfig,
  });
  const { setPagination } = st;
  const today = businessDate(
    new Date(),
    initial.timezone,
    initial.settings?.day_start_hour ?? 9,
  );
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(initial.month ?? currentMonth);
  useEffect(() => {
    if (initial.month) setMonth(initial.month);
  }, [initial.month]);
  // Загружается только выбранный месяц: при смене месяца читаем его заново.
  const monthRef = useRef(month);
  monthRef.current = month;
  const sequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState("");
  // Смена открывается экраном во всю колонку (`drawer`). `n` — номер
  // открытия: каждое открытие начинается с чистой формы, даже если это тот
  // же день.
  const openCount = useRef(0);
  const [drawer, setDrawerState] = useState<{ day: SalesDay; tab: string; n: number } | null>(
    null,
  );
  const setDrawer = useCallback(
    (next: { day: SalesDay; tab: string } | null) =>
      setDrawerState(next && { ...next, n: ++openCount.current }),
    [],
  );

  // Ссылка на день (`?day=…&tab=…`) открывает его панель один раз.
  const selectionKey = selection
    ? `${initial.venueId}:${selection.date}:${selection.tab}`
    : "";
  const openedSelection = useRef("");
  useEffect(() => {
    if (!selectionKey) {
      openedSelection.current = "";
      return;
    }
    if (openedSelection.current === selectionKey) return;
    openedSelection.current = selectionKey;
    const day = initial.days.find((d) => d.business_date === selection?.date);
    setDrawer(day ? { day, tab: selection!.tab } : null);
  }, [selectionKey, selection, initial.days, setDrawer]);

  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const can = useCallback(
    (permission: string) =>
      data.permissions.includes(`sales.${permission}_shifts`),
    [data.permissions],
  );
  const refresh = useCallback(async (quiet = false) => {
    const seq = ++sequence.current;
    const target = monthRef.current;
    if (!quiet) setLoading(true);
    try {
      const next = unwrapAction(await loadSalesForClient(target));
      if (seq !== sequence.current) return;
      setData(next);
      setRefreshFailed(false);
    } catch (e) {
      if (seq !== sequence.current) return;
      setRefreshFailed(true);
      if (!quiet)
        toast.error(
          e instanceof Error ? e.message : "Не удалось загрузить смены",
        );
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (data.month !== month) void refresh();
    // data.month не в зависимостях: загрузку запускает только смена месяца.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, refresh]);
  const activeJobs = useMemo(
    () =>
      new Map(
        data.jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => [job.business_date, job.status]),
      ),
    [data.jobs],
  );
  const running = activeJobs.size > 0;
  const currentRunning = activeJobs.has(today);
  // Автообновление — только на видимой вкладке (DS «Состояния»).
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh(true);
      },
      running ? 10000 : 60000,
    );
    return () => clearInterval(timer);
  }, [running, refresh]);
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [month, status, st.search, setPagination]);

  // Пока новый месяц грузится, прежние строки не показываем под чужим месяцем.
  const monthDays = useMemo(
    () => data.days.filter((d) => d.business_date.startsWith(month)),
    [data.days, month],
  );
  const monthLoading = loading || data.month !== month;
  const hasFilters = !!status;
  const query = st.search.toLowerCase().trim();
  const filtered = useMemo(
    () =>
      monthDays.filter(
        (d) =>
          matchesStatus(d, status) &&
          (!query ||
            `${formatDateCell(d.business_date)} ${weekdayLabel(d.business_date)} ${d.note}`
              .toLowerCase()
              .includes(query)),
      ),
    [monthDays, status, query],
  );
  const isFiltered = hasFilters || !!query;
  const resetConditions = () => {
    setStatus("");
    st.setSearch("");
    st.setSorting([]);
  };

  const sync = useCallback(
    async (dates: string[]) => {
      setBusy(true);
      try {
        const n = unwrapAction(await requestSalesSync(dates));
        toast.success(
          n === 1
            ? "Смена поставлена на обновление"
            : `${countRu(n, "смена поставлена", "смены поставлены", "смен поставлено")} на обновление`,
        );
        await refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось запустить обновление",
        );
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const columns = useMemo<ColumnDef<SalesDay>[]>(
    () => [
      {
        id: "business_date",
        accessorKey: "business_date",
        header: labels.business_date,
        size: 150,
        minSize: 120,
        enableHiding: false,
        cell: ({ row }) => {
          const d = row.original;
          const job = activeJobs.get(d.business_date);
          const current = d.business_date === today;
          const state =
            job === "queued"
              ? "Ожидает обновления"
              : job === "running"
                ? "Обновляется"
                : "Текущая смена";
          const synced = d.synced_at
            ? `Обновлено ${formatDayMonthTime(d.synced_at, new Date(), data.timezone)}`
            : "Ещё не обновлялась";
          return (
            <div className="min-w-0">
              {/* Настоящая кнопка в первой ячейке: смену можно открыть с клавиатуры. */}
              <button
                type="button"
                className="flex items-center gap-1.5 text-left font-medium tabular-nums transition-colors duration-200 hover:text-brand focus-visible:text-brand focus-visible:outline-none"
                onClick={() => setDrawer({ day: d, tab: "values" })}
              >
                {formatDateCell(d.business_date)}
                {(current || job) && (
                  <span
                    data-tip={state}
                    data-tip-sub={synced}
                    className="text-brand"
                  >
                    {job ? (
                      <Loader2
                        aria-label={state}
                        className="size-3.5 animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <CircleDot aria-label={state} className="size-3.5" />
                    )}
                  </span>
                )}
              </button>
              <span className="block truncate text-xs text-muted-foreground first-letter:uppercase">
                {weekdayLabel(d.business_date)}
                {d.note ? ` · ${d.note}` : ""}
              </span>
            </div>
          );
        },
      },
      ...metricKeys.map(
        (k): ColumnDef<SalesDay> => ({
          id: k,
          accessorFn: (d) => effectiveMetrics(d)[k] ?? undefined,
          header: labels[k],
          size: k === "checks" ? 110 : 140,
          minSize: minWidth[k] ?? 100,
          sortUndefined: "last",
          cell: ({ row }) => {
            const d = row.original;
            const value = effectiveMetrics(d)[k];
            const adjusted = k in d.overrides;
            return (
              <span
                className="inline-flex items-center justify-end gap-1.5"
                data-tip={
                  adjusted
                    ? `Исправлено вручную. Исходное: ${counts.has(k) ? formatCount(d.calculated[k] ?? null) : formatRub(d.calculated[k] ?? null)}`
                    : metricHints[k]
                }
              >
                {adjusted && (
                  <>
                    <ColorDot color="purple" size="sm" />
                    <span className="sr-only">Исправлено вручную:</span>
                  </>
                )}
                {counts.has(k) ? formatCount(value) : <Money value={value} />}
              </span>
            );
          },
        }),
      ),
      {
        id: "avg_check",
        accessorFn: (d) => averageCheck(d) ?? undefined,
        header: labels.avg_check,
        size: 150,
        minSize: 150,
        sortUndefined: "last",
        cell: ({ row }) => {
          const guests = guestChecks(row.original);
          return (
            <span
              data-tip={
                guests === null
                  ? "Посчитается после обновления смены из Quick Resto"
                  : `${formatCount(guests)} гостевых чеков, без Staff`
              }
            >
              <Money value={averageCheck(row.original)} />
            </span>
          );
        },
      },
      {
        id: "status",
        accessorFn: (d) => salesStatuses[salesDayStatus(d)].label,
        header: labels.status,
        size: 170,
        // Самая длинная подпись — «Ожидает пересчёта»: бейдж не режем.
        minSize: 160,
        cell: ({ row }) => (
          <SalesStatusBadge
            status={salesDayStatus(row.original)}
            tip={salesErrorText(row.original.sync_error) ?? undefined}
          />
        ),
      },
      {
        id: "actions",
        size: ROW_MENU_COLUMN_SIZE,
        minSize: ROW_MENU_COLUMN_SIZE,
        maxSize: ROW_MENU_COLUMN_SIZE,
        enableResizing: false,
        enableHiding: false,
        cell: ({ row }) => (
          <TableRowMenu
            actions={[
              {
                label: can("adjust")
                  ? "Исправить показатели"
                  : "Открыть показатели",
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
    [can, sync, busy, running, activeJobs, today, data.connected, data.timezone, setDrawer],
  );

  const table = useReactTable({
    data: filtered,
    columns,
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
  const changeSorting = (next: SortingState) => st.setSorting(next);

  const totals = useMemo(
    () =>
      Object.fromEntries(metricKeys.map((k) => [k, sumMetric(filtered, k)])) as Record<
        MetricKey,
        { value: number | null; known: number }
      >,
    [filtered],
  );
  const average = useMemo(() => averageCheckOf(filtered), [filtered]);
  const averageHint =
    average.value === null
      ? "Посчитается после обновления смен из Quick Resto"
      : average.known < filtered.length
        ? `По ${average.known} из ${countRu(filtered.length, "смены", "смен", "смен")}`
        : `${countRu(average.guests, "гостевой чек", "гостевых чека", "гостевых чеков")}`;
  const metricHint = (k: MetricKey) =>
    totals[k].value === null
      ? "Нет данных"
      : totals[k].known < filtered.length
        ? `По ${totals[k].known} из ${countRu(filtered.length, "смены", "смен", "смен")}`
        : undefined;

  const download = async () => {
    setExporting(true);
    try {
      const sorted = table.getSortedRowModel().rows;
      const records = unwrapAction(
        await exportSalesRows(sorted.map((r) => r.id)),
      );
      const byId = new Map(records.map((r) => [r.id, r]));
      const visible = table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== "actions");
      const lines: unknown[][] = [
        visible.map((c) =>
          c.id in metricLabels ? metricLabels[c.id as MetricKey] : labels[c.id],
        ),
        ...sorted.map((r) => {
          const d = byId.get(r.id);
          if (!d) throw new Error("Данные изменились. Обновите таблицу");
          return visible.map((c) =>
            c.id === "business_date"
              ? formatDateCell(d.business_date)
              : c.id === "status"
                ? salesStatuses[salesDayStatus(d)].label
                : c.id === "avg_check"
                  ? (() => {
                      const v = averageCheck(d);
                      return v === null ? null : Math.round(v * 100) / 100;
                    })()
                  : effectiveMetrics(d)[c.id as MetricKey],
          );
        }),
      ];
      const url = URL.createObjectURL(
        new Blob(
          ["﻿" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Смены-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выгрузить файл");
    } finally {
      setExporting(false);
    }
  };

  const lastSync = data.days.find((d) => d.business_date === today)?.synced_at;
  const refreshButton = can("sync") ? (
    <span
      className="inline-flex"
      data-tip={
        !data.connected
          ? "Сначала подключите Quick Resto"
          : !data.settings
            ? "Сначала настройте расчёт смен в карточке заведения"
            : currentRunning
              ? "Текущая смена обновляется"
              : lastSync
                ? `Обновлено ${formatDayMonthTime(lastSync, new Date(), data.timezone)}`
                : "Загрузить текущую смену из Quick Resto"
      }
    >
      <Button
        size="sm"
        disabled={busy || currentRunning || !data.connected || !data.settings}
        onClick={() => void sync([today])}
      >
        <RefreshCw
          className={
            busy || currentRunning
              ? "size-4 animate-spin motion-reduce:animate-none"
              : "size-4"
          }
        />
        {currentRunning ? "Обновляется…" : "Обновить смену"}
      </Button>
    </span>
  ) : null;

  const monthIsEmpty = monthDays.length === 0;
  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      {drawer && (
        <DayScreen
          key={drawer.n}
          day={drawer.day}
          tab={drawer.tab}
          timezone={data.timezone}
          canAdjust={can("adjust")}
          onBack={() => setDrawer(null)}
          onSaved={(d) => {
            setData((x) => ({
              ...x,
              days: x.days.map((r) => (r.id === d.id ? d : r)),
            }));
            setDrawer(null);
          }}
        />
      )}
      {/* Список остаётся смонтированным под экраном смены: фильтры,
          сортировка и страница таблицы те же после возврата. */}
      <div hidden={!!drawer}>
      <div className="flex min-w-0 flex-col gap-4">
      {!drawer && (
        <Breadcrumbs items={[{ label: "Продажи" }, { label: "Смены" }]} />
      )}
      <TablePageHeader
        title="Смены"
        count={
          isFiltered ? `${filtered.length} из ${monthDays.length}` : monthDays.length
        }
        period={
          <>
            <PeriodStepper
              previous="Предыдущий месяц"
              next="Следующий месяц"
              previousDisabled={month <= MIN_MONTH}
              onPrevious={() => setMonth((m) => shiftMonth(m, -1))}
              onNext={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <MonthPicker
                variant="period"
                prefix=""
                ariaLabel="Месяц смен"
                value={`${month}-01`}
                min={`${MIN_MONTH}-01`}
                onChange={(v) => setMonth(v.slice(0, 7))}
              />
            </PeriodStepper>
            {month !== currentMonth ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMonth(currentMonth)}
              >
                Сегодня
              </Button>
            ) : null}
          </>
        }
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: st.setSearch,
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: "Дата или комментарий",
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
                  columns={st.columnOrder
                    .filter((id) => id !== "actions")
                    .map((id) => {
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
            secondaryActions={
              can("configure") ? (
                <TableIconButton
                  label="Настройки продаж"
                  onClick={() => router.push("/sales/settings")}
                >
                  <Settings />
                </TableIconButton>
              ) : undefined
            }
            primaryActions={refreshButton}
          />
        }
      />
      <TableConditions
        label="Условия списка смен"
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
            label="Статус"
            value={status}
            onChange={setStatus}
            options={statusFilterOptions}
          />
        )}
      </TableConditions>

      {!data.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="min-w-0 flex-1">
            Quick Resto не подключён: показатели смен не обновляются
          </p>
          {can("configure") && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/integrations">Подключить Quick Resto</Link>
            </Button>
          )}
        </div>
      )}
      {refreshFailed && (
        <p role="status" className="text-sm text-muted-foreground">
          Не удалось обновить список, показаны прежние данные
        </p>
      )}

      {monthLoading && !monthDays.length ? (
        <div role="status" aria-label="Загружаем смены" aria-busy className="flex flex-col gap-4">
          <SalesBodySkeleton />
        </div>
      ) : !data.hasDays ? (
        <EmptyState
          icon={CalendarDays}
          title="Смен пока нет"
          description="Подключите Quick Resto и настройте расчёт смен в карточке заведения"
          action={
            can("configure") ? (
              <Button asChild>
                <Link href={"/sales/settings"}>
                  Настроить расчёт смен
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : monthIsEmpty ? (
        <EmptyState
          icon={CalendarDays}
          title="За этот месяц смен нет"
          description="Выберите другой месяц"
        />
      ) : !filtered.length ? (
        <EmptyState
          icon={SearchX}
          title="Смены не найдены"
          description="Измените условия поиска или сбросьте фильтры"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : (
        <>
          <MetricStrip label="Итоги за месяц">
            <TurnoverMetric
              label={metricLabels.turnover}
              value={totals.turnover.value}
              fallbackHint={
                metricHint("turnover") ??
                (isFiltered
                  ? "С учётом поиска и фильтров"
                  : `За ${countRu(filtered.length, "смену", "смены", "смен")}`)
              }
              // План — к обороту всего месяца: с фильтрами таблицы его не сравниваем.
              plan={monthLoading || isFiltered ? undefined : data.plan}
              month={month}
              today={today}
              days={monthDays}
              canConfigure={data.permissions.includes("sales.plan")}
            />
            <Metric
              label="Средний чек гостя"
              value={<AnimatedMoney value={average.value} />}
              hint={averageHint}
            />
            <Metric
              label={metricLabels.tips_total}
              value={<AnimatedMoney value={totals.tips_total.value} />}
              hint={metricHint("tips_total")}
            />
            <Metric
              label={metricLabels.deposits}
              value={<AnimatedMoney value={totals.deposits.value} />}
              hint={metricHint("deposits")}
            />
          </MetricStrip>
          <div
            aria-busy={monthLoading}
            className={`transition-opacity duration-300 ease-[var(--ease-soft)] ${monthLoading ? "opacity-60" : ""}`}
          >
          <DataTable
            table={table}
            label="Смены за месяц"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            numeric={[...metricKeys, "avg_check"]}
            onRowClick={(row) => setDrawer({ day: row.original, tab: "values" })}
            empty={null}
            totals={Object.fromEntries([
              [
                "avg_check",
                <span key="avg_check" data-tip={averageHint}>
                  <Money value={average.value} />
                </span>,
              ],
              ...metricKeys.map((k) => [
                k,
                <span key={k} data-tip={metricHint(k)}>
                  {counts.has(k) ? (
                    formatCount(totals[k].value)
                  ) : (
                    <Money value={totals[k].value} />
                  )}
                </span>,
              ]),
            ])}
            mobile={{
              label: "Карточки смен",
              nameColumn: "business_date",
              statusColumn: "status",
            }}
          />
          </div>
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filtered.length}
            hiddenCount={monthDays.length - filtered.length}
            onPageChange={(p) =>
              st.setPagination((x) => ({ ...x, pageIndex: p }))
            }
            onPageSizeChange={(size) =>
              st.setPagination({ pageIndex: 0, pageSize: size })
            }
          />
        </>
      )}
      </div>
      </div>
    </PageFrame>
  );
}
