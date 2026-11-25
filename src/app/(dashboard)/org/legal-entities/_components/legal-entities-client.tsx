"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Archive, FileBadge2, Plus, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
import { countRu } from "@/lib/format/plural";
import {
  LEGAL_FORM_LABELS,
  LEGAL_FORM_OPTIONS,
  TAX_SYSTEM_LABELS,
  TAX_SYSTEM_SHORT,
} from "@/lib/org/legal-entity-labels";
import type { LegalForm, TaxSystem } from "@/types/database";
import { LegalEntityCreateDrawer } from "./legal-entity-create-drawer";

export type LegalEntityListRow = {
  id: string;
  name: string;
  short_name: string | null;
  legal_form: LegalForm;
  inn: string | null;
  kpp: string | null;
  tax_system: TaxSystem | null;
  vat_payer: boolean;
  /** Заведения, у которых это юрлицо «по умолчанию». */
  venues: string[];
};

type ColKey = "name" | "inn" | "kpp" | "tax" | "venues";

const labels: Record<ColKey, string> = {
  name: "Юрлицо",
  inn: "ИНН",
  kpp: "КПП",
  tax: "Налоги",
  venues: "Заведения",
};
const columnConfig = [
  { id: "name", defaultSize: 360 },
  { id: "inn", defaultSize: 150 },
  { id: "kpp", defaultSize: 130, defaultVisible: false },
  { id: "tax", defaultSize: 200 },
  { id: "venues", defaultSize: 220 },
];
const sortFields: ColKey[] = ["name", "inn", "tax", "venues"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

const displayName = (row: LegalEntityListRow) => row.short_name?.trim() || row.name;

export function LegalEntitiesClient({
  rows,
  canManage,
  isOwner,
  archivedCount,
  dadataEnabled,
  openCreate,
}: {
  rows: LegalEntityListRow[];
  canManage: boolean;
  isOwner: boolean;
  archivedCount: number;
  dadataEnabled: boolean;
  /** `?create=1` — открыть панель создания сразу (старый адрес «/new»). */
  openCreate: boolean;
}) {
  const router = useRouter();
  const st = useTableState({ tableId: "org.legal-entities", columns: columnConfig });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formFilter, setFormFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(openCreate);
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  // `?create=1` нужен один раз: убираем его из адреса, чтобы обновление
  // страницы не открывало панель снова.
  useEffect(() => {
    if (openCreate) router.replace("/org/legal-entities", { scroll: false });
  }, [openCreate, router]);

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (
          q &&
          ![row.name, row.short_name ?? "", row.inn ?? "", row.kpp ?? ""].some((v) =>
            v.toLocaleLowerCase("ru").includes(q),
          )
        )
          return false;
        if (formFilter && row.legal_form !== formFilter) return false;
        if (venueFilter === "with" && row.venues.length === 0) return false;
        if (venueFilter === "without" && row.venues.length > 0) return false;
        return true;
      }),
    [rows, q, formFilter, venueFilter],
  );
  const hasFilters = !!formFilter || !!venueFilter;
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setFormFilter("");
    setVenueFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  const columns: ColumnDef<LegalEntityListRow>[] = [
    {
      id: "name",
      header: labels.name,
      size: 360,
      minSize: 220,
      enableHiding: false,
      accessorFn: displayName,
      sortingFn: (a, b) => collator.compare(displayName(a.original), displayName(b.original)),
      cell: ({ row }) => {
        const r = row.original;
        const title = displayName(r);
        const fullName = r.short_name?.trim() && r.short_name.trim() !== r.name ? r.name : null;
        const subtitle = [LEGAL_FORM_LABELS[r.legal_form], fullName].filter(Boolean).join(" · ");
        return (
          // span, а не div: правило карточки на телефоне растягивает первый
          // ребёнок div-обёртки имени на всю ширину.
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileBadge2 className="size-4" />
            </span>
            <div className="min-w-0">
              <Link
                href={`/org/legal-entities/${r.id}`}
                className="block truncate font-medium transition-colors duration-200 hover:text-brand"
                data-tip={title}
              >
                {title}
              </Link>
              <div className="mt-0.5 truncate text-xs text-muted-foreground" data-tip={subtitle}>
                {subtitle}
              </div>
            </div>
          </span>
        );
      },
    },
    {
      id: "inn",
      header: labels.inn,
      size: 150,
      minSize: 100,
      accessorFn: (r) => r.inn ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? <span className="tabular-nums">{v}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "kpp",
      header: labels.kpp,
      size: 130,
      minSize: 90,
      accessorFn: (r) => r.kpp ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? <span className="tabular-nums">{v}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "tax",
      header: labels.tax,
      size: 200,
      minSize: 120,
      accessorFn: (r) => (r.tax_system ? TAX_SYSTEM_SHORT[r.tax_system] : undefined),
      sortUndefined: "last",
      cell: ({ row }) => {
        const r = row.original;
        if (!r.tax_system) return <span className="text-muted-foreground">—</span>;
        const text = `${TAX_SYSTEM_SHORT[r.tax_system]}${r.vat_payer ? " · НДС" : ""}`;
        return (
          <span
            className="block truncate"
            data-tip={`${TAX_SYSTEM_LABELS[r.tax_system]}${r.vat_payer ? ", плательщик НДС" : ""}`}
          >
            {text}
          </span>
        );
      },
    },
    {
      id: "venues",
      header: labels.venues,
      size: 220,
      minSize: 130,
      accessorFn: (r) => r.venues.length,
      cell: ({ row }) => {
        const list = row.original.venues;
        if (list.length === 0) return <span className="text-muted-foreground">—</span>;
        const text = list.length === 1 ? list[0] : countRu(list.length, "заведение", "заведения", "заведений");
        return (
          <span className="block truncate" data-tip={list.join(", ")}>
            {text}
          </span>
        );
      },
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
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const changeSorting = (next: typeof st.sorting) => {
    st.setSorting(next);
    firstPage();
  };

  const createButton = canManage ? (
    <Button size="sm" className="h-9 gap-2" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      Добавить юрлицо
    </Button>
  ) : null;

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Организация" }, { label: "Юридические лица" }]} />
      <TablePageHeader
        title="Юридические лица"
        count={isFiltered ? `${filtered.length} из ${rows.length}` : rows.length}
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
              placeholder: "Название, ИНН или КПП",
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
              isOwner && archivedCount > 0 ? (
                <TableIconButton
                  label={`Архив юрлиц (${archivedCount})`}
                  onClick={() => router.push("/org/legal-entities/archive")}
                >
                  <Archive />
                </TableIconButton>
              ) : null
            }
            primaryActions={createButton}
          />
        }
      />
      <TableConditions
        label="Условия списка юрлиц"
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
              label="Форма"
              value={formFilter}
              onChange={(v) => {
                setFormFilter(v);
                firstPage();
              }}
              options={[{ value: "", label: "Все формы" }, ...LEGAL_FORM_OPTIONS]}
            />
            <TableFilterChip
              label="Заведения"
              value={venueFilter}
              onChange={(v) => {
                setVenueFilter(v);
                firstPage();
              }}
              options={[
                { value: "", label: "Все юрлица" },
                { value: "with", label: "С заведениями" },
                { value: "without", label: "Без заведений" },
              ]}
            />
          </>
        )}
      </TableConditions>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileBadge2}
          title="Юрлиц пока нет"
          description={
            canManage
              ? "Добавьте ИП или ООО, через которое работают заведения. Реквизиты подтянутся по ИНН"
              : "Юрлица добавляют те, кто управляет реквизитами"
          }
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                Добавить юрлицо
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Юрлица не найдены"
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
            label="Юридические лица"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) => router.push(`/org/legal-entities/${row.original.id}`)}
            empty={null}
            mobile={{ label: "Карточки юрлиц", nameColumn: "name" }}
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

      {canManage ? (
        <LegalEntityCreateDrawer
          open={createOpen}
          onOpenChange={setCreateOpen}
          dadataEnabled={dadataEnabled}
        />
      ) : null}
    </PageFrame>
  );
}
