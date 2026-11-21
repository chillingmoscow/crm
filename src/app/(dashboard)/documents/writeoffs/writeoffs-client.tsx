"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  ClipboardList,
  Loader2,
  RefreshCw,
  SearchX,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { PageFrame } from "@/components/shared/page-frame";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { MonthPicker } from "@/components/shared/month-picker";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money } from "@/components/shared/money";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import {
  DataTable,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
  TablePageHeader,
  TablePagination,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { csvCell } from "@/lib/sales/csv";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import {
  writeoffRows,
  writeoffTotal,
  type WriteoffPoolFilter,
  type WriteoffPoolView,
  type WriteoffRow,
} from "@/lib/stock/writeoff-view";
import {
  writeoffPoolKey,
  writeoffPoolLabel,
  writeoffPoolState,
  type WriteoffPoolAssignment,
} from "@/lib/stock/writeoff-pools";
import { WriteoffDrawer } from "./writeoff-drawer";
import {
  applyWriteoffConditions,
  writeoffStatusTone,
} from "./writeoff-format";
import {
  loadWriteoffs,
  requestWriteoffs,
  assignWriteoffPool,
  type WriteoffData,
} from "./actions";

type Source = "native" | "archive";

const definitions = [
  { id: "date", label: "Дата", size: 120, min: 100, visible: true },
  { id: "name", label: "Акт / наименование", size: 200, min: 160, visible: true },
  { id: "correspondent", label: "Кому относится", size: 170, min: 140, visible: true },
  { id: "kind", label: "Тип", size: 160, min: 80, visible: false },
  { id: "reason", label: "Основание / категория", size: 200, min: 180, visible: true },
  { id: "pool", label: "Кто платит", size: 180, min: 110, visible: true },
  { id: "store", label: "Склад", size: 160, min: 90, visible: false },
  { id: "status", label: "Статус", size: 130, min: 100, visible: true },
  { id: "quantity", label: "Недостача", size: 130, min: 110, visible: false },
  { id: "total", label: "Сумма", size: 140, min: 100, visible: true },
] as const;
const columnsConfig = definitions.map((c) => ({
  id: c.id,
  defaultSize: c.size,
  defaultVisible: c.visible,
}));
const labels: Record<string, string> = Object.fromEntries(
  definitions.map((c) => [c.id, c.label]),
);
const sortable = new Set<string>(definitions.map((c) => c.id));
const MIN_MONTH = "2000-01-01";
const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Колонка «Кто платит»: подпись, состояние и пометка акта по данным страницы. */
function poolView(data: WriteoffData) {
  const marks = new Map(
    data.assignments.map(
      (m) => [writeoffPoolKey(m.venue_id, m.external_id), m] as const,
    ),
  );
  const names = {
    departments: new Map(data.targets.departments.map((d) => [d.id, d.name])),
    employees: new Map(data.targets.employees.map((e) => [e.id, e.name])),
  };
  // Расчёт месяца принимает пометку только на действующее подразделение
  // заведения: журнал считает так же, иначе акт «разнесён» здесь, а месяц
  // стоит с «актом без плательщика».
  const activeDepartments = new Set(
    data.targets.departments.filter((d) => !d.archived).map((d) => d.id),
  );
  return (d: WriteoffData["documents"][number]): WriteoffPoolView => {
    const assignment = marks.get(writeoffPoolKey(d.venue_id, d.external_id));
    const state = writeoffPoolState(d, assignment, { activeDepartments });
    return {
      assignment,
      // Всё из одного состояния: подпись, фильтр и плашка не могут разойтись.
      // «Нужна сверка суммы» блокирует месяц так же, как неразнесённый акт.
      poolState:
        state === "unassigned" || state === "needs_check"
          ? "unassigned"
          : state === "assigned"
            ? "assigned"
            : "none",
      pool:
        state === "assigned" && assignment
          ? writeoffPoolLabel(assignment, names)
          : state === "needs_check"
            ? "Сумма не определена"
            : state === "unassigned"
              ? assignment?.pool === "department"
                ? "Подразделение в архиве"
                : "Не разнесён"
              : state === "not_needed"
                ? "Не требуется"
                : "—",
    };
  };
}

const latestArchiveMonth = (data: WriteoffData, fallback: string) =>
  (
    data.archives
      .map((r) => r.business_date)
      .sort()
      .at(-1) ?? fallback
  ).slice(0, 7) + "-01";

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

/** Значение для CSV: даты как в таблице, дроби через запятую (русский Excel). */
function csvValue(id: string, r: WriteoffRow): unknown {
  if (id === "date") return formatDateCell(r.date) ?? r.date;
  const v = r[id as keyof WriteoffRow];
  if (typeof v === "number") return String(v).replace(".", ",");
  if (id === "quantity" && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))
    return v.trim().replace(".", ",");
  return v;
}

