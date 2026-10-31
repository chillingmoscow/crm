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
import { ClipboardList, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PageFrame } from "@/components/shared/page-frame";
import { MonthPicker } from "@/components/shared/month-picker";
import {
  TablePageHeader,
  TableControls,
  TableColumnManager,
  ResizableTableHead,
  useTableState,
  useMultiSort,
} from "@/components/shared/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { dayLabel } from "@/lib/sales/format";
import { csvCell } from "@/lib/sales/csv";
import { cn } from "@/lib/utils";
import { personalConsumptionPlan } from "@/lib/stock/writeoffs";
import {
  writeoffRows,
  writeoffTotal,
  type WriteoffRow,
} from "@/lib/stock/writeoff-view";
import {
  loadWriteoffs,
  requestWriteoffs,
  loadWriteoffHistory,
  type WriteoffData,
  type WriteoffHistory,
} from "./actions";
const names: Record<string, string> = {
  date: "Дата",
  name: "Акт / наименование",
  correspondent: "Кому относится",
  kind: "Тип",
  reason: "Основание / категория",
  store: "Склад",
  status: "Состояние",
  quantity: "Недостача",
  total: "Сумма",
};
const columnsConfig = Object.keys(names).map((id) => ({
  id,
  defaultSize:
    (
      {
        date: 150,
        name: 170,
        correspondent: 170,
        reason: 200,
        status: 130,
        total: 150,
      } as Record<string, number>
    )[id] ?? 160,
  defaultVisible: [
    "date",
    "name",
    "correspondent",
    "reason",
    "total",
    "status",
  ].includes(id),
}));
const amount = (v: number | null) =>
  v === null
    ? "—"
    : `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const stamp = (s: string, tz: string) =>
  new Date(s).toLocaleString("ru-RU", {
    timeZone: tz,
    dateStyle: "short",
    timeStyle: "short",
  });
function Status({ row }: { row: WriteoffRow }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap border-transparent font-normal",
        row.status === "Проведён"
          ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          : row.status.startsWith("Удал") || row.status === "Нет в источнике"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
    >
      {row.status}
    </Badge>
  );
}
function Detail({
  row,
  data,
  onClose,
}: {
  row: WriteoffRow;
  data: WriteoffData;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<WriteoffHistory[] | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (row.native)
      void loadWriteoffHistory(data.venueId, row.id)
        .then((h) => active && setHistory(h))
        .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [row.id, row.native, data.venueId]);
  const d = row.native?.payload,
    plan = d ? personalConsumptionPlan(d, data.rules?.personalFinance) : null;
  const sourceUrl =
    row.archive?.document_url ??
    (d && data.providerOrigin
      ? `${data.providerOrigin}/#/warehouse.documents.discard?id=${d.id}&className=ru.edgex.quickresto.modules.warehouse.documents.discard.DiscardInvoice&tab=general`
      : null);
  const events: Record<string, string> = {
    imported: "Получен из Quick Resto",
    updated: "Обновлён из Quick Resto",
    source_removed: "Больше не найден в источнике",
    source_restored: "Снова найден в источнике",
  };
  return (
    <EditDrawer
      open
      title={row.name}
      description={`${dayLabel(row.date)} · ${row.archive ? "Архив Glide" : row.store}`}
      onOpenChange={(v) => !v && onClose()}
    >
      <div className="rounded-xl bg-brand/5 p-5">
        <p className="text-sm text-muted-foreground">
          Сумма {d ? "акта" : "записи"}
        </p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {amount(row.total)}
        </p>
        <div className="mt-3">
          <Status row={row} />
        </div>
      </div>
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Детали</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-5">
          {!!row.issues.length && (
            <div className="space-y-1 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-300">
              {row.issues.map((i) => (
                <p key={i}>{i}</p>
              ))}
            </div>
          )}
          <dl className="divide-y">
            {[
              ["Кому относится", row.correspondent],
              ["Тип", row.kind],
              ["Основание / категория", row.reason],
              ...(row.quantity ? [["Недостача", row.quantity]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-3 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {d?.kind === "personal" && (
            <section className="space-y-3 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">Личное потребление</h3>
              <p className="text-xl font-semibold tabular-nums">
                {amount(plan?.amount ?? null)}
              </p>
              {plan?.eligible ? (
                <>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Приход</dt>
                      <dd>{amount(plan.amount)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Расход</dt>
                      <dd>{amount(plan.amount)}</dd>
                    </div>
                  </dl>
                  <p className="text-xs leading-5 text-muted-foreground">
                    По прежнему правилу Adesk: сумма каждой позиции округляется
                    отдельно. Изменение остатка счёта — 0 ₽.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {plan?.issues.join(". ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Это расчёт для сверки. Денежные операции из этой карточки пока
                не создаются.
              </p>
            </section>
          )}
          {d && (
            <section>
              <h3 className="text-sm font-semibold">
                Позиции · {d.lines.length}
              </h3>
              <ul className="mt-2 divide-y">
                {d.lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex justify-between gap-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="break-words font-medium">{l.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {l.quantity === null
                          ? "Количество не указано"
                          : `${l.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${l.unit ?? ""}`}
                      </p>
                      {!!l.categories.length && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {l.categories[0]}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {amount(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {row.archive?.deleted && row.archive.delete_reason && (
            <p className="text-sm">
              Причина удаления: {row.archive.delete_reason}
            </p>
          )}
          {sourceUrl && (
            <Button variant="outline" asChild>
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 size-4" />
                Акт в Quick Resto
              </a>
            </Button>
          )}
        </TabsContent>
        <TabsContent value="history" className="space-y-4 text-sm">
          {row.archive ? (
            <>
              <p>
                Перенесено из Glide ·{" "}
                {stamp(row.archive.captured_at, data.timezone)}
              </p>
              <a
                className="text-brand hover:underline"
                target="_blank"
                rel="noreferrer"
                href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(row.archive.origin.spreadsheet_id)}/edit#range=${encodeURIComponent(row.archive.origin.range)}`}
              >
                Исходная строка ↗
              </a>
              {row.archive.period_total_raw != null && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Дополнительное поле источника
                  </summary>
                  <p className="mt-2">
                    «Сумма списаний»: {amount(row.archive.period_total_raw)}.
                    Значение повторяется в строках источника; к сумме этой
                    записи не прибавляется.
                  </p>
                </details>
              )}
            </>
          ) : error ? (
            <p role="alert" className="text-destructive">
              Не удалось загрузить историю. Закройте карточку и откройте
              повторно.
            </p>
          ) : history === null ? (
            <p role="status" className="text-muted-foreground">
              Загружаем историю…
            </p>
          ) : (
            <ol className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="space-y-2 py-3">
                  <p className="font-medium">
                    {events[h.action] ?? "Изменение"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {h.actor_name} · {stamp(h.created_at, data.timezone)}
                  </p>
                  <p className="tabular-nums">
                    {h.before_payload
                      ? `${amount(h.before_payload.total)} → `
                      : ""}
                    {amount(h.after_payload?.total ?? null)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
      {row.native && (
        <p className="text-xs text-muted-foreground">
          Снимок Quick Resto · {stamp(row.native.captured_at, data.timezone)}
        </p>
      )}
    </EditDrawer>
  );
}
export function WriteoffsClient({ initial }: { initial: WriteoffData }) {
  const [data, setData] = useState(initial),
    [source, setSource] = useState<"native" | "archive">(
      initial.connected ? "native" : "archive",
    ),
    [month, setMonth] = useState(
      (initial.connected
        ? initial.currentMonth
        : (
            initial.archives
              .map((r) => r.business_date)
              .sort()
              .at(-1) ?? initial.currentMonth
          ).slice(0, 7)) + "-01",
    ),
    [kind, setKind] = useState("all"),
    [detail, setDetail] = useState<WriteoffRow | null>(null),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false);
  const allRows = useMemo(
    () => writeoffRows(data.documents, data.archives, source),
    [data, source],
  );
  const st = useTableState({
    tableId: `stock-writeoffs.${data.venueId}`,
    columns: columnsConfig,
  });
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          r.date.startsWith(month.slice(0, 7)) &&
          (kind === "all" || r.kind === kind) &&
          `${r.name} ${r.correspondent} ${r.reason} ${dayLabel(r.date)}`
            .toLocaleLowerCase("ru-RU")
            .includes(st.search.toLocaleLowerCase("ru-RU").trim()),
      ),
    [allRows, month, kind, st.search],
  );
  const cols = useMemo<ColumnDef<WriteoffRow>[]>(
    () =>
      columnsConfig.map(({ id, defaultSize }) => ({
        id,
        header: names[id],
        size: defaultSize,
        accessorFn: (r) => r[id as keyof WriteoffRow] ?? undefined,
        sortUndefined: "last",
        cell: ({ row }) =>
          id === "name" ? (
            <button
              type="button"
              className="block w-full truncate text-left font-medium hover:text-brand"
              onClick={() => setDetail(row.original)}
              title={row.original.name}
            >
              {row.original.name}
              {row.original.issues.length > 0 && (
                <span className="mt-1 block text-xs font-normal text-amber-800 dark:text-amber-300">
                  Нужна сверка
                </span>
              )}
            </button>
          ) : id === "status" ? (
            <Status row={row.original} />
          ) : id === "date" ? (
            dayLabel(row.original.date)
          ) : id === "total" ? (
            <span className="tabular-nums">{amount(row.original.total)}</span>
          ) : (
            <span
              className="block truncate"
              title={String(row.original[id as keyof WriteoffRow] ?? "")}
            >
              {String(row.original[id as keyof WriteoffRow] ?? "—")}
            </span>
          ),
      })),
    [],
  );
  const table = useReactTable({
    data: rows,
    columns: cols,
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
    columnToField: Object.fromEntries(columnsConfig.map((c) => [c.id, c.id])),
    codec: {
      toField: (s) => s.split(":")[0],
      toDirection: (s) => (s.endsWith(":desc") ? "desc" : "asc"),
      combine: (f, d) => `${f}:${d}` as Sort,
    },
  });
  const pending =
    source === "native" &&
    data.jobs.some(
      (j) => j.month.startsWith(month.slice(0, 7)) && j.state !== "ready",
    );
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void loadWriteoffs(initial.venueId)
          .then((d) => active && setData(d))
          .catch(() => {});
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pending, initial.venueId]);
  const job = data.jobs.find((j) => j.month.startsWith(month.slice(0, 7)));
  async function refresh() {
    setBusy(true);
    try {
      setData(await requestWriteoffs(data.venueId, month.slice(0, 7)));
      setSource("native");
      toast.success("Обновление запрошено. Результат появится автоматически.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось обновить списания",
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setExporting(true);
    try {
      const fresh = await loadWriteoffs(data.venueId),
        byId = new Map(
          writeoffRows(fresh.documents, fresh.archives, source).map((r) => [
            r.id,
            r,
          ]),
        );
      const freshRows = [...byId.values()].filter(
        (r) =>
          r.date.startsWith(month.slice(0, 7)) &&
          (kind === "all" || r.kind === kind) &&
          `${r.name} ${r.correspondent} ${r.reason} ${dayLabel(r.date)}`
            .toLocaleLowerCase("ru-RU")
            .includes(st.search.toLocaleLowerCase("ru-RU").trim()),
      );
      const unchanged =
        freshRows.length === rows.length &&
        freshRows.every((r) => {
          const old = rows.find((o) => o.id === r.id);
          return (
            old &&
            (r.native
              ? r.native.source_hash === old.native?.source_hash &&
                r.native.missing_at === old.native?.missing_at
              : r.archive?.id === old.archive?.id)
          );
        });
      if (!unchanged) {
        setData(fresh);
        throw new Error(
          "Данные обновились. Проверьте таблицу и повторите экспорт",
        );
      }
      const columns = table.getVisibleLeafColumns();
      const lines: unknown[][] = [columns.map((c) => names[c.id])];
      for (const old of table.getRowModel().rows) {
        const r = byId.get(old.id);
        if (!r) throw new Error("Данные изменились. Обновите таблицу");
        lines.push(columns.map((c) => r[c.id as keyof WriteoffRow]));
      }
      const url = URL.createObjectURL(
        new Blob(
          ["\uFEFF" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Списания-${source}-${month.slice(0, 7)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выгрузить списания",
      );
    } finally {
      setExporting(false);
    }
  }
  const sum = writeoffTotal(rows),
    types = [...new Set(allRows.map((r) => r.kind))].sort();
  return (
    <PageFrame className="space-y-6">
      <TablePageHeader title="Списания" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="w-44">
            <MonthPicker
              value={month}
              min="2000-01-01"
              onChange={(v) => {
                setMonth(v);
                setDetail(null);
              }}
              variant="field"
              prefix=""
              ariaLabel="Месяц списаний"
            />
          </div>
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v as typeof source);
              setDetail(null);
              setKind("all");
              if (
                v === "archive" &&
                !data.archives.some((r) =>
                  r.business_date.startsWith(month.slice(0, 7)),
                )
              )
                setMonth(
                  (
                    data.archives
                      .map((r) => r.business_date)
                      .sort()
                      .at(-1) ?? month
                  ).slice(0, 7) + "-01",
                );
            }}
          >
            <SelectTrigger className="w-40" aria-label="Источник списаний">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="native">Quick Resto</SelectItem>
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
            placeholder: "Акт, товар или сотрудник",
          }}
          filters={{
            active: filtersOpen || kind !== "all",
            onClick: () => setFiltersOpen(!filtersOpen),
          }}
          sort={{
            active: st.sorting.length > 0,
            content: (
              <div className="space-y-1 p-2">
                {columnsConfig.map((c) => (
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
                  canHide: c.id !== "name",
                  width: c.getSize(),
                }))}
                onVisibilityChange={(id, v) =>
                  table.getColumn(id)?.toggleVisibility(v)
                }
                onMoveColumn={(a, b) =>
                  st.setColumnOrder((o) =>
                    arrayMove(o, o.indexOf(a), o.indexOf(b)),
                  )
                }
                onReset={st.resetColumns}
              />
            ),
          }}
          exportAction={{
            label: "Экспорт CSV",
            onClick: () => void download(),
            disabled: !rows.length,
            loading: exporting,
          }}
          secondaryActions={
            source === "native" &&
            data.connected &&
            data.permissions.includes("inventory.sync_quickresto") ? (
              <Button
                variant="outline"
                size="icon"
                aria-label="Обновить списания Quick Resto"
                disabled={
                  busy ||
                  (source === "native" &&
                    !!job &&
                    ["pending", "running"].includes(job.state))
                }
                onClick={() => void refresh()}
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              </Button>
            ) : undefined
          }
        />
      </div>
      {(filtersOpen || kind !== "all") && (
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Тип списания">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {source === "native" && job && job.state !== "ready" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {job.state === "error"
            ? job.last_error
            : `Получаем акты: ${job.cursor}${job.total === null ? "" : ` из ${job.total}`}`}
        </p>
      )}
      {rows.length ? (
        <>
          <section
            className="grid grid-cols-2 gap-y-4 rounded-lg border py-5 sm:grid-cols-3"
            aria-label="Итоги списаний"
          >
            <div className="px-4 sm:border-r sm:px-5">
              <p className="text-sm text-muted-foreground">
                {source === "native" ? "Актов" : "Записей"}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {rows.length}
              </p>
            </div>
            <div className="col-span-2 order-first px-4 sm:order-none sm:col-span-1 sm:border-r sm:px-5">
              <p className="text-sm text-muted-foreground">
                {source === "native"
                  ? "Проведённые акты"
                  : "Сумма архивных записей"}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {amount(sum.value)}
              </p>
              {source === "native" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Без черновиков и отсутствующих актов
                </p>
              )}
              {sum.known < sum.total && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Сумма есть у {sum.known} из {sum.total} записей
                </p>
              )}
            </div>
            <div className="px-4 sm:px-5">
              <p className="text-sm text-muted-foreground">
                {source === "native" ? "Проведено" : "Нужна сверка"}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {
                  rows.filter((r) =>
                    source === "native"
                      ? r.status === "Проведён"
                      : r.issues.length > 0,
                  ).length
                }
              </p>
            </div>
          </section>
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-[65dvh] min-h-64 overflow-auto">
              <table
                className="w-full table-fixed text-sm"
                aria-label="Журнал списаний"
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
                  isControlColumn={() => false}
                  isRightAligned={(id) => id === "total" || id === "quantity"}
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
                            (cell.column.id === "total" ||
                              cell.column.id === "quantity") &&
                              "text-right",
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
          icon={ClipboardList}
          title={
            pending
              ? "Получаем списания из Quick Resto"
              : "За этот месяц нет записей"
          }
          description={
            pending
              ? "Можно продолжить работу: журнал обновится автоматически."
              : source === "archive"
                ? "Выберите другой месяц."
                : "Запросите акты из Quick Resto или выберите архив Glide."
          }
        />
      )}
      {source === "native" && (
        <p className="text-xs text-muted-foreground">
          Показаны складские акты. Финансовые операции и удержания из зарплаты
          пока не создаются.
        </p>
      )}
      {detail && (
        <Detail
          key={detail.id}
          row={detail}
          data={data}
          onClose={() => setDetail(null)}
        />
      )}
    </PageFrame>
  );
}
