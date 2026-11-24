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
import { ChartNoAxesCombined, RefreshCw, SearchX, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
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
  additionalTabs,
  additionalValue,
  additionalTotal,
  additionalCoverage,
  additionalNeedsRefresh,
  departmentRows,
  readyUpsellResult,
  upsellUnknown,
  type AdditionalRow,
} from "@/lib/sales/additional-view";
import { defaultAdditionalRules } from "@/lib/sales/additional";
import { lineKey, type UpsellTarget } from "@/lib/sales/upsell";
import type { UpsellPickerItem } from "@/lib/sales/upsell-prefill";
import { dayLabel, formatQuantity, weekdayLabel } from "@/lib/sales/format";
import { addDays, businessDate } from "@/lib/sales/time";
import { csvCell } from "@/lib/sales/csv";
import { salesErrorText } from "@/lib/sales/errors";
import { formatDateCell, formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { DayTeamPanel } from "../_components/day-team";
import { DayDiscussionPanel } from "../_components/day-discussion";
import { unwrapAction } from "@/lib/actions/result";
import {
  loadAdditional,
  requestAdditional,
  exportAdditional,
  loadAdditionalHistory,
  type AdditionalData,
} from "./actions";
import { TARGET_LABEL } from "./upsell-labels";

const baseLabels: Record<string, string> = {
  date: "Дата",
  turnover: "Оборот заведения",
  revenue: "Выручка",
  primeCost: "Себестоимость",
  bonus: "Общая прибавка",
  points: "Баллы",
};
const stateLabels = {
  ready: "Обновлено",
  pending: "Ожидает обновления",
  running: "Обновляется",
  error: "Не обновлено",
};
const moneyKeys = new Set(["turnover", "revenue", "primeCost", "bonus"]);
const MIN_MONTH = "2000-01";
const NAMES_SHOWN = 8;
const baseIds = new Set(["date", "bonus", "revenue", "primeCost", "turnover", "points"]);

type PickerByKey = Map<string, UpsellPickerItem>;

/** Состояние строки: отчёт старой очереди или расчёт дня по чекам. */
function rowState(r: AdditionalRow) {
  return r.upsell ? (r.upsell.day?.state ?? "pending") : r.native?.state;
}

/** «Негрони, код 2041 и ещё 3»: позиции чеков не из номенклатуры. */
function unknownNames(list: { key: string }[], picker: PickerByKey) {
  const shown = list
    .slice(0, NAMES_SHOWN)
    .map((u) => picker.get(u.key)?.name ?? `код ${u.key.slice(u.key.indexOf(":") + 1)}`);
  const rest = list.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` и ещё ${rest}` : "");
}