/** Текст ошибки фоновой загрузки: показываем, только если это фраза для человека. */
const humanJobError = (text: string | null) =>
  text && /[а-яё]/i.test(text) && !/[{}<>]|error|exception/i.test(text)
    ? text
    : "Не удалось получить списания из Quick Resto. Сохранённые данные не изменены.";

export function WriteoffsClient({ initial }: { initial: WriteoffData }) {
  const router = useRouter();
  const params = useSearchParams();
  const maxMonth = `${initial.currentMonth}-01`;
  // Начальное состояние из адреса: ?month=YYYY-MM и ?act=<номер акта в Quick Resto>.
  const [start] = useState(() => {
    const act = Number(params.get("act"));
    const doc =
      Number.isSafeInteger(act) && act > 0
        ? initial.documents.find((d) => d.external_id === act)
        : undefined;
    const monthParam = params.get("month");
    const fromUrl =
      monthParam && MONTH_PARAM.test(monthParam) && `${monthParam}-01` <= maxMonth
        ? `${monthParam}-01`
        : null;
    const source: Source =
      doc || initial.connected ? "native" : "archive";
    const month = doc
      ? `${doc.business_date.slice(0, 7)}-01`
      : (fromUrl ??
        (source === "native"
          ? maxMonth
          : latestArchiveMonth(initial, initial.currentMonth)));
    const detail = doc
      ? (writeoffRows([doc], [], "native", poolView(initial))[0] ?? null)
      : null;
    return { source, month, detail };
  });
  const [data, setData] = useState(initial),
    [source, setSource] = useState<Source>(start.source),
    [month, setMonth] = useState(start.month),
    [kind, setKind] = useState(""),
    [pool, setPool] = useState<WriteoffPoolFilter | "">(""),
    [detail, setDetail] = useState<WriteoffRow | null>(start.detail),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false);
  const canAssign = data.permissions.includes("inventory.assign_writeoff_pool");
  const canSync =
    data.connected && data.permissions.includes("inventory.sync_quickresto");
  const canSettings = data.permissions.includes("org.manage_venues");
  const poolOf = useMemo(() => poolView(data), [data]);
  const nativeRows = useMemo(
    () => writeoffRows(data.documents, data.archives, "native", poolOf),
    [data, poolOf],
  );
  const archiveRows = useMemo(
    () => writeoffRows(data.documents, data.archives, "archive"),
    [data],
  );
  const allRows = source === "native" ? nativeRows : archiveRows;
  const st = useTableState({
    tableId: `stock-writeoffs.${data.venueId}`,
    columns: columnsConfig,
    defaultPageSize: 25,
  });
  const hasFilters = !!kind || !!pool;
  const searching = !!st.search.trim();
  const inMonth = (list: WriteoffRow[]) =>
    applyWriteoffConditions(list, month, "", "", "");
  const monthRows = useMemo(
    () => applyWriteoffConditions(allRows, month, "", "", ""),
    [allRows, month],
  );
  const rows = useMemo(
    () => applyWriteoffConditions(allRows, month, kind, pool, st.search),
    [allRows, month, kind, pool, st.search],
  );
  const unassigned = useMemo(
    () =>
      source === "native"
        ? applyWriteoffConditions(allRows, month, "", "unassigned", "").length
        : 0,
    [allRows, month, source],
  );
  const columns = useMemo<ColumnDef<WriteoffRow>[]>(
    () =>
      definitions.map(({ id, size, min, label }) => ({
        id,
        header: label,
        size,
        minSize: min,
        enableHiding: id !== "name",
        accessorFn: (r) => r[id as keyof WriteoffRow] ?? undefined,
        sortUndefined: "last",
        cell: ({ row }) => {
          const r = row.original;
          switch (id) {
            case "name":
              // Настоящая кнопка в первой ячейке: акт открывается и с клавиатуры.
              return (
                <button
                  type="button"
                  className="block max-w-full text-left"
                  onClick={() => setDetail(r)}
                >
                  <span
                    className="block truncate font-medium hover:underline"
                    data-tip={r.name}
                    data-tip-overflow
                  >
                    {r.name}
                  </span>
                  {r.issues.length > 0 && (
                    <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
                      Нужна сверка
                    </span>
                  )}
                </button>
              );
            case "status":
              return (
                <StatusBadge tone={writeoffStatusTone(r.status)}>
                  {r.status}
                </StatusBadge>
              );
            case "pool":
              return r.poolState === "unassigned" ? (
                <StatusBadge tone="warning">{r.pool}</StatusBadge>
              ) : (
                <span
                  className={cn(
                    "block truncate",
                    r.pool === "—" && "text-muted-foreground",
                  )}
                  data-tip={r.pool}
                  data-tip-overflow
                >
                  {r.pool}
                </span>
              );
            case "date":
              return formatDateCell(r.date) ?? "—";
            case "total":
              return <Money value={r.total} />;
            default: {
              const value = r[id as keyof WriteoffRow];
              const text = value == null || value === "" ? "—" : String(value);
              return (
                <span
                  className={cn(
                    "block truncate",
                    text === "—" && "text-muted-foreground",
                  )}
                  data-tip={text}
                  data-tip-overflow
                >
                  {text}
                </span>
              );
            }
          }
        },
      })),
    [],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    state: {
      sorting: st.sorting,
      columnOrder: st.columnOrder,
      columnVisibility: { ...st.columnVisibility, name: true },
      columnSizing: st.columnSizing,
      pagination: st.pagination,
    },
    onSortingChange: st.setSorting,
    onColumnOrderChange: st.setColumnOrder,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    onPaginationChange: st.setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    columnResizeMode: "onChange",
  });
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  const pageCount = Math.max(1, Math.ceil(rows.length / st.pagination.pageSize));
  const { pagination, setPagination } = st;
  useEffect(() => {
    if (pagination.pageIndex >= pageCount)
      setPagination((p) => ({ ...p, pageIndex: pageCount - 1 }));
  }, [pageCount, pagination.pageIndex, setPagination]);
  const changeSorting = (next: SortingState) => {
    st.setSorting(next);
    firstPage();
  };
  const resetConditions = () => {
    setKind("");
    setPool("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  const job =
    source === "native"
      ? data.jobs.find((j) => j.month.startsWith(month.slice(0, 7)))
      : undefined;
  // Ошибка — не ожидание: без спиннера.
  const pending = !!job && (job.state === "pending" || job.state === "running");
  // Опрос: при загрузке — раз в 10 с; после ошибки сервер повторяет сам,
  // поэтому опрашиваем реже — раз в 60 с, чтобы увидеть результат повтора.
  const pollMs = pending ? 10000 : job?.state === "error" ? 60000 : null;
  useEffect(() => {
    if (!pollMs) return;
    let active = true;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void loadWriteoffs(initial.venueId)
          .then((d) => active && setData(d))
          .catch(() => {});
    }, pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pollMs, initial.venueId]);

  function changeMonth(next: string) {
    setMonth(next);
    setDetail(null);
    firstPage();
  }
  function changeSource(next: Source) {
    setSource(next);
    setDetail(null);
    setKind("");
    setPool("");
    firstPage();
    if (
      next === "archive" &&
      !data.archives.some((r) => r.business_date.startsWith(month.slice(0, 7)))
    )
      setMonth(latestArchiveMonth(data, month.slice(0, 7)));
  }
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
  async function assign(
    row: WriteoffRow,
    to: WriteoffPoolAssignment["pool"] | null,
    key: string | null,
  ) {
    if (!row.native) return;
    const { mark, notice } = await assignWriteoffPool(
      data.venueId,
      row.native.external_id,
      to,
      key,
    );
    setData((d) => ({
      ...d,
      assignments: [
        ...d.assignments.filter(
          (m) =>
            writeoffPoolKey(m.venue_id, m.external_id) !==
            writeoffPoolKey(row.native!.venue_id, row.native!.external_id),
        ),
        ...(mark ? [mark] : []),
      ],
    }));
    // Результат пересчёта удержания за месяц акта (если автопересчёт включён): не теряем его.
    if (notice) toast.message(notice);
  }
  async function download() {
    setExporting(true);
    try {
      const fresh = await loadWriteoffs(data.venueId),
        byId = new Map(
          writeoffRows(
            fresh.documents,
            fresh.archives,
            source,
            poolView(fresh),
          ).map((r) => [r.id, r]),
        );
      const freshRows = applyWriteoffConditions(
        [...byId.values()],
        month,
        kind,
        pool,
        st.search,
      );
      const unchanged =
        freshRows.length === rows.length &&
        freshRows.every((r) => {
          const old = rows.find((o) => o.id === r.id);
          return (
            old &&
            r.pool === old.pool &&
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
      const visible = table.getVisibleLeafColumns();
      const lines: unknown[][] = [visible.map((c) => labels[c.id])];
      // Все строки с условиями и сортировкой, а не только текущая страница.
      for (const old of table.getPrePaginationRowModel().rows) {
        const r = byId.get(old.id);
        if (!r) throw new Error("Данные изменились. Обновите таблицу");
        lines.push(visible.map((c) => csvValue(c.id, r)));
      }
      const url = URL.createObjectURL(
        new Blob(
          ["﻿" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n")],
          { type: "text/csv;charset=utf-8;" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `Списания-${source === "native" ? "QuickResto" : "Архив"}-${month.slice(0, 7)}.csv`;
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
  const showTabs = data.archives.length > 0 || !data.connected;
  const native = source === "native";

  const header = (
    <TablePageHeader
      title="Списания"
      count={
        hasFilters || searching
          ? `${rows.length} из ${monthRows.length}`
          : monthRows.length
      }
      period={
        <PeriodStepper
          previous="Предыдущий месяц"
          next="Следующий месяц"
          previousDisabled={month <= MIN_MONTH}
          nextDisabled={month >= maxMonth}
          onPrevious={() => changeMonth(shiftMonth(month, -1))}
          onNext={() => changeMonth(shiftMonth(month, 1))}
        >
          <MonthPicker
            variant="period"
            prefix=""
            ariaLabel="Месяц списаний"
            value={month}
            min={MIN_MONTH}
            max={maxMonth}
            onChange={changeMonth}
          />
        </PeriodStepper>
      }
      actions={
        <TableControls
          search={{
            value: st.search,
            onChange: (v) => {
              st.setSearch(v);
              firstPage();
            },
            open: st.searchOpen,
            onOpenChange: st.setSearchOpen,
            placeholder: "Акт, товар или сотрудник",
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
                fields={[...sortable]}
                labels={labels}
              />
            ),
          }}
          columns={{
            content: (
              <TableColumnManager
                columns={st.columnOrder.flatMap((id) => {
                  const c = table.getColumn(id);
                  return c
                    ? [
                        {
                          id,
                          label: labels[id],
                          visible: c.getIsVisible(),
                          canHide: c.getCanHide(),
                        },
                      ]
                    : [];
                })}
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
            <>
              {native && canSync && (
                <TableIconButton
                  label="Обновить из Quick Resto"
                  disabled={busy || pending}
                  onClick={() => void refresh()}
                >
                  <RefreshCw className={cn(busy && "animate-spin")} />
                </TableIconButton>
              )}
              {canSettings && (
                <TableIconButton
                  label="Настройки списаний"
                  onClick={() =>
                    router.push(`/org/venues/${data.venueId}?tab=inventory`)
                  }
                >
                  <Settings />
                </TableIconButton>
              )}
            </>
          }
        />
      }
    />
  );

  const conditions = (
    <TableConditions
      label="Условия списка списаний"
      open={filtersOpen}
      hasFilters={hasFilters}
      sorting={st.sorting}
      onSortingChange={changeSorting}
      sortFields={[...sortable]}
      sortLabels={labels}
      search={st.search}
      onSearchClear={() => {
        st.setSearch("");
        firstPage();
      }}
      onReset={resetConditions}
    >
      {(filtersOpen || kind) && (
        <TableFilterChip
          label="Тип"
          value={kind}
          onChange={(v) => {
            setKind(v);
            firstPage();
          }}
          options={[
            { value: "", label: "Все типы" },
            ...types.map((t) => ({ value: t, label: t })),
          ]}
        />
      )}
      {native && (filtersOpen || pool) && (
        <TableFilterChip
          label="Разнесение"
          value={pool}
          onChange={(v) => {
            setPool(v as WriteoffPoolFilter | "");
            firstPage();
          }}
          options={[
            { value: "", label: "Любое разнесение" },
            { value: "unassigned", label: "Не разнесены" },
            { value: "shared", label: "Вся команда" },
            { value: "department", label: "Подразделение" },
            { value: "personal", label: "Один сотрудник" },
            { value: "excluded", label: "Не удерживать" },
          ]}
        />
      )}
    </TableConditions>
  );

  const refreshButton = (label: string) => (
    <Button className="min-w-32" disabled={busy}
      onClick={() => void refresh()}
    >
      {busy ? "Запрашиваем…" : label}
    </Button>
  );

  const notices = native && (
    <>
      {unassigned > 0 && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            Не разнесено актов: {unassigned}. Пока они не разнесены, месяц не
            посчитан.
          </p>
          {pool !== "unassigned" && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setPool("unassigned");
                setKind("");
                firstPage();
              }}
            >
              Показать
            </Button>
          )}
        </div>
      )}
      {pending && job && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {job.total === null
            ? "Получаем список актов из Quick Resto…"
            : `Получаем акты: ${job.cursor} из ${job.total}`}
        </p>
      )}
      {job?.state === "error" && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p>{humanJobError(job.last_error)}</p>
          {canSync && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Повторить
            </Button>
          )}
        </div>
      )}
    </>
  );

  const metrics = native ? (
    <MetricStrip label="Итоги за месяц">
      <Metric
        primary
        label="Проведённые акты"
        value={<Money value={sum.total === 0 ? 0 : sum.value} />}
        hint={
          sum.total === 0
            ? "Проведённых актов нет"
            : sum.value === null
              ? "Quick Resto не передал суммы актов"
              : sum.known < sum.total
                ? `Сумма есть у ${sum.known} из ${countRu(sum.total, "акта", "актов", "актов")}`
                : "Без черновиков и отсутствующих актов"
        }
      />
      <Metric label="Актов" value={rows.length} />
      <Metric
        label="Проведено"
        value={rows.filter((r) => r.status === "Проведён").length}
      />
      <Metric
        label="Не разнесено"
        value={unassigned}
        hint={unassigned > 0 ? "Месяц не посчитан" : undefined}
      />
    </MetricStrip>
  ) : (
    <MetricStrip label="Итоги за месяц">
      <Metric
        primary
        label="Сумма архивных записей"
        value={<Money value={sum.total === 0 ? 0 : sum.value} />}
        hint={
          sum.total === 0
            ? "Записей с суммой нет"
            : sum.value === null
              ? "В архиве нет сумм этих записей"
              : sum.known < sum.total
                ? `Сумма есть у ${sum.known} из ${countRu(sum.total, "записи", "записей", "записей")}`
                : "Без удалённых записей"
        }
      />
      <Metric label="Записей" value={rows.length} />
      <Metric
        label="Нужна сверка"
        value={rows.filter((r) => r.issues.length > 0).length}
      />
    </MetricStrip>
  );

  const empty =
    monthRows.length > 0 ? (
      <EmptyState
        icon={SearchX}
        title="Ничего не найдено"
        description="Измените условия поиска или сбросьте фильтры"
        action={
          <Button variant="outline" onClick={resetConditions}>
            Сбросить поиск и фильтры
          </Button>
        }
      />
    ) : pending ? (
      <EmptyState
        icon={RefreshCw}
        title="Получаем списания из Quick Resto"
        description="Можно продолжить работу: журнал обновится автоматически"
      />
    ) : !native ? (
      <EmptyState
        icon={ClipboardList}
        title="За этот месяц записей нет"
        description="Выберите другой месяц"
      />
    ) : !data.connected ? (
      <EmptyState
        icon={ClipboardList}
        title="За этот месяц актов нет"
        description="Quick Resto не подключён к заведению. Обратитесь к владельцу аккаунта"
      />
    ) : !canSync ? (
      <EmptyState
        icon={ClipboardList}
        title="За этот месяц актов нет"
        description="Обновить список может сотрудник с правом синхронизации"
      />
    ) : (
      <EmptyState
        icon={ClipboardList}
        title="За этот месяц актов нет"
        description="Запросите акты за месяц из Quick Resto"
        action={refreshButton("Обновить из Quick Resto")}
      />
    );

  const body = (
    <div className="space-y-4">
      {notices}
      {rows.length ? (
        <>
          {metrics}
          <DataTable
            table={table}
            label="Журнал списаний"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortable}
            numeric={["total", "quantity"]}
            onRowClick={(row) => setDetail(row.original)}
            empty={null}
            totals={{ total: <Money value={sum.total === 0 ? 0 : sum.value} /> }}
            mobile={{
              label: "Карточки списаний",
              nameColumn: "name",
              statusColumn: "status",
            }}
          />
          <TablePagination
            pageIndex={Math.min(st.pagination.pageIndex, pageCount - 1)}
            pageSize={st.pagination.pageSize}
            total={rows.length}
            onPageChange={(pageIndex) =>
              st.setPagination((p) => ({ ...p, pageIndex }))
            }
            onPageSizeChange={(pageSize) =>
              st.setPagination({ pageSize, pageIndex: 0 })
            }
          />
        </>
      ) : (
        empty
      )}
    </div>
  );

  return (
    <PageFrame className="space-y-4">
      <Breadcrumbs items={[{ label: "Документы" }, { label: "Списания" }]} />
      {header}
      {conditions}
      {showTabs ? (
        <Tabs
          value={source}
          onValueChange={(v) => changeSource(v as Source)}
          className={tabStyle.tabs}
        >
          <TabsList aria-label="Источник списаний">
            <TabsTrigger value="native">
              Quick Resto · {inMonth(nativeRows).length}
            </TabsTrigger>
            <TabsTrigger value="archive">
              Архив Glide · {inMonth(archiveRows).length}
            </TabsTrigger>
          </TabsList>
          <TabsContent value={source}>{body}</TabsContent>
        </Tabs>
      ) : (
        body
      )}
      {detail && (
        <WriteoffDrawer
          key={detail.id}
          row={allRows.find((r) => r.id === detail.id) ?? detail}
          data={data}
          canAssign={canAssign}
          onAssign={assign}
          onClose={() => setDetail(null)}
        />
      )}
    </PageFrame>
  );
}
