"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { Archive, Building2, Plus, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
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
import { formatPhoneDisplay } from "@/lib/format/phone";
import { timezoneLabel, venueTypeLabel, VENUE_TYPE_OPTIONS } from "@/lib/org/venue-labels";
import type { VenueRow } from "../page";
import { VenueCreateDrawer } from "./venue-create-drawer";

type ColKey = "name" | "type" | "address" | "phone" | "legal_entity" | "timezone" | "currency";

const labels: Record<ColKey, string> = {
  name: "Заведение",
  type: "Тип",
  address: "Адрес",
  phone: "Телефон",
  legal_entity: "Юрлицо",
  timezone: "Часовой пояс",
  currency: "Валюта",
};
const columnConfig = [
  { id: "name", defaultSize: 300 },
  { id: "type", defaultSize: 140 },
  { id: "address", defaultSize: 300 },
  { id: "phone", defaultSize: 170 },
  { id: "legal_entity", defaultSize: 200 },
  { id: "timezone", defaultSize: 220, defaultVisible: false },
  { id: "currency", defaultSize: 110, defaultVisible: false },
];
const sortFields: ColKey[] = ["name", "type", "address", "legal_entity", "timezone"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const dash = <span className="text-muted-foreground">—</span>;

export function VenuesClient({
  venues,
  archivedCount,
  canCreate,
}: {
  venues: VenueRow[];
  archivedCount: number;
  /** Создавать и архивировать заведения может только владелец аккаунта. */
  canCreate: boolean;
}) {
  const router = useRouter();
  // Без legacyVisibilityKey: в старом наборе столбцов не было «Юрлица»,
  // перенос спрятал бы новый столбец у всех, кто уже настраивал таблицу.
  const st = useTableState({ tableId: "org.venues", columns: columnConfig });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      venues.filter((v) => {
        if (
          q &&
          ![v.name, v.address ?? "", v.phone ?? "", formatPhoneDisplay(v.phone ?? "")].some((s) =>
            s.toLocaleLowerCase("ru").includes(q),
          )
        )
          return false;
        if (typeFilter && v.type !== typeFilter) return false;
        if (sourceFilter === "quickresto" && !v.imported_from_quickresto) return false;
        if (sourceFilter === "manual" && v.imported_from_quickresto) return false;
        return true;
      }),
    [venues, q, typeFilter, sourceFilter],
  );
  const hasFilters = !!typeFilter || !!sourceFilter;
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setTypeFilter("");
    setSourceFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  const text = (value: string | null | undefined) =>
    value ? (
      <span className="block truncate" data-tip={value}>
        {value}
      </span>
    ) : (
      dash
    );

  const columns: ColumnDef<VenueRow>[] = [
    {
      id: "name",
      header: labels.name,
      size: 300,
      minSize: 200,
      enableHiding: false,
      accessorFn: (v) => v.name,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const v = row.original;
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Building2 className="size-4" />
            </span>
            <Link
              href={`/org/venues/${v.id}`}
              className="min-w-0 truncate font-medium transition-colors duration-200 hover:text-brand"
              data-tip={v.name}
            >
              {v.name}
            </Link>
            {v.imported_from_quickresto ? (
              <StatusBadge tone="neutral" tip="Заведение пришло из Quick Resto" className="shrink-0">
                Quick Resto
              </StatusBadge>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "type",
      header: labels.type,
      size: 140,
      minSize: 90,
      accessorFn: (v) => venueTypeLabel(v.type),
      cell: ({ getValue }) => text(getValue() as string),
    },
    {
      id: "address",
      header: labels.address,
      size: 300,
      minSize: 120,
      accessorFn: (v) => v.address ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => text(getValue() as string | undefined),
    },
    {
      id: "phone",
      header: labels.phone,
      size: 170,
      minSize: 120,
      accessorFn: (v) => v.phone ?? undefined,
      enableSorting: false,
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? <span className="tabular-nums">{formatPhoneDisplay(v)}</span> : dash;
      },
    },
    {
      id: "legal_entity",
      header: labels.legal_entity,
      size: 200,
      minSize: 120,
      accessorFn: (v) => v.legal_entity_name ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => text(getValue() as string | undefined),
    },
    {
      id: "timezone",
      header: labels.timezone,
      size: 220,
      minSize: 140,
      accessorFn: (v) => timezoneLabel(v.timezone),
      cell: ({ getValue }) => text(getValue() as string),
    },
    {
      id: "currency",
      header: labels.currency,
      size: 110,
      minSize: 90,
      accessorFn: (v) => v.currency,
      enableSorting: false,
      cell: ({ getValue }) => <span>{getValue() as string}</span>,
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: {
      sorting: st.sorting,
      pagination: st.pagination,
      columnVisibility: { ...st.columnVisibility, name: true },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (v) => v.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const changeSorting = (next: typeof st.sorting) => {
    st.setSorting(next);
    firstPage();
  };

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Организация" }, { label: "Заведения" }]} />
      <TablePageHeader
        title="Заведения"
        count={isFiltered ? `${filtered.length} из ${venues.length}` : venues.length}
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
              placeholder: "Название, адрес или телефон",
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
                      label: labels[id as ColKey],
                      visible: c.getIsVisible(),
                      canHide: c.getCanHide(),
                    };
                  })}
                  onVisibilityChange={(id, v) => table.getColumn(id)?.toggleVisibility(v)}
                  onMoveColumn={(a, b) =>
                    st.setColumnOrder((order) => arrayMove(order, order.indexOf(a), order.indexOf(b)))
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            secondaryActions={
              canCreate && archivedCount > 0 ? (
                <TableIconButton
                  label={`Архив заведений (${archivedCount})`}
                  onClick={() => router.push("/org/venues/archive")}
                >
                  <Archive />
                </TableIconButton>
              ) : null
            }
            primaryActions={
              canCreate ? (
                <Button size="sm" className="h-9 gap-2" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  Добавить заведение
                </Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка заведений"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => {
          st.setSearch("");
          firstPage();
        }}
        onReset={resetConditions}
      >
        {(filtersOpen || hasFilters) && (
          <>
            <TableFilterChip
              label="Тип"
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v);
                firstPage();
              }}
              options={[{ value: "", label: "Все типы" }, ...VENUE_TYPE_OPTIONS]}
            />
            <TableFilterChip
              label="Источник"
              value={sourceFilter}
              onChange={(v) => {
                setSourceFilter(v);
                firstPage();
              }}
              options={[
                { value: "", label: "Все заведения" },
                { value: "quickresto", label: "Из Quick Resto" },
                { value: "manual", label: "Созданы вручную" },
              ]}
            />
          </>
        )}
      </TableConditions>

      {venues.length === 0 ? (
        <EmptyState
          icon={Building2}
          illustration="empty"
          title="Заведений пока нет"
          description={
            canCreate
              ? "Добавьте первое заведение: к нему привязываются сотрудники, график и продажи"
              : "Заведения добавляет владелец аккаунта"
          }
          action={
            canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                Добавить заведение
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Заведения не найдены"
          description="Измените условия поиска или сбросьте фильтры"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            table={table}
            label="Заведения"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) => router.push(`/org/venues/${row.original.id}`)}
            empty={null}
            mobile={{ label: "Карточки заведений", nameColumn: "name" }}
          />
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filtered.length}
            onPageChange={(pageIndex) => st.setPagination((p) => ({ ...p, pageIndex }))}
            onPageSizeChange={(pageSize) => st.setPagination({ pageIndex: 0, pageSize })}
          />
        </>
      )}

      {canCreate ? <VenueCreateDrawer open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </PageFrame>
  );
}
