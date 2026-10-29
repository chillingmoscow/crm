"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  Settings,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  TablePageHeader,
  TableControls,
  TableControlPin,
  TableColumnManager,
  TablePagination,
  ResizableTableHead,
  useTableState,
} from "@/components/shared/table";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { candidateError } from "@/lib/candidates/errors";
import {
  CANDIDATE_STAGES,
  CANDIDATE_SORT_FIELDS,
  type CandidatePage,
  type CandidatePermissions,
  type CandidateSortField,
  type HiringOptions,
  type ListFilters,
} from "@/lib/candidates/types";
import { listCandidates } from "../actions";
import { plural } from "./fields";
import { RecruitingSettings } from "./recruiting-settings";
import {
  candidateColumns,
  COLUMN_CONFIG,
  FIELD_LABELS,
  type CandidateField,
} from "./candidate-table";
import {
  CandidateSortSettings,
  CandidateSortPicker,
} from "./candidate-sort-settings";

import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import type { CandidateStatusUpdate } from "./candidate-status-cell";
import { CandidateFilterChip } from "./candidate-filter-chip";
import { useCandidateColumnResize } from "./use-candidate-column-resize";

const sortableColumns = new Set<string>(CANDIDATE_SORT_FIELDS);
const noControlColumns = () => false;

