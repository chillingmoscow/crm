"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  DrawerAvatar,
  DrawerSection,
  DrawerStatus,
  DrawerSummary,
  DrawerSummaryTotal,
  DrawerTimeline,
  DrawerTimelineItem,
} from "@/components/ui/drawer-blocks";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money, formatRub } from "@/components/shared/money";
import { MonthPicker } from "@/components/shared/month-picker";
import { PageFrame } from "@/components/shared/page-frame";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { SalesTrend, type TrendSeries } from "@/components/shared/sales-trend";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import {
  DataTable,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableIconButton,
  TablePageHeader,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import {
  additionalRows,
  additionalValue,
  additionalTotal,
  additionalCoverage,
  additionalNeedsRefresh,
  type AdditionalRow,
} from "@/lib/sales/additional-view";
import {
  defaultAdditionalRules,
  type AdditionalKind,
} from "@/lib/sales/additional";
import { dayLabel, formatQuantity, weekdayLabel } from "@/lib/sales/format";
import { addDays, businessDate } from "@/lib/sales/time";
import { csvCell } from "@/lib/sales/csv";
import { salesErrorText } from "@/lib/sales/errors";
import { formatDateCell, formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { DayTeamPanel } from "../_components/day-team";
import { DayDiscussionPanel } from "../_components/day-discussion";
import {
  loadAdditional,
  requestAdditional,
  exportAdditional,
  loadAdditionalHistory,
  type AdditionalData,
} from "./actions";
import { UpsellRulesEditor } from "./upsell-rules-editor";

const baseLabels: Record<string, string> = {
  date: "Дата",
  turnover: "Оборот заведения",
  revenue: "Выручка",
  primeCost: "Себестоимость",
  bonus: "Общая прибавка",
  points: "Баллы",
};
const kindLabels: Record<AdditionalKind, string> = {
  bar: "Бар",
  masters: "Кальяны",
};
const stateLabels = {
  ready: "Обновлено",
  pending: "Ожидает обновления",
  running: "Обновляется",
  error: "Не обновлено",
};
const moneyKeys = new Set(["turnover", "revenue", "primeCost", "bonus"]);
const MIN_MONTH = "2000-01";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Значение столбца: деньги — `Money`, количество и баллы — числом. */
function Value({ id, value }: { id: string; value: number | null }) {
  return moneyKeys.has(id) ? <Money value={value} /> : <>{formatQuantity(value)}</>;
}

function Detail({
  row,
  data,
  onClose,
}: {
  row: AdditionalRow;
  data: AdditionalData;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<Awaited<
      ReturnType<typeof loadAdditionalHistory>
    > | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (row.native)
      void loadAdditionalHistory(data.venueId, row.id)
        .then((r) => active && setHistory(r))
        .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [data.venueId, row.id, row.native]);
  const weekday = weekdayLabel(row.date);
  const state = row.native?.state;
  const stateTone =
    state === "error" ? "danger" : state === "ready" ? "success" : "info";
  return (
    <EditDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${kindLabels[row.kind]} · ${formatDayMonth(row.date) ?? ""}`}
      titleAccessory={
        row.archive ? (
          <DrawerStatus label="Архив Glide" tone="neutral" />
        ) : state && state !== "ready" ? (
          <DrawerStatus label={stateLabels[state]} tone={stateTone} />
        ) : undefined
      }
      description={`${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}${
        row.native?.synced_at
          ? ` · обновлено ${formatDayMonthTime(row.native.synced_at, new Date(), data.timezone)}`
          : ""
      }`}
      footer={
        <Button variant="outline" asChild>
          <Link
            href={`/sales/shifts?day=${row.date}&tab=values${row.archive ? "&source=archive" : ""}`}
          >
            Открыть смену
          </Link>
        </Button>
      }
    >
      <DrawerSummary label="Прибавка за день">
        <DrawerSummaryTotal
          label="Общая прибавка за день"
          hint={
            row.archive
              ? "Сумма из архива, без пересчёта"
              : "Делится между сотрудниками смены"
          }
        >
          <Money value={row.metrics?.bonus ?? null} />
        </DrawerSummaryTotal>
      </DrawerSummary>
      <Tabs defaultValue="details" className={tabStyle.tabs}>
        <TabsList aria-label="Разделы дня">
          <TabsTrigger value="details">Продажи</TabsTrigger>
          <TabsTrigger value="team">Команда</TabsTrigger>
          <TabsTrigger value="comments">Комментарии</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-9">
          {row.native && row.native.state !== "ready" && (
            <p
              role={row.native.state === "error" ? "alert" : "status"}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
            >
              {stateLabels[row.native.state]}
              {row.native.last_error
                ? `. ${salesErrorText(row.native.last_error)}`
                : ""}
              {row.metrics ? ". Показаны последние сохранённые данные" : ""}
            </p>
          )}
          <dl className="divide-y">
            {[
              "turnover",
              "revenue",
              "primeCost",
              ...(row.kind === "masters" ? ["points"] : []),
            ].map((key) => (
              <div key={key} className="flex justify-between gap-3 py-2.5 text-sm">
                <dt className="text-muted-foreground">{baseLabels[key]}</dt>
                <dd>
                  <Value id={key} value={additionalValue(row, key)} />
                </dd>
              </div>
            ))}
          </dl>
          <DrawerSection title="Продажи по категориям">
            <dl className="divide-y">
              {row.rules[row.kind].map((g) => (
                <div key={g.id} className="flex justify-between gap-4 py-2.5 text-sm">
                  <dt className="min-w-0">
                    <span className="break-words">{g.label}</span>
                    {row.native && (
                      <span className="block text-xs text-muted-foreground">
                        {row.kind === "bar"
                          ? `${formatRub(g.rate, { fraction: "auto" })} за продажу`
                          : `${formatQuantity(g.rate)} б. за продажу`}
                      </span>
                    )}
                  </dt>
                  <dd className="tabular-nums">
                    {formatQuantity(row.metrics?.quantities[g.id] ?? null)}
                  </dd>
                </div>
              ))}
            </dl>
          </DrawerSection>
          {row.kind === "masters" && row.native && (
            <DrawerSection title="Шкала прибавки">
              <ul className="space-y-1 text-sm">
                {row.rules.tiers.map((t, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      От {formatQuantity(t.from)} б.
                    </span>
                    <span className="tabular-nums">
                      {formatRub(t.rate, { fraction: "auto" })} за балл
                    </span>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}
        </TabsContent>
        <TabsContent value="team">
          <DayTeamPanel
            venueId={data.venueId}
            date={row.date}
            source={row.archive ? "archive" : "native"}
            archiveId={row.context?.archiveId}
            kind={row.kind}
          />
        </TabsContent>
        <TabsContent value="comments">
          <DayDiscussionPanel venueId={data.venueId} date={row.date} />
        </TabsContent>
        <TabsContent value="history">
          {row.archive ? (
            <DrawerSection
              title="Перенесено из Glide"
              description={`Снимок ${formatDayMonthTime(row.archive.captured_at, new Date(), data.timezone)}. Суммы сохранены без пересчёта`}
            >
              {row.archive.origin.ranges.map((range) => (
                <a
                  key={range}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm text-brand hover:underline"
                  href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(row.archive!.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(range)}`}
                >
                  Строка архива {range}
                </a>
              ))}
            </DrawerSection>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              Не удалось загрузить историю. Закройте день и откройте ещё раз
            </p>
          ) : history === null ? (
            <p className="text-sm text-muted-foreground" role="status">
              Загружаем историю…
            </p>
          ) : history.length ? (
            <DrawerTimeline>
              {history.map((h, i) => (
                <DrawerTimelineItem
                  key={h.id}
                  last={i === history.length - 1}
                  avatar={<DrawerAvatar name="Quick Resto" />}
                  title="Отчёт Quick Resto получен"
                  meta={formatDayMonthTime(h.created_at, new Date(), data.timezone) ?? undefined}
                >
                  <p className="text-muted-foreground">
                    Общая прибавка: {formatRub(h.metrics?.bonus ?? null)}
                  </p>
                </DrawerTimelineItem>
              ))}
            </DrawerTimeline>
          ) : (
            <p className="text-sm text-muted-foreground">
              Отчёт запрошен и ждёт данных из Quick Resto
            </p>
          )}
        </TabsContent>
      </Tabs>
    </EditDrawer>
  );
}