/** Строки правил дня новой схемы: цель, продано, ставка, сумма и итог. */
function UpsellSales({ row, picker }: { row: AdditionalRow; picker: PickerByKey }) {
  const u = row.upsell!;
  const result = readyUpsellResult(u.day);
  const sold = new Map((result?.lines ?? []).map((l) => [l.key, l]));
  const own = new Set(u.lines.map(lineKey));
  const items = [
    ...u.lines.map((l) => ({
      key: lineKey(l),
      target: l.target,
      name: l.name,
      rate: l.rate as number | null,
    })),
    // Строка расчёта без строки в версии (версию на эту дату заменили):
    // показываем, чтобы итог сходился со строками.
    ...(result?.lines ?? [])
      .filter((l) => !own.has(l.key))
      .map((l) => ({
        key: l.key,
        target: l.key.slice(0, l.key.indexOf(":")) as UpsellTarget,
        name: picker.get(l.key)?.name ?? l.key,
        rate: l.quantity ? Math.round((l.amount / l.quantity) * 100) / 100 : null,
      })),
  ];
  return (
    <DrawerSection title="Продажи по правилам">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">В правилах нет позиций</p>
      ) : (
        <dl className="divide-y">
          {items.map((it) => {
            const line = sold.get(it.key),
              item = picker.get(it.key);
            return (
              <div key={it.key} className="flex justify-between gap-4 py-2.5 text-sm">
                <dt className="min-w-0">
                  <span className="break-words">{item?.name ?? it.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {TARGET_LABEL[it.target] ?? "Позиция"}
                    {item?.path && ` · ${item.path}`}
                  </span>
                  {it.rate !== null && (
                    <span className="block text-xs text-muted-foreground">
                      {formatRub(it.rate, { fraction: "auto" })} за штуку
                    </span>
                  )}
                </dt>
                <dd className="shrink-0 text-right tabular-nums">
                  {line ? formatRub(line.amount, { fraction: "auto" }) : "—"}
                  <span className="block text-xs text-muted-foreground">
                    Продано {formatQuantity(line ? line.quantity : null)}
                  </span>
                </dd>
              </div>
            );
          })}
          <div className="flex justify-between gap-4 py-2.5 text-sm font-medium">
            <dt>Итого</dt>
            <dd className="tabular-nums">
              <Money value={result ? result.bonus : null} />
            </dd>
          </div>
        </dl>
      )}
    </DrawerSection>
  );
}

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
  name,
  picker,
  onClose,
}: {
  row: AdditionalRow;
  data: AdditionalData;
  /** Название подразделения (вкладки). */
  name: string;
  picker: PickerByKey;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<
      | (Awaited<ReturnType<typeof loadAdditionalHistory>> & { ok: true })["data"]
      | null
    >(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (row.native)
      void loadAdditionalHistory(data.venueId, row.id)
        .then(unwrapAction)
        .then((r) => active && setHistory(r))
        .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [data.venueId, row.id, row.native]);
  const weekday = weekdayLabel(row.date);
  const state = rowState(row);
  const stateTone =
    state === "error" ? "danger" : state === "ready" ? "success" : "info";
  const day = row.upsell?.day ?? null;
  const bonus = additionalValue(row, "bonus");
  const unknown = row.upsell ? (readyUpsellResult(day)?.unknown ?? []) : [];
  const updated = row.native?.synced_at
    ? ` · обновлено ${formatDayMonthTime(row.native.synced_at, new Date(), data.timezone)}`
    : day?.computed_at && state === "ready"
      ? ` · посчитано ${formatDayMonthTime(day.computed_at, new Date(), data.timezone)}`
      : "";
  return (
    <EditDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${name} · ${formatDayMonth(row.date) ?? ""}`}
      titleAccessory={
        row.archive ? (
          <DrawerStatus label="Архив Glide" tone="neutral" />
        ) : state && state !== "ready" ? (
          <DrawerStatus label={stateLabels[state]} tone={stateTone} />
        ) : undefined
      }
      description={`${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}${updated}`}
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
              : bonus === null && row.upsell
                ? state === "error"
                  ? "Нет данных: день не удалось посчитать"
                  : "Нет данных: день ещё не посчитан"
                : "Делится между сотрудниками смены"
          }
        >
          <Money value={bonus} />
        </DrawerSummaryTotal>
      </DrawerSummary>
      <Tabs defaultValue="details" className={tabStyle.tabs}>
        <TabsList aria-label="Разделы дня">
          <TabsTrigger value="details">Продажи</TabsTrigger>
          <TabsTrigger value="team">Команда</TabsTrigger>
          <TabsTrigger value="comments">Комментарии</TabsTrigger>
          {!row.upsell && <TabsTrigger value="history">История</TabsTrigger>}
        </TabsList>
        <TabsContent value="details" className="space-y-9">
          {row.upsell
            ? state !== "ready" && (
                <p
                  role={state === "error" ? "alert" : "status"}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
                >
                  {day ? stateLabels[day.state] : "Расчёт по чекам ещё не готов"}
                  {day?.last_error ? `. ${salesErrorText(day.last_error)}` : ""}
                </p>
              )
            : row.native &&
              row.native.state !== "ready" && (
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
          {unknown.length > 0 && (
            <p
              role="status"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
            >
              В чеках есть позиции не из номенклатуры: {unknownNames(unknown, picker)}.
              День посчитан по известным позициям
            </p>
          )}
          <dl className="divide-y">
            {[
              "turnover",
              "revenue",
              "primeCost",
              ...(row.kind === "masters" && !row.upsell ? ["points"] : []),
            ].map((key) => (
              <div key={key} className="flex justify-between gap-3 py-2.5 text-sm">
                <dt className="text-muted-foreground">{baseLabels[key]}</dt>
                <dd>
                  <Value id={key} value={additionalValue(row, key)} />
                </dd>
              </div>
            ))}
          </dl>
          {row.upsell ? (
            <UpsellSales row={row} picker={picker} />
          ) : (
            row.kind && (
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
            )
          )}
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
            kind={row.kind ?? undefined}
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
  const router = useRouter();
  const [data, setData] = useState(initial),
    [tabId, setTabId] = useState<string | null>(null);
  const latestMonth = (
    [
      ...initial.reports.map((r) => r.business_date),
      ...initial.archives.map((r) => r.business_date),
      ...initial.upsellDays.map((r) => r.business_date),
    ]
      .sort()
      .at(-1) ?? initial.nextFrom
  ).slice(0, 7);
  const currentMonth = businessDate(new Date(), initial.timezone, initial.hour).slice(0, 7);
  const [month, setMonth] = useState(latestMonth);
  const [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [detail, setDetail] = useState<AdditionalRow | null>(null);
  const can = (p: string) => data.permissions.includes(`sales.${p}_shifts`);
  const tabs = useMemo(() => additionalTabs(data), [data]);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0] ?? null;
  const kind = tab?.legacyKind ?? null;
  const picker = useMemo<PickerByKey>(
    () => new Map(data.picker.map((p) => [p.key, p])),
    [data.picker],
  );
  const allRows = useMemo(
    () => (tab ? departmentRows(data, tab.id) : []),
    [data, tab],
  );
  const hasLegacyRows = allRows.some((r) => !r.upsell);
  /** Колонки старых категорий — пока у подразделения есть дни до перехода. */
  const legacyGroups = useMemo(() => {
    if (!kind || !hasLegacyRows) return [];
    const map = new Map(defaultAdditionalRules[kind].map((g) => [g.id, g]));
    for (const r of [...allRows].reverse())
      if (!r.upsell) for (const g of r.rules[kind]) map.set(g.id, g);
    return [...map.values()].map((g) => ({ id: g.id, label: g.label }));
  }, [allRows, kind, hasLegacyRows]);
  /** Колонки строк правил: порядок и названия — из новейшей версии. */
  const upsellGroups = useMemo(() => {
    const map = new Map<string, string>();
    if (tab)
      for (const v of data.upsellRules)
        if (v.department_id === tab.id)
          for (const l of v.lines) if (!map.has(lineKey(l))) map.set(lineKey(l), l.name);
    return [...map.entries()].map(([id, name]) => ({
      id,
      label: picker.get(id)?.name ?? name,
    }));
  }, [data.upsellRules, tab, picker]);
  const groups = useMemo(
    () => [...legacyGroups, ...upsellGroups],
    [legacyGroups, upsellGroups],
  );
  const labels = useMemo(
    () => ({
      ...baseLabels,
      ...Object.fromEntries(groups.map((g) => [g.id, g.label])),
    }),
    [groups],
  );
  const hasPoints = kind === "masters" && hasLegacyRows;
  const cols = useMemo(
    () =>
      [
        "date",
        "bonus",
        "revenue",
        "primeCost",
        "turnover",
        ...(hasPoints ? ["points"] : []),
        ...groups.map((g) => g.id),
      ].map((id) => ({
        id,
        defaultSize: id === "date" ? 170 : 160,
        defaultVisible: ["date", "bonus", "revenue", "primeCost", "points"].includes(id),
      })),
    [groups, hasPoints],
  );
  const st = useTableState({
    // У «Бара» и «Кальянов» ключ прежний: сохранённые столбцы не теряются.
    tableId: `sales-additional.v2.${data.venueId}.${kind && !tab?.id.startsWith("legacy:") ? kind : (tab?.id ?? "none")}`,
    columns: cols,
  });
  const query = st.search.toLowerCase().trim();
  const monthRows = useMemo(
    () => allRows.filter((r) => r.date.startsWith(month)),
    [allRows, month],
  );
  /**
   * Столбцы месяца: старые категории и баллы — только если в месяце есть
   * дни до перехода, строки правил — только версий, действующих в месяце.
   */
  const monthIds = useMemo(() => {
    const legacy = monthRows.filter((r) => !r.upsell);
    const keys = new Set(
      monthRows.flatMap((r) => r.upsell?.lines.map(lineKey) ?? []),
    );
    const legacyIds = new Set(legacyGroups.map((g) => g.id));
    return new Set(
      cols
        .map((c) => c.id)
        .filter((id) =>
          id === "points"
            ? legacy.length > 0
            : legacyIds.has(id)
              ? legacy.length > 0 || !monthRows.length
              : baseIds.has(id) || keys.has(id),
        ),
    );
  }, [cols, monthRows, legacyGroups]);
  const monthCols = useMemo(
    () => cols.filter((c) => monthIds.has(c.id)),
    [cols, monthIds],
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
  // Первый день с данными: архив Glide раньше расчёта Sheerly.
  const firstDay =
    [
      ...(kind
        ? [
            data.rules.at(-1)?.valid_from,
            ...data.archives.filter((a) => a.kind === kind).map((a) => a.business_date),
          ]
        : [tab?.switchDate ?? undefined]),
    ]
      .filter((d): d is string => !!d)
      .sort()[0];
  const expectedDays = query
    ? rows.length
    : additionalCoverage(`${month}-01`, addDays(data.nextFrom, -2), firstDay);
  const valueIds = monthCols.map((c) => c.id).filter((id) => id !== "date");
  const columns = useMemo<ColumnDef<AdditionalRow>[]>(
    () =>
      monthCols.map(({ id, defaultSize }) => ({
        id,
        header: labels[id],
        size: defaultSize,
        minSize: id === "date" ? 130 : Math.max(100, labels[id].length * 8 + 32),
        enableHiding: id !== "date",
        accessorFn: (r) =>
          id === "date" ? r.date : (additionalValue(r, id) ?? undefined),
        sortUndefined: "last",
        cell: ({ row }) => {
          if (id !== "date")
            return <Value id={id} value={additionalValue(row.original, id)} />;
          const state = rowState(row.original);
          return (
            <div className="min-w-0">
              <button
                className="block text-left font-medium tabular-nums hover:underline"
                type="button"
                onClick={() => setDetail(row.original)}
              >
                {formatDateCell(row.original.date)}
              </button>
              <span className="block truncate text-xs text-muted-foreground first-letter:uppercase">
                {state && state !== "ready"
                  ? stateLabels[state]
                  : weekdayLabel(row.original.date)}
              </span>
            </div>
          );
        },
      })),
    [monthCols, labels],
  );
  const monthSorting = useMemo(
    () => st.sorting.filter((x) => monthIds.has(x.id)),
    [st.sorting, monthIds],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    state: {
      // Состояние таблицы знает столбцы всех версий правил, а в таблице —
      // только столбцы месяца: сортировка по отсутствующему столбцу заставила бы
      // TanStack искать его и ругаться в консоль на каждом рендере.
      sorting: monthSorting,
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
  const sortFields = monthCols.map((c) => c.id);
  const changeSorting = (next: SortingState) => st.setSorting(next);
  const resetConditions = () => {
    st.setSearch("");
    st.setSorting([]);
  };

  async function refresh() {
    setBusy(true);
    try {
      unwrapAction(await requestAdditional(month, data.venueId));
      setData(unwrapAction(await loadAdditional(data.venueId)));
      toast.success("Пересчёт месяца запущен, дни обновятся автоматически");
    } catch (e) {
      toast.error(
        salesErrorText(e instanceof Error ? e.message : null, "Не удалось запросить отчёты"),
      );
    } finally {
      setBusy(false);
    }
  }
  const pending =
    ((data.configured && additionalNeedsRefresh(data.reports, `${month}-01`)) ||
      data.upsellDays.some(
        (d) =>
          d.business_date.startsWith(month) &&
          (d.state === "pending" || d.state === "running"),
      ));
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadAdditional(initial.venueId)
        .then(unwrapAction)
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
    if (!tab) return;
    setExporting(true);
    try {
      const snapshot = unwrapAction(await exportAdditional(data.venueId));
      const fresh = departmentRows(snapshot, tab.id);
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
        if (!r || !!r.upsell !== !!old.original.upsell)
          throw new Error("Данные изменились. Обновите страницу");
        const state = rowState(r);
        lines.push([
          ...visible.map((c) =>
            c.id === "date" ? formatDateCell(r.date) : additionalValue(r, c.id),
          ),
          r.archive ? "Архив Glide" : r.upsell ? "Sheerly, по чекам" : "Sheerly",
          r.archive?.captured_at ?? r.native?.synced_at ?? r.upsell?.day?.computed_at ?? null,
          state ? stateLabels[state] : "Архив",
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
      a.download = `Допродажи-${tab.name}-${month}.csv`;
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
  if (hasPoints)
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
  const chartSeries = hasPoints
    ? {
        points: series.points,
        ...Object.fromEntries(
          Object.entries(series).filter(([k]) => k !== "points"),
        ),
      }
    : series;
  const switchDate = tab?.switchDate ?? null;
  const workedDays = rows.filter((r) => additionalValue(r, "bonus") !== null).length;
  const stripKeys = ["bonus", "revenue", "primeCost"];
  const monthPoints = monthIds.has("points");
  const unknown = upsellUnknown(monthRows);
  const archiveDays = monthRows.filter((r) => r.archive).map((r) => r.date).sort();
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
      {archiveDays.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {archiveDays.length === monthRows.length
            ? "Допродажи этого месяца — из архива Glide, без пересчёта"
            : `Дни по ${formatDayMonth(archiveDays.at(-1)!)} — из архива Glide, без пересчёта`}
        </p>
      )}
      {switchDate && switchDate.slice(0, 7) === month ? (
        <p className="text-sm text-muted-foreground">
          С {formatDayMonth(switchDate)} прибавка считается по чекам по правилам
          подразделения
          {kind && switchDate.slice(8) !== "01"
            ? ". Более ранние дни посчитаны по отчётам Quick Resto"
            : ""}
        </p>
      ) : null}
      {unknown.length > 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          В чеках есть позиции не из номенклатуры: {unknownNames(unknown, picker)}.
          Дни посчитаны по известным позициям и пересчитаются после обновления
          номенклатуры
        </p>
      )}
      {!monthRows.length ? (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="За этот месяц данных нет"
          description={
            switchDate
              ? "Дни появятся после загрузки чеков в «Сменах»"
              : data.configured
                ? "Посчитайте завершённые рабочие дни кнопкой «Пересчитать месяц»"
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
            {monthPoints ? (
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
            label={`Допродажи: ${tab?.name ?? ""}`}
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
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
      {allRows.length > 0 && groups.length > 0 && (
        <SalesTrend
          key={tab?.id}
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
                  fields={sortFields}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder
                    // Только столбцы месяца: getColumn на чужой id пишет ошибку в консоль.
                    .filter((id) => monthIds.has(id))
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
            secondaryActions={
              data.departments.length > 0 && can("configure") ? (
                <TableIconButton
                  label="Правила допродаж"
                  onClick={() => router.push("/sales/additional/rules")}
                >
                  <Settings />
                </TableIconButton>
              ) : undefined
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
              data.configured && can("sync") ? (
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
                  {busy ? "Запускаем…" : "Пересчитать месяц"}
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
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => st.setSearch("")}
        onReset={resetConditions}
      />
      {tab ? (
        <Tabs
          value={tab.id}
          onValueChange={(v) => {
            setTabId(v);
            setDetail(null);
          }}
          className={tabStyle.tabs}
        >
          <TabsList aria-label="Подразделение">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.name}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab.id}>{body}</TabsContent>
        </Tabs>
      ) : (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="Допродажи не настроены"
          description={
            can("configure") && data.departments.length > 0
              ? "Задайте правила подразделения кнопкой «Правила допродаж»"
              : "Правила допродаж задаёт управляющий"
          }
        />
      )}
      {detail && tab && (
        <Detail
          key={detail.id}
          row={detail}
          data={data}
          name={tab.name}
          picker={picker}
          onClose={() => setDetail(null)}
        />
      )}
    </PageFrame>
  );
}