export function CandidatesClient({
  initialList,
  preferenceKey,
  options,
  permissions,
}: {
  initialList: CandidatePage;
  preferenceKey: string;
  options: HiringOptions;
  permissions: CandidatePermissions;
}) {
  const st = useTableState({
    tableId: `candidates.list.${preferenceKey}`,
    columns: COLUMN_CONFIG,
    defaultPageSize: 25,
  });
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [position, setPosition] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preset, setPreset] = useState<string | null>(null),
    [filtersVisible, setFiltersVisible] = useState(false),
    [settings, setSettings] = useState(false),
    [list, setList] = useState(initialList),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const params = useSearchParams();
  const { setPagination } = st;
  const pageSize = [25, 50, 100].includes(st.pagination.pageSize)
    ? st.pagination.pageSize
    : 25;
  const filters: ListFilters = useMemo(
    () => ({
      search: query,
      status,
      position,
      from: from || undefined,
      to: to || undefined,
      sort: st.sorting.map((s) => ({
        field: s.id as CandidateSortField,
        direction: s.desc ? "desc" : "asc",
      })),
    }),
    [query, status, position, from, to, st.sorting],
  );
  const key = JSON.stringify([
    filters,
    st.pagination.pageIndex,
    pageSize,
    reload,
  ]);
  const loaded = useRef(key);
  const firstPage = () => setPagination((p) => ({ ...p, pageIndex: 0 }));
  useEffect(() => {
    if (params.get("settings") === "1" && permissions.integrations)
      setSettings(true);
  }, [params, permissions.integrations]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, setPagination]);
  useEffect(() => {
    if (loaded.current === key) {
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    listCandidates({ ...filters, page: st.pagination.pageIndex, pageSize })
      .then((next) => {
        if (cancelled) return;
        loaded.current = JSON.stringify([filters, next.page, pageSize, reload]);
        setList(next);
        setPagination((p) =>
          p.pageIndex === next.page ? p : { ...p, pageIndex: next.page },
        );
      })
      .catch((e) => {
        if (!cancelled)
          setError(candidateError(e, "Не удалось загрузить кандидатов."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The serialized key includes all filters, sorting and pagination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const changeSorting = (next: SortingState) => {
    st.setSorting(next);
    firstPage();
  };
  const cycleSort = (id: string) => {
    const current = st.sorting.find((s) => s.id === id);
    changeSorting(
      !current
        ? [...st.sorting, { id, desc: false }]
        : !current.desc
          ? st.sorting.map((s) => (s.id === id ? { ...s, desc: true } : s))
          : st.sorting.filter((s) => s.id !== id),
    );
  };
  const refreshList = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener("candidates:incoming", refreshList);
    return () => window.removeEventListener("candidates:incoming", refreshList);
  }, [refreshList]);
  const statusSaved = useCallback((saved: CandidateStatusUpdate) => {
    setList((current) => ({
      ...current,
      rows: current.rows.map((c) =>
        c.id === saved.id ? { ...c, ...saved } : c,
      ),
    }));
    setReload((n) => n + 1);
    window.dispatchEvent(new Event("candidates:changed"));
  }, []);
  const columns = useMemo(
    () => candidateColumns(statusSaved, refreshList),
    [statusSaved, refreshList],
  );
  const table = useReactTable({
    data: list.rows,
    columns,
    state: {
      sorting: st.sorting,
      pagination: { ...st.pagination, pageSize },
      columnVisibility: { ...st.columnVisibility, full_name: true },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: list.total,
    onColumnSizingChange: st.setColumnSizing,
    onColumnVisibilityChange: st.setColumnVisibility,
    columnResizeMode: "onChange",
    autoResetPageIndex: false,
  });
  const { tableRef, onResizeStart } = useCandidateColumnResize(
    table,
    st.setColumnSizing,
  );
  const statusColumn = table.getColumn("status");
  const minimumTableWidth = statusColumn?.getIsVisible()
    ? Math.max(
        640,
        Math.ceil((180 * table.getTotalSize()) / statusColumn.getSize()),
      )
    : 640;
  const hasFilters = !!(status || position || from || to);
  const reset = () => {
    setStatus("");
    setPosition("");
    setFrom("");
    setTo("");
    setPreset(null);
    setSearch("");
    setQuery("");
    st.setSorting([]);
    firstPage();
  };
  const sortSettings = (
    <CandidateSortSettings sorting={st.sorting} onChange={changeSorting} />
  );
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4 p-4 md:p-6">
      <PageBreadcrumb>
        <nav
          aria-label="Навигация по разделам"
          className="flex min-w-0 items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground">Люди</span>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="truncate">Кандидаты</span>
        </nav>
      </PageBreadcrumb>
      <TablePageHeader
        className="md:flex-wrap md:items-center [&>div:last-child]:max-w-full"
        title={
          <span className="inline-flex items-center gap-3">
            Кандидаты
            <span
              aria-hidden="true"
              className="rounded-md bg-muted px-2 py-1 text-sm font-normal tabular-nums text-muted-foreground"
            >
              {list.total}
            </span>
          </span>
        }
        actions={
          <>
            <TableControls
              className="min-w-0 max-w-full"
              search={{
                value: search,
                onChange: (v) => setSearch(v.slice(0, 100)),
                open: st.searchOpen,
                onOpenChange: st.setSearchOpen,
                placeholder: "Имя, телефон или должность",
              }}
              filters={{
                active: filtersVisible || hasFilters,
                onClick: () => setFiltersVisible((v) => !v),
              }}
              sort={{
                active: !!st.sorting.length,
                content: (
                  <CandidateSortPicker
                    sorting={st.sorting}
                    onChange={changeSorting}
                  />
                ),
              }}
              columns={{
                content: (
                  <TableColumnManager
                    columns={table.getAllLeafColumns().map((c) => ({
                      id: c.id,
                      label: FIELD_LABELS[c.id as CandidateField],
                      visible: c.getIsVisible(),
                      canHide: c.getCanHide(),
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
            />
            {permissions.integrations ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setSettings(true)}
              >
                <Settings className="mr-2 size-4" />
                Настройки
              </Button>
            ) : null}
          </>
        }
      />
      {filtersVisible || hasFilters || st.sorting.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Условия списка кандидатов"
        >
          {st.sorting.length > 0 ? (
            <TableControlPin
              label={
                st.sorting.length === 1
                  ? FIELD_LABELS[st.sorting[0].id as CandidateField]
                  : `${st.sorting.length} ${plural(st.sorting.length, ["сортировка", "сортировки", "сортировок"])}`
              }
              icon={
                st.sorting.length === 1 ? (
                  st.sorting[0].desc ? (
                    <ArrowDown />
                  ) : (
                    <ArrowUp />
                  )
                ) : (
                  <ArrowUpDown />
                )
              }
              active
              contentClassName="w-auto p-3"
            >
              {sortSettings}
            </TableControlPin>
          ) : null}
          {st.sorting.length > 0 && filtersVisible ? (
            <span className="mx-1 h-5 w-px bg-border" />
          ) : null}
          {filtersVisible ? (
            <>
              <DateRangeFilter
                ariaLabel="Дата заявки"
                value={{
                  start: from ? new Date(`${from}T12:00:00`) : null,
                  end: to ? new Date(`${to}T12:00:00`) : null,
                }}
                presetLabel={preset}
                onChange={(range, label) => {
                  setFrom(range.start ? format(range.start, "yyyy-MM-dd") : "");
                  setTo(range.end ? format(range.end, "yyyy-MM-dd") : "");
                  setPreset(label);
                  firstPage();
                }}
              />
              <CandidateFilterChip
                label="Статус"
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  firstPage();
                }}
                options={[
                  { value: "", label: "Все статусы" },
                  ...Object.entries(CANDIDATE_STAGES).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              <CandidateFilterChip
                label="Должность"
                value={position}
                onChange={(v) => {
                  setPosition(v);
                  firstPage();
                }}
                options={[
                  { value: "", label: "Все должности" },
                  ...options.positions.map((p) => ({ value: p, label: p })),
                ]}
              />
            </>
          ) : null}
          {query ? (
            <span className="inline-flex h-8 max-w-64 items-center gap-2 rounded-full border border-brand/20 bg-brand/10 pl-3 pr-1.5 text-sm text-brand">
              <span className="truncate">Поиск: «{query}»</span>
              <button
                aria-label="Сбросить поиск"
                onClick={() => {
                  setSearch("");
                  setQuery("");
                  firstPage();
                }}
                className="rounded-full p-0.5 hover:bg-brand/10"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
          {hasFilters || query || st.sorting.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={reset}
            >
              Очистить все
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {list.total} {plural(list.total, ["анкета", "анкеты", "анкет"])}
      </p>
      <div className="min-w-0 space-y-3" aria-busy={loading}>
        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
          >
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReload((n) => n + 1)}
            >
              Повторить загрузку
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-3 motion-safe:animate-spin" />
            Обновляем список…
          </p>
        ) : null}
        <div className="overflow-auto rounded-xl border">
          <table
            ref={tableRef}
            className="w-full table-fixed border-collapse text-left text-sm"
            style={{ minWidth: minimumTableWidth }}
          >
            <ResizableTableHead
              table={table}
              onResizeStart={onResizeStart}
              isControlColumn={noControlColumns}
              sortableColumnIds={sortableColumns}
              onSort={(id) => cycleSort(id)}
              headerIndicator={(id) => {
                const index = st.sorting.findIndex((s) => s.id === id);
                return index < 0 ? null : (
                  <span className="inline-flex items-center gap-0.5">
                    {st.sorting[index].desc ? (
                      <ArrowDown className="size-3" />
                    ) : (
                      <ArrowUp className="size-3" />
                    )}
                    {st.sorting.length > 1 ? (
                      <span className="text-[10px] tabular-nums">
                        {index + 1}
                      </span>
                    ) : null}
                  </span>
                );
              }}
              headerAriaSort={(id) => {
                if (!sortableColumns.has(id)) return undefined;
                const s = st.sorting.find((s) => s.id === id);
                return s ? (s.desc ? "descending" : "ascending") : "none";
              }}
            />
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.original.id}
                  className="border-t hover:bg-muted/30"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="overflow-hidden px-3 py-3 align-top"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && !list.rows.length ? (
                <tr>
                  <td
                    colSpan={table.getVisibleLeafColumns().length}
                    className="py-14 text-center text-muted-foreground"
                  >
                    {query || hasFilters
                      ? "По этим условиям анкет нет"
                      : "Новые анкеты появятся здесь после отправки формы на сайте."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div
          aria-disabled={loading}
          className={loading ? "pointer-events-none opacity-60" : undefined}
        >
          <TablePagination
            pageIndex={list.page}
            pageSize={pageSize}
            total={list.total}
            onPageChange={(pageIndex) => {
              if (!loading) setPagination((p) => ({ ...p, pageIndex }));
            }}
            onPageSizeChange={(pageSize) => {
              if (!loading) setPagination({ pageIndex: 0, pageSize });
            }}
          />
        </div>
      </div>
      {settings ? (
        <RecruitingSettings
          options={options}
          owner={permissions.owner}
          onClose={() => setSettings(false)}
        />
      ) : null}
    </div>
  );
}
