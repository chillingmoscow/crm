"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Archive, ArchiveRestore, Building2, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { HardDeleteConfirmDialog } from "@/components/shared/hard-delete-confirm-dialog";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableIconButton,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { formatDateCell } from "@/lib/format/date";
import { venueTypeLabel } from "@/lib/org/venue-labels";
import {
  deleteVenue,
  getVenueArchiveImpact,
  restoreVenue,
  type VenueArchiveImpact,
} from "../../actions";
import { venueDeleteImpact } from "../../[venueId]/_components/venue-danger-zone";

export type ArchivedVenueRow = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  archived_at: string;
  archived_by_name: string | null;
};

type ColKey = "name" | "address" | "archived_at" | "archived_by";
const labels: Record<ColKey, string> = {
  name: "Заведение",
  address: "Адрес",
  archived_at: "В архиве с",
  archived_by: "Кто архивировал",
};
const columnConfig = [
  { id: "name", defaultSize: 360 },
  { id: "address", defaultSize: 260 },
  { id: "archived_at", defaultSize: 150 },
  { id: "archived_by", defaultSize: 200 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
const sortFields: ColKey[] = ["name", "address", "archived_at", "archived_by"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const displayName = (r: ArchivedVenueRow) => r.name;
const dash = <span className="text-muted-foreground">—</span>;

export function ArchivedVenuesClient({ rows }: { rows: ArchivedVenueRow[] }) {
  const router = useRouter();
  const st = useTableState({ tableId: "org.venues.archive", columns: columnConfig });
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  const [restoreTarget, setRestoreTarget] = useState<ArchivedVenueRow | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, startRestore] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<ArchivedVenueRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<VenueArchiveImpact | null>(null);

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !q ||
          [r.name, r.address ?? ""].some((v) =>
            v.toLocaleLowerCase("ru").includes(q),
          ),
      ),
    [rows, q],
  );

  const openDelete = async (row: ArchivedVenueRow) => {
    setDeleteImpact(null);
    setDeleteTarget(row);
    setDeleteImpact(await getVenueArchiveImpact(row.id));
  };

  const restore = () => {
    if (!restoreTarget) return;
    const target = restoreTarget;
    setRestoreError(null);
    startRestore(async () => {
      const { error } = await restoreVenue(target.id);
      if (error) {
        setRestoreError(error);
        return;
      }
      toast.success(`Заведение «${displayName(target)}» восстановлено`);
      setRestoreTarget(null);
      router.refresh();
    });
  };

  const columns: ColumnDef<ArchivedVenueRow>[] = [
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
        const subtitle = venueTypeLabel(r.type);
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Building2 className="size-4" />
            </span>
            <div className="min-w-0">
              <Link
                href={`/org/venues/${r.id}`}
                className="block truncate font-medium hover:underline"
                data-tip={displayName(r)}
              >
                {displayName(r)}
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
      id: "address",
      header: labels.address,
      size: 260,
      minSize: 120,
      accessorFn: (r) => r.address ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? <span className="block truncate" data-tip={v}>{v}</span> : dash;
      },
    },
    {
      id: "archived_at",
      header: labels.archived_at,
      size: 150,
      minSize: 120,
      accessorFn: (r) => r.archived_at,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{formatDateCell(getValue() as string) ?? "—"}</span>
      ),
    },
    {
      id: "archived_by",
      header: labels.archived_by,
      size: 200,
      minSize: 150,
      accessorFn: (r) => r.archived_by_name ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? <span className="block truncate" data-tip={v}>{v}</span> : dash;
      },
    },
    {
      id: "actions",
      size: ROW_MENU_COLUMN_SIZE,
      minSize: ROW_MENU_COLUMN_SIZE,
      maxSize: ROW_MENU_COLUMN_SIZE,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }) => (
        <TableRowMenu
          actions={[
            {
              label: "Восстановить",
              icon: <ArchiveRestore />,
              onSelect: () => {
                setRestoreError(null);
                setRestoreTarget(row.original);
              },
            },
            {
              label: "Удалить навсегда",
              icon: <Trash2 />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => void openDelete(row.original),
            },
          ]}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: {
      sorting: st.sorting,
      pagination: st.pagination,
      columnVisibility: { ...st.columnVisibility, name: true, actions: true },
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
  const resetConditions = () => {
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "Организация" },
          { label: "Заведения", href: "/org/venues" },
          { label: "Архив" },
        ]}
      />
      <TablePageHeader
        title="Заведения в архиве"
        count={q ? `${filtered.length} из ${rows.length}` : rows.length}
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
              placeholder: "Название или адрес",
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
              <TableIconButton
                label="Вернуться к действующим заведениям"
                active
                onClick={() => router.push("/org/venues")}
              >
                <Archive />
              </TableIconButton>
            }
          />
        }
      />
      <TableConditions
        label="Условия архива заведений"
        open={false}
        hasFilters={false}
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
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Архив пуст"
          description="Сюда попадают закрытые заведения. Их документы, операции и склады сохраняются"
          action={
            <Button variant="outline" onClick={() => router.push("/org/venues")}>
              К действующим заведениям
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Заведения не найдены"
          description="Измените условия поиска"
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
            label="Заведения в архиве"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) => router.push(`/org/venues/${row.original.id}`)}
            empty={null}
            mobile={{ label: "Карточки заведений в архиве", nameColumn: "name" }}
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

      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
            setRestoreError(null);
          }
        }}
        title={restoreTarget ? `Восстановить заведение «${displayName(restoreTarget)}»?` : ""}
        description="Заведение вернётся в списки и переключатель, сотрудники снова смогут в него переключиться"
        confirmLabel="Восстановить заведение"
        pendingLabel="Восстанавливаем…"
        busy={restoring}
        error={restoreError}
        onConfirm={restore}
      />

      {deleteTarget ? (
        <HardDeleteConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
              setDeleteImpact(null);
            }
          }}
          entityGenitive="заведение"
          entityName={deleteTarget.name}
          impact={deleteImpact ? venueDeleteImpact(deleteImpact) : []}
          restrictedBy={[]}
          onConfirm={async () => {
            const result = await deleteVenue(deleteTarget.id, {
              confirmName: deleteTarget.name,
            });
            if (result.error) return { error: result.error };
            toast.success(`Заведение «${displayName(deleteTarget)}» удалено`);
            setDeleteTarget(null);
            setDeleteImpact(null);
            router.refresh();
          }}
        />
      ) : null}
    </PageFrame>
  );
}
