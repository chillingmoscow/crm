"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { SquareKanban, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  DataTable,
  TableBulkBar,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableIconButton,
  TablePagination,
  useTableState,
} from "@/components/shared/table";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { candidateError } from "@/lib/candidates/errors";
import {
  CANDIDATE_STAGES,
  CANDIDATE_SORT_FIELDS,
  type CandidatePage,
  type CandidatePhotos,
  type CandidatePermissions,
  type CandidateSortField,
  type HiringOptions,
  type ListFilters,
} from "@/lib/candidates/types";
import { deleteCandidates, listCandidates } from "../actions";
import { CandidateDeleteDialog } from "./candidate-delete-dialog";
import { countRu } from "@/lib/format/plural";
import {
  candidateColumns,
  COLUMN_CONFIG,
  FIELD_LABELS,
  type CandidateField,
} from "./candidate-table";
import { CandidateSortPicker } from "./candidate-sort-settings";

import { PageFrame } from "@/components/shared/page-frame";
import { usePeopleOverview } from "@/components/people/people-overview";
import { PeopleListHeader } from "@/components/people/people-list-header";
import type { CandidateStatusUpdate } from "./candidate-status-change";
import { CandidateFilterChip } from "./candidate-filter-chip";
import { CandidateBoard } from "./candidate-board";
import { unwrapAction } from "@/lib/actions/result";

const sortableColumns = new Set<string>(CANDIDATE_SORT_FIELDS);
const isControlColumn = (id: string) => id === "select";