export function AdditionalClient({ initial }: { initial: AdditionalData }) {
  const [data, setData] = useState(initial),
    [kind, setKind] = useState<AdditionalKind>("bar"),
    [source, setSource] = useState<"native" | "archive">(
      initial.reports.some((r) => r.metrics)
        ? "native"
        : initial.archives.length
          ? "archive"
          : "native",
    );
  const latestMonth = (
    [
      ...initial.reports.map((r) => r.business_date),
      ...initial.archives.map((r) => r.business_date),
    ]
      .sort()
      .at(-1) ?? initial.nextFrom
  ).slice(0, 7);
  const currentMonth = businessDate(new Date(), initial.timezone, initial.hour).slice(0, 7);
  const [month, setMonth] = useState(latestMonth);
  const [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [rulesOpen, setRulesOpen] = useState(false),
    [detail, setDetail] = useState<AdditionalRow | null>(null);
  const can = (p: string) => data.permissions.includes(`sales.${p}_shifts`);
  const allRows = useMemo(
    () => additionalRows(data.reports, data.archives, source, kind, data),
    [data, source, kind],
  );
  const groups = useMemo(() => {
    const map = new Map(defaultAdditionalRules[kind].map((g) => [g.id, g]));
    for (const r of [...allRows].reverse())
      for (const g of r.rules[kind]) map.set(g.id, g);
    return [...map.values()];
  }, [allRows, kind]);
  const labels = useMemo(
    () => ({
      ...baseLabels,
      ...Object.fromEntries(groups.map((g) => [g.id, g.label])),
    }),
    [groups],
  );
  const cols = useMemo(
    () =>
      [
        "date",
        "bonus",
        "revenue",
        "primeCost",
        "turnover",
        ...(kind === "masters" ? ["points"] : []),
        ...groups.map((g) => g.id),
      ].map((id) => ({
        id,
        defaultSize: id === "date" ? 170 : 160,
        defaultVisible: ["date", "bonus", "revenue", "primeCost", "points"].includes(id),
      })),
    [groups, kind],
  );
  const st = useTableState({
    tableId: `sales-additional.v2.${data.venueId}.${kind}`,
    columns: cols,
  });
  const query = st.search.toLowerCase().trim();
  const monthRows = useMemo(
    () => allRows.filter((r) => r.date.startsWith(month)),
    [allRows, month],
  );
  const rows = useMemo(
    () =>
      monthRows.filter(
        (r) =>
          !query ||
          `${formatDateCell(r.date)} ${dayLabel(r.date)} ${weekdayLabel(r.date)}`
            .toLowerCase()
            .includes(query),
      ),
    [monthRows, query],
  );
  const expectedDays = query
    ? rows.length
    : additionalCoverage(
        `${month}-01`,
        addDays(data.nextFrom, -2),
        source === "native" ? data.rules.at(-1)?.valid_from : undefined,
      );
  const valueIds = cols.map((c) => c.id).filter((id) => id !== "date");
  const columns = useMemo<ColumnDef<AdditionalRow>[]>(
    () =>
      cols.map(({ id, defaultSize }) => ({
        id,
        header: labels[id],
        size: defaultSize,
        minSize: id === "date" ? 130 : Math.max(100, labels[id].length * 8 + 32),
        enableHiding: id !== "date",
        accessorFn: (r) =>
          id === "date" ? r.date : (additionalValue(r, id) ?? undefined),
        sortUndefined: "last",
        cell: ({ row }) =>
          id === "date" ? (
            <div className="min-w-0">
              <button
                className="block text-left font-medium tabular-nums hover:underline"
                type="button"
                onClick={() => setDetail(row.original)}
              >
                {formatDateCell(row.original.date)}
              </button>
              <span className="block truncate text-xs text-muted-foreground first-letter:uppercase">
                {row.original.native && row.original.native.state !== "ready"
                  ? stateLabels[row.original.native.state]
                  : weekdayLabel(row.original.date)}
              </span>
            </div>
          ) : (
            <Value id={id} value={additionalValue(row.original, id)} />
          ),
      })),
    [cols, labels],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
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
  const resetConditions = () => {
    st.setSearch("");
    st.setSorting([]);
  };

  async function refresh() {
    setBusy(true);
    try {
      await requestAdditional(month, data.venueId);
      setData(await loadAdditional(data.venueId));
      setSource("native");
      toast.success("Отчёты запрошены, они появятся автоматически");
    } catch (e) {
      toast.error(
        salesErrorText(e instanceof Error ? e.message : null, "Не удалось запросить отчёты"),
      );
    } finally {
      setBusy(false);
    }
  }
  const pending =
    data.configured &&
    source === "native" &&
    additionalNeedsRefresh(data.reports, `${month}-01`);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadAdditional(initial.venueId)
        .then((d) => {
          if (active) setData(d);
        })
        .catch(() => {});
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pending, initial.venueId]);
  async function download() {
    setExporting(true);
    try {
      const snapshot = await exportAdditional(data.venueId);
      const fresh = additionalRows(
        snapshot.reports,
        snapshot.archives,
        source,
        kind,
        snapshot,
      );
      const byDate = new Map(fresh.map((r) => [r.date, r]));
      const visible = table.getVisibleLeafColumns();
      const lines: unknown[][] = [
        [
          ...visible.map((c) => labels[c.id]),
          "Источник",
          "Обновлено",
          "Состояние",
          "Строки источника",
        ],
      ];
      for (const old of table.getSortedRowModel().rows) {
        const r = byDate.get(old.original.date);
        if (!r) throw new Error("Данные изменились. Обновите страницу");
        lines.push([
          ...visible.map((c) =>
            c.id === "date" ? formatDateCell(r.date) : additionalValue(r, c.id),
          ),
          r.archive ? "Архив Glide" : "Sheerly",
          r.archive?.captured_at ?? r.native?.synced_at ?? null,
          r.native ? stateLabels[r.native.state] : "Архив",
          r.archive?.origin.ranges.join(", ") ?? null,
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
      a.download = `Допродажи-${kindLabels[kind]}-${source === "archive" ? "архив-Glide-" : ""}${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выгрузить допродажи",
      );
    } finally {
      setExporting(false);
    }
  }

  const months = [...new Set(allRows.map((r) => r.date.slice(0, 7)))].sort();
  const series: Record<string, TrendSeries> = Object.fromEntries(
    groups.map((g) => [
      g.id,
      {
        label: g.label,
        unit: "шт. / день",
        points: months.map((m) => {
          const sum = additionalTotal(
            allRows.filter((r) => r.date.startsWith(m)),
            g.id,
          );
          return {
            month: m,
            value:
              sum.value === null
                ? null
                : Math.round((sum.value / sum.known) * 100) / 100,
          };
        }),
      },
    ]),
  );
  if (kind === "masters")
    series.points = {
      label: "Баллы за месяц",
      unit: "б.",
      title: "Баллы по месяцам",
      points: months.map((m) => ({
        month: m,
        value: additionalTotal(
          allRows.filter((r) => r.date.startsWith(m)),
          "points",
        ).value,
      })),
    };
  const chartSeries =
    kind === "masters"
      ? {
          points: series.points,
          ...Object.fromEntries(
            Object.entries(series).filter(([k]) => k !== "points"),
          ),
        }
      : series;
  const nativeStart = data.rules.at(-1)?.valid_from;
  const workedDays = rows.filter((r) => r.metrics).length;
  const stripKeys = ["bonus", "revenue", "primeCost"];
  const hintFor = (key: string) => {
    const sum = additionalTotal(rows, key);
    return sum.value === null
      ? "Нет данных"
      : sum.known < expectedDays
        ? `По ${sum.known} из ${countRu(expectedDays, "дня", "дней", "дней")}`
        : undefined;
  };

  const body = (
    <div className="flex min-w-0 flex-col gap-4">
      {source === "archive" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Допродажи из архива Glide, без пересчёта
        </p>
      ) : (
        nativeStart &&
        nativeStart.slice(0, 7) === month &&
        nativeStart.slice(8) !== "01" && (
          <p className="text-sm text-muted-foreground">
            Расчёт Sheerly ведётся с {formatDayMonth(nativeStart)}. Более
            ранние дни есть в архиве Glide
          </p>
        )
      )}
      {!monthRows.length ? (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="За этот месяц данных нет"
          description={
            source === "archive"
              ? "Выберите другой месяц или вернитесь к расчёту Sheerly"
              : data.configured
                ? "Запросите отчёты завершённых рабочих дней кнопкой «Обновить отчёты»"
                : "Источники допродаж пока не подключены"
          }
        />
      ) : !rows.length ? (
        <EmptyState
          icon={SearchX}
          title="Дни не найдены"
          description="Измените условия поиска"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : (
        <>
          <MetricStrip label="Итоги допродаж за месяц">
            {stripKeys.map((key, i) => (
              <Metric
                key={key}
                primary={i === 0}
                label={labels[key]}
                value={<Money value={additionalTotal(rows, key).value} />}
                hint={hintFor(key)}
              />
            ))}
            {kind === "masters" ? (
              <Metric
                label={labels.points}
                value={formatQuantity(additionalTotal(rows, "points").value)}
                hint={hintFor("points")}
              />
            ) : (
              <Metric
                label="Рабочих дней"
                value={workedDays}
                hint={
                  workedDays < expectedDays
                    ? `Данные по ${workedDays} из ${countRu(expectedDays, "дня", "дней", "дней")}`
                    : undefined
                }
              />
            )}
          </MetricStrip>
          <DataTable
            table={table}
            label={`Допродажи: ${kindLabels[kind]}`}
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={cols.map((c) => c.id)}
            numeric={valueIds}
            onRowClick={(row) => setDetail(row.original)}
            empty={null}
            totals={Object.fromEntries(
              valueIds.map((id) => [
                id,
                <span key={id} data-tip={hintFor(id)}>
                  <Value id={id} value={additionalTotal(rows, id).value} />
                </span>,
              ]),
            )}
            mobile={{ label: "Карточки дней", nameColumn: "date" }}
          />
        </>
      )}
      {allRows.length > 0 && (
        <SalesTrend
          key={`${source}-${kind}`}
          series={chartSeries}
          title="Среднее количество в день с данными"
        />
      )}
    </div>
  );

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Продажи" }, { label: "Допродажи" }]} />
      <TablePageHeader
        title="Допродажи"
        count={query ? `${rows.length} из ${monthRows.length}` : monthRows.length}
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
                ariaLabel="Месяц допродаж"
                value={`${month}-01`}
                min={`${MIN_MONTH}-01`}
                onChange={(v) => setMonth(v.slice(0, 7))}
              />
            </PeriodStepper>
            {month !== currentMonth ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
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
              placeholder: "Дата или день недели",
            }}
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={cols.map((c) => c.id)}
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
                        ? "Вернуться к расчёту Sheerly"
                        : "Архив Glide"
                    }
                    active={source === "archive"}
                    pressed={source === "archive"}
                    onClick={() => {
                      setSource(source === "archive" ? "native" : "archive");
                      setDetail(null);
                    }}
                  >
                    <Archive />
                  </TableIconButton>
                )}
                {data.departments.length > 0 && can("configure") && (
                  <TableIconButton
                    label="Правила расчёта"
                    onClick={() => setRulesOpen(true)}
                  >
                    <Settings2 />
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
              data.configured && can("sync") && source === "native" ? (
                <Button
                  size="sm"
                  className="h-9 gap-2"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  <RefreshCw
                    className={
                      busy ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"
                    }
                  />
                  {busy ? "Запрашиваем…" : "Обновить отчёты"}
                </Button>
              ) : undefined
            }
          />
        }
      />
      <TableConditions
        label="Условия списка допродаж"
        open={false}
        hasFilters={false}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={cols.map((c) => c.id)}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => st.setSearch("")}
        onReset={resetConditions}
      />
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as AdditionalKind);
          setDetail(null);
        }}
        className={tabStyle.tabs}
      >
        <TabsList aria-label="Вид допродаж">
          <TabsTrigger value="bar">{kindLabels.bar}</TabsTrigger>
          <TabsTrigger value="masters">{kindLabels.masters}</TabsTrigger>
        </TabsList>
        <TabsContent value={kind}>{body}</TabsContent>
      </Tabs>
      {detail && (
        <Detail
          key={detail.id}
          row={detail}
          data={data}
          onClose={() => setDetail(null)}
        />
      )}
      {rulesOpen && (
        <UpsellRulesEditor
          data={data}
          onClose={() => setRulesOpen(false)}
          onSaved={setData}
        />
      )}
    </PageFrame>
  );
}
