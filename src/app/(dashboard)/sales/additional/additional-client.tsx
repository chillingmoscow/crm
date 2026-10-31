"use client";
import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { RefreshCw, Settings2, ChartNoAxesCombined } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageFrame } from "@/components/shared/page-frame";
import { MonthPicker } from "@/components/shared/month-picker";
import { SalesTrend } from "@/components/shared/sales-trend";
import {
  ResizableTableHead,
  TableColumnManager,
  TableControls,
  TablePageHeader,
  useMultiSort,
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
import { dayLabel, money } from "@/lib/sales/format";
import { addDays } from "@/lib/sales/time";
import { csvCell } from "@/lib/sales/csv";
import { cn } from "@/lib/utils";
import {
  loadAdditional,
  requestAdditional,
  exportAdditional,
  loadAdditionalHistory,
  type AdditionalData,
} from "./actions";
import { AdditionalRulesEditor } from "./additional-rules";
const labels: Record<string, string> = {
  date: "Дата",
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
const dateTime = (value: string, timezone: string) =>
  new Date(value).toLocaleString("ru-RU", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  });
const unit = (key: string) =>
  ["revenue", "primeCost", "bonus"].includes(key) ? "₽" : "";
const quantityFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 8,
});
const display = (value: number | null, key: string) =>
  value === null
    ? "—"
    : unit(key)
      ? money(value)
      : quantityFormat.format(value);
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
  return (
    <EditDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={dayLabel(row.date)}
      description={`${row.kind === "bar" ? "Бар" : "Кальяны"} · ${row.archive ? "Архив Glide" : "Sheerly"}`}
    >
      <div className="rounded-xl bg-brand/5 p-5">
        <p className="text-sm text-muted-foreground">Общая прибавка за день</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {money(row.metrics?.bonus ?? null)} {row.metrics && "₽"}
        </p>
      </div>
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Детали</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-4 space-y-5">
          {row.native && row.native.state !== "ready" && (
            <p className="rounded-lg bg-muted p-3 text-sm">
              {stateLabels[row.native.state]}
              {row.native.last_error ? `. ${row.native.last_error}` : ""}
              {row.metrics && " Показаны последние сохранённые данные."}
            </p>
          )}
          <dl className="divide-y">
            {[
              "revenue",
              "primeCost",
              ...(row.kind === "masters" ? ["points"] : []),
            ].map((key) => (
              <div
                key={key}
                className="flex justify-between gap-3 py-3 text-sm"
              >
                <dt className="text-muted-foreground">{labels[key]}</dt>
                <dd className="tabular-nums">
                  {display(additionalValue(row, key), key)}{" "}
                  {additionalValue(row, key) !== null && unit(key)}
                </dd>
              </div>
            ))}
          </dl>
          <section>
            <h3 className="font-semibold">Продажи по категориям</h3>
            <dl className="mt-2 divide-y">
              {row.rules[row.kind].map((g) => (
                <div
                  key={g.id}
                  className="flex justify-between gap-4 py-3 text-sm"
                >
                  <dt>
                    <span>{g.label}</span>
                    {row.native && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {money(g.rate)}{" "}
                        {row.kind === "bar" ? "₽ за продажу" : "б. за продажу"}
                      </span>
                    )}
                  </dt>
                  <dd className="tabular-nums">
                    {display(row.metrics?.quantities[g.id] ?? null, g.id)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {row.kind === "masters" && row.native && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              {row.rules.tiers
                .map((t) => `От ${money(t.from)} б. — ${money(t.rate)} ₽/б.`)
                .join(" · ")}
            </div>
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-4 space-y-4">
          {row.archive ? (
            <>
              <p className="text-sm">
                Снимок Glide ·{" "}
                {dateTime(row.archive.captured_at, data.timezone)}
              </p>
              {row.archive.origin.ranges.map((range) => (
                <a
                  key={range}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm text-brand hover:underline"
                  href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(row.archive!.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(range)}`}
                >
                  {range}
                </a>
              ))}
            </>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              Не удалось загрузить историю. Закройте карточку и откройте ещё
              раз.
            </p>
          ) : history === null ? (
            <p className="text-sm text-muted-foreground" role="status">
              Загружаем историю…
            </p>
          ) : history.length ? (
            <ol className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="py-3 text-sm">
                  <p className="font-medium">Обновлено автоматически</p>
                  <p className="mt-1 text-muted-foreground">
                    {dateTime(h.created_at, data.timezone)}
                  </p>
                  <p className="mt-1 tabular-nums">
                    Общая прибавка · {money(h.metrics?.bonus ?? null)} ₽
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Отчёт запрошен и ожидает получения данных.
            </p>
          )}
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        {row.archive
          ? "Архивные суммы сохранены без пересчёта."
          : row.native?.synced_at
            ? `Обновлено ${dateTime(row.native.synced_at, data.timezone)} · рабочий день с ${data.hour}:00`
            : "Завершённый рабочий день"}
      </p>
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
  const [month, setMonth] = useState(
    (
      [
        ...initial.reports.map((r) => r.business_date),
        ...initial.archives.map((r) => r.business_date),
      ]
        .sort()
        .at(-1) ?? initial.nextFrom
    ).slice(0, 7) + "-01",
  );
  const [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [rulesOpen, setRulesOpen] = useState(false),
    [detail, setDetail] = useState<AdditionalRow | null>(null);
  const allRows = useMemo(
    () => additionalRows(data.reports, data.archives, source, kind),
    [data, source, kind],
  );
  const groups = useMemo(() => {
    const map = new Map(defaultAdditionalRules[kind].map((g) => [g.id, g]));
    for (const r of [...allRows].reverse())
      for (const g of r.rules[kind]) map.set(g.id, g);
    return [...map.values()];
  }, [allRows, kind]);
  const names = useMemo(
    () => ({
      ...labels,
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
        ...(kind === "masters" ? ["points"] : []),
        ...groups.map((g) => g.id),
      ].map((id) => ({
        id,
        defaultSize: id === "date" ? 190 : 165,
        defaultVisible: [
          "date",
          "bonus",
          "revenue",
          "primeCost",
          "points",
        ].includes(id),
      })),
    [groups, kind],
  );
  const st = useTableState({
    tableId: `sales-additional.v1.${data.venueId}.${kind}`,
    columns: cols,
  });
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          r.date.startsWith(month.slice(0, 7)) &&
          dayLabel(r.date)
            .toLowerCase()
            .includes(st.search.toLowerCase().trim()),
      ),
    [allRows, month, st.search],
  );
  const expectedDays = st.search.trim()
    ? rows.length
    : additionalCoverage(
        month,
        addDays(data.nextFrom, -2),
        source === "native" ? data.rules.at(-1)?.valid_from : undefined,
      );
  const columns = useMemo<ColumnDef<AdditionalRow>[]>(
    () =>
      cols.map(({ id, defaultSize }) => ({
        id,
        header: names[id],
        size: defaultSize,
        accessorFn: (r) =>
          id === "date" ? r.date : (additionalValue(r, id) ?? undefined),
        sortUndefined: "last",
        cell: ({ row }) =>
          id === "date" ? (
            <button
              className="flex flex-col gap-1 text-left hover:text-brand"
              type="button"
              onClick={() => setDetail(row.original)}
            >
              <span className="font-medium">{dayLabel(row.original.date)}</span>
              {row.original.native && row.original.native.state !== "ready" && (
                <span className="text-xs text-muted-foreground">
                  {stateLabels[row.original.native.state]}
                </span>
              )}
            </button>
          ) : (
            <span className="tabular-nums">
              {display(additionalValue(row.original, id), id)}
              {additionalValue(row.original, id) !== null && (
                <span className="ml-1 text-muted-foreground">{unit(id)}</span>
              )}
            </span>
          ),
      })),
    [cols, names],
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
  type Sort = `${string}:${"asc" | "desc"}`;
  const multi = useMultiSort({
    sorts: st.sorting.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}` as Sort),
    onChange: (v) =>
      st.setSorting(
        v.map((s) => ({ id: s.split(":")[0], desc: s.endsWith(":desc") })),
      ),
    columnToField: Object.fromEntries(cols.map((c) => [c.id, c.id])),
    codec: {
      toField: (s) => s.split(":")[0],
      toDirection: (s) => (s.endsWith(":desc") ? "desc" : "asc"),
      combine: (f, d) => `${f}:${d}` as Sort,
    },
  });
  async function refresh() {
    setBusy(true);
    try {
      await requestAdditional(month.slice(0, 7), data.venueId);
      setData(await loadAdditional(data.venueId));
      setSource("native");
      toast.success("Отчёты запрошены. Они появятся автоматически.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось запросить отчёты",
      );
    } finally {
      setBusy(false);
    }
  }
  const pending =
    data.configured &&
    source === "native" &&
    additionalNeedsRefresh(data.reports, month);
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
      );
      const byDate = new Map(fresh.map((r) => [r.date, r]));
      const columns = table.getVisibleLeafColumns();
      const lines: unknown[][] = [
        [
          ...columns.map((c) => names[c.id]),
          "Источник",
          "Обновлено",
          "Состояние",
          "Строки источника",
        ],
      ];
      for (const old of table.getRowModel().rows) {
        const r = byDate.get(old.original.date);
        if (!r) throw new Error("Данные изменились. Обновите страницу");
        lines.push([
          ...columns.map((c) =>
            c.id === "date" ? r.date : additionalValue(r, c.id),
          ),
          r.archive ? "Архив Glide" : "Sheerly",
          r.archive?.captured_at ?? r.native?.synced_at ?? null,
          r.native ? stateLabels[r.native.state] : "Архив",
          r.archive?.origin.ranges.join(", ") ?? null,
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
      a.download = `Допродажи-${kind}-${source}-${month.slice(0, 7)}.csv`;
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
  const series = Object.fromEntries(
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
  return (
    <PageFrame className="space-y-6">
      <TablePageHeader
        title="Допродажи"
        actions={
          data.configured &&
          data.permissions.includes("sales.configure_shifts") ? (
            <Button variant="outline" onClick={() => setRulesOpen(true)}>
              <Settings2 className="mr-2 size-4" />
              Правила расчёта
            </Button>
          ) : undefined
        }
      />
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as AdditionalKind);
          setDetail(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="bar">Бар</TabsTrigger>
          <TabsTrigger value="masters">Кальяны</TabsTrigger>
        </TabsList>
        <TabsContent value={kind} className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <div className="w-48">
                <MonthPicker
                  value={month}
                  min="2000-01-01"
                  onChange={setMonth}
                  variant="field"
                  prefix=""
                  ariaLabel="Месяц допродаж"
                />
              </div>
              <Select
                value={source}
                onValueChange={(v) => {
                  setSource(v as typeof source);
                  setDetail(null);
                }}
              >
                <SelectTrigger className="w-40" aria-label="Источник допродаж">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="native">Sheerly</SelectItem>
                  <SelectItem value="archive">Архив Glide</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TableControls
              search={{
                value: st.search,
                onChange: st.setSearch,
                open: st.searchOpen,
                onOpenChange: st.setSearchOpen,
                placeholder: "Дата",
              }}
              sort={{
                active: st.sorting.length > 0,
                content: (
                  <div className="space-y-1 p-2">
                    {cols.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        className="flex w-full items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-muted"
                        onClick={() => multi.cycleSort(c.id)}
                      >
                        {names[c.id]}
                        {multi.headerIndicator(c.id)}
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
                    columns={table.getAllLeafColumns().map((c) => ({
                      id: c.id,
                      label: names[c.id],
                      visible: c.getIsVisible(),
                      canHide: c.id !== "date",
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
                data.configured &&
                data.permissions.includes("sales.sync_shifts") ? (
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={busy}
                    aria-label="Обновить допродажи Quick Resto"
                    onClick={() => void refresh()}
                  >
                    <RefreshCw
                      className={cn(
                        "size-4",
                        busy && "animate-spin motion-reduce:animate-none",
                      )}
                    />
                  </Button>
                ) : undefined
              }
            />
          </div>
          {rows.length ? (
            <>
              <section
                className="grid grid-cols-2 gap-y-5 rounded-lg border py-5 sm:grid-cols-4"
                aria-label="Итоги допродаж"
              >
                {[
                  "revenue",
                  "primeCost",
                  "bonus",
                  kind === "masters" ? "points" : "days",
                ].map((key) => {
                  const sum = additionalTotal(rows, key);
                  return (
                    <div
                      key={key}
                      className="min-w-0 px-4 sm:border-r sm:px-5 sm:last:border-0"
                    >
                      <p className="text-sm text-muted-foreground">
                        {key === "days" ? "Рабочих дней" : names[key]}
                      </p>
                      <p className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">
                        {key === "days"
                          ? rows.filter((r) => r.metrics).length
                          : display(sum.value, key)}
                        <span className="ml-1 text-base font-normal text-muted-foreground">
                          {sum.value !== null && unit(key)}
                        </span>
                      </p>
                      {key !== "days" && sum.known < expectedDays && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Данные: {sum.known} из {expectedDays} дней
                        </p>
                      )}
                    </div>
                  );
                })}
              </section>
              <div className="overflow-hidden rounded-lg border">
                <div className="max-h-[65dvh] min-h-64 overflow-auto">
                  <table
                    aria-label="Допродажи по рабочим дням"
                    className="w-full table-fixed text-sm"
                    style={{ minWidth: Math.max(680, table.getTotalSize()) }}
                  >
                    <ResizableTableHead
                      table={table}
                      isControlColumn={() => false}
                      isRightAligned={(id) => id !== "date"}
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
                                "px-3 py-3",
                                cell.column.id !== "date" && "text-right",
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
            </>
          ) : (
            <EmptyState
              icon={ChartNoAxesCombined}
              title="За этот месяц нет данных"
              description={
                source === "archive"
                  ? "Выберите другой месяц или источник."
                  : data.configured
                    ? "Запросите отчёты завершённых рабочих дней."
                    : "Источники допродаж пока не подключены."
              }
            />
          )}
          {allRows.length > 0 && (
            <SalesTrend
              key={`${source}-${kind}`}
              series={series}
              title="Среднее количество по дням с данными"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Прочерк — нет значения в источнике.{" "}
            {source === "archive"
              ? "Архивные итоги Glide без пересчёта."
              : `Рабочий день начинается в ${data.hour}:00. Общая прибавка делится между сотрудниками смены.`}
          </p>
        </TabsContent>
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
        <AdditionalRulesEditor
          data={data}
          onClose={() => setRulesOpen(false)}
          onSaved={setData}
        />
      )}
    </PageFrame>
  );
}