export function CandidatesClient({
  initialList,
  preferenceKey,
  accountId,
  options,
  permissions,
}: {
  initialList: CandidatePage;
  preferenceKey: string;
  accountId: string;
  options: HiringOptions;
  permissions: CandidatePermissions;
}) {
  const overview = usePeopleOverview("candidates", accountId);
  // Вид списка — таблица или доска по этапам; выбор помнится в этом браузере.
  const viewKey = `candidates.view.${preferenceKey}`;
  // null — выбор ещё не прочитан: список не рисуем, чтобы при выбранной доске
  // не мелькала таблица.
  const [view, setView] = useState<"table" | "board" | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(viewKey);
    } catch {}
    setView(saved === "board" ? "board" : "table");
  }, [viewKey]);
  const changeView = (next: "table" | "board") => {
    setView(next);
    try {
      localStorage.setItem(viewKey, next);
    } catch {}
  };
  const board = view === "board";
  const st = useTableState({
    tableId: `candidates.list.${preferenceKey}`,
    columns: COLUMN_CONFIG,
    defaultPageSize: 25,
  });
  const router = useRouter();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState<string[]>([]),
    [position, setPosition] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preset, setPreset] = useState<string | null>(null),
    [filtersVisible, setFiltersVisible] = useState(false),
    [list, setList] = useState(initialList),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [photos, setPhotos] = useState<Record<string, CandidatePhotos>>({});
  const showPhotos = st.columnVisibility.photo !== false;
  useEffect(() => {
    if (!list.rows.length || !showPhotos) return;
    const photoIds = list.rows.map((row) => row.id).join(",");
    const controller = new AbortController();
    void fetch(`/api/people/candidate-photos?ids=${photoIds}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const next: Record<string, CandidatePhotos> = await response.json();
        if (!controller.signal.aborted) setPhotos(next);
      })
      .catch(() => {}); // The table still has initials if a photo is unavailable.
    return () => controller.abort();
  }, [list.rows, showPhotos]);
  const rowsWithPhotos = useMemo(
    () => list.rows.map((row) => ({ ...row, ...photos[row.id] })),
    [list.rows, photos],
  );
  const [deleting, setDeleting] = useState<
    { id: string; full_name: string }[] | null
  >(null);
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
  const { setRowSelection } = st;
  useEffect(() => {
    setRowSelection({});
  }, [key, setRowSelection]);
  const versions = useRef(
    new Map(initialList.rows.map((row) => [row.id, row.revision])),
  );
  const firstPage = () => setPagination((p) => ({ ...p, pageIndex: 0 }));
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
      .then(unwrapAction)
      .then((next) => {
        if (cancelled) return;
        loaded.current = JSON.stringify([filters, next.page, pageSize, reload]);
        setList(next);
        versions.current = new Map(
          next.rows.map((row) => [row.id, row.revision]),
        );
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
  const refreshList = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener("candidates:incoming", refreshList);
    return () => window.removeEventListener("candidates:incoming", refreshList);
  }, [refreshList]);
  const statusSaved = useCallback(
    (saved: CandidateStatusUpdate) => {
      if ((versions.current.get(saved.id) ?? -1) >= saved.revision) return;
      versions.current.set(saved.id, saved.revision);
      setList((current) => ({
        ...current,
        rows: current.rows.map((c) =>
          c.id === saved.id
            ? {
                ...c,
                ...saved,
                // Смена этапа обнуляет срок «На этапе»: сервер ставит
                // stage_changed_at = now(), но команда его не возвращает.
                stage_changed_at:
                  saved.status !== c.status
                    ? new Date().toISOString()
                    : c.stage_changed_at,
              }
            : c,
        ),
      }));
      // Only a status-dependent filter/order needs a quiet server reconciliation.
      if (
        saved.status === "hired" ||
        status.length > 0 ||
        st.sorting.some(
          (sort) => sort.id === "status" || sort.id === "stage_changed_at",
        )
      )
        refreshList();
      window.dispatchEvent(new Event("candidates:changed"));
    },
    [status, st.sorting, refreshList],
  );
  useEffect(() => {
    const updated = (event: Event) =>
      statusSaved((event as CustomEvent<CandidateStatusUpdate>).detail);
    window.addEventListener("candidates:row-updated", updated);
    return () => window.removeEventListener("candidates:row-updated", updated);
  }, [statusSaved]);
  const columns = useMemo(
    () =>
      candidateColumns(statusSaved, refreshList, options, permissions.owner),
    [statusSaved, refreshList, options, permissions.owner],
  );
  const table = useReactTable({
    data: rowsWithPhotos,
    columns,
    state: {
      sorting: st.sorting,
      pagination: { ...st.pagination, pageSize },
      columnVisibility: {
        ...st.columnVisibility,
        full_name: true,
        select: true,
      },
      columnOrder: ["select", ...st.columnOrder],
      columnSizing: st.columnSizing,
      rowSelection: st.rowSelection,
    },
    getRowId: (row) => row.id,
    enableRowSelection: permissions.owner && !loading,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: list.total,
    onColumnSizingChange: st.setColumnSizing,
    onColumnVisibilityChange: st.setColumnVisibility,
    columnResizeMode: "onChange",
    autoResetPageIndex: false,
  });
  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((row) => row.original);
  const hasFilters = !!(status.length || position || from || to);
  const reset = () => {
    setStatus([]);
    setPosition("");
    setFrom("");
    setTo("");
    setPreset(null);
    setSearch("");
    setQuery("");
    st.setSorting([]);
    firstPage();
  };
  return (
    <PageFrame
      className={cn(
        // space-y, а не gap: свёрнутые «Обзор» и ряд условий не оставляют
        // пустого отступа (у .motion-expand в закрытом виде margin 0).
        "min-w-0 space-y-4",
        selectedRows.length > 0 && "pb-28 md:pb-24",
      )}
    >
      <PeopleListHeader
        title="Кандидаты"
        count={list.total}
        actions={
          <>
            <TableControls
              secondaryActions={
                <>
                  <TableIconButton
                    label={board ? "Показать таблицей" : "Показать доской по этапам"}
                    pressed={board}
                    onClick={() => changeView(board ? "table" : "board")}
                  >
                    {board ? <Table2 /> : <SquareKanban />}
                  </TableIconButton>
                  {overview.button}
                </>
              }
              className="min-w-0 max-w-full"
              search={{
                value: search,
                onChange: (v) => setSearch(v.slice(0, 100)),
                open: st.searchOpen,
                onOpenChange: st.setSearchOpen,
                placeholder: "Имя, телефон или должность",
              }}
              filters={{
                active: hasFilters,
                onClick: () => setFiltersVisible((v) => !v),
              }}
              sort={board ? undefined : {
                active: !!st.sorting.length,
                content: (
                  <CandidateSortPicker
                    sorting={st.sorting}
                    onChange={changeSorting}
                  />
                ),
              }}
              columns={board ? undefined : {
                content: (
                  <TableColumnManager
                    columns={table
                      .getAllLeafColumns()
                      .filter((c) => !isControlColumn(c.id))
                      .map((c) => ({
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
          </>
        }
      />
      {overview.panel}
      <TableConditions
        label="Условия списка кандидатов"
        open={filtersVisible}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={CANDIDATE_SORT_FIELDS}
        sortLabels={FIELD_LABELS}
        search={query}
        onSearchClear={() => {
          setSearch("");
          setQuery("");
          firstPage();
        }}
        onReset={reset}
      >
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
            multiple
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
      </TableConditions>
      <p className="sr-only" aria-live="polite">
        {countRu(list.total, "анкета", "анкеты", "анкет")}
      </p>
      {view === null ? null : board ? (
        <CandidateBoard
          filters={{ search: query, status, position, from: from || undefined, to: to || undefined }}
          options={options}
          permissions={permissions}
          reloadKey={reload}
          onStatusSaved={statusSaved}
        />
      ) : (
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
        <DataTable
          table={table}
          label="Кандидаты"
          labels={FIELD_LABELS}
          onColumnSizingChange={st.setColumnSizing}
          sorting={st.sorting}
          onSortingChange={changeSorting}
          sortable={sortableColumns}
          controlColumns={["select"]}
          renderControlHeader={() => (
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(checked) =>
                table.toggleAllPageRowsSelected(checked === true)
              }
              disabled={loading || !list.rows.length}
              aria-label="Выбрать все анкеты на странице"
              className="align-middle"
            />
          )}
          onRowClick={(row) =>
            router.push(`/people/candidates/${row.original.id}`)
          }
          empty={
          !loading
            ? query || hasFilters
              ? "По этим условиям анкет нет"
              : "Новые анкеты появятся здесь после отправки формы на сайте"
            : null
          }
          mobile={{
            label: "Карточки кандидатов",
            nameColumn: "full_name",
            photoColumn: "photo",
            roleColumn: "desired_position",
            statusColumn: "status",
            selection:
              permissions.owner && list.rows.length > 0 ? (
                <label className="flex min-h-10 items-center gap-3 text-sm text-muted-foreground">
                  <Checkbox
                    checked={
                      table.getIsAllPageRowsSelected() ||
                      (table.getIsSomePageRowsSelected() && "indeterminate")
                    }
                    onCheckedChange={(checked) =>
                      table.toggleAllPageRowsSelected(checked === true)
                    }
                    disabled={loading}
                    aria-label="Выбрать все анкеты на странице"
                  />
                  Выбрать все на странице
                </label>
              ) : null,
          }}
        />
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
      )}
      {permissions.owner && !board ? (
        <>
          <TableBulkBar
            floating
            selectedCount={selectedRows.length}
            onClear={() => setRowSelection({})}
            actions={
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  setDeleting(
                    selectedRows.map(({ id, full_name }) => ({
                      id,
                      full_name,
                    })),
                  )
                }
              >
                <Trash2 className="size-4" />
                Удалить
              </Button>
            }
          />
          <CandidateDeleteDialog
            open={!!deleting}
            onOpenChange={(open) => {
              if (!open) setDeleting(null);
            }}
            count={deleting?.length ?? 0}
            name={deleting?.length === 1 ? deleting[0].full_name : undefined}
            onConfirm={async () => {
              if (!deleting?.length) return;
              const count = unwrapAction(
                await deleteCandidates(deleting.map((row) => row.id)),
              );
              const deletedIds = new Set(deleting.map((row) => row.id));
              setList((current) => ({
                ...current,
                rows: current.rows.filter((row) => !deletedIds.has(row.id)),
                total: Math.max(0, current.total - count),
              }));
              setRowSelection({});
              refreshList();
              window.dispatchEvent(new Event("candidates:changed"));
              toast.success(
                count === 1 ? "Анкета удалена" : `Удалено анкет: ${count}`,
              );
            }}
          />
        </>
      ) : null}
    </PageFrame>
  );
}
