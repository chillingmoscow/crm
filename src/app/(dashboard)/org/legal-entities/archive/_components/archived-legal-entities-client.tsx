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
import { Archive, ArchiveRestore, FileBadge2, SearchX, Trash2 } from "lucide-react";
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
import {
  deleteLegalEntity,
  getLegalEntityArchiveImpact,
  restoreLegalEntity,
  type LegalEntityArchiveImpact,
} from "@/lib/org/legal-entities";
import { legalFormLabel } from "@/lib/org/legal-entity-labels";
import {
  legalEntityDeleteImpact,
  legalEntityDeleteRestrictions,
} from "../../[id]/_components/legal-entity-danger-zone";

export type ArchivedLegalEntityRow = {
  id: string;
  name: string;
  short_name: string | null;
  legal_form: string;
  inn: string | null;
  archived_at: string;
  archived_by_name: string | null;
};

type ColKey = "name" | "inn" | "archived_at" | "archived_by";
const labels: Record<ColKey, string> = {
  name: "Юрлицо",
  inn: "ИНН",
  archived_at: "В архиве с",
  archived_by: "Кто архивировал",
};
const columnConfig = [
  { id: "name", defaultSize: 360 },
  { id: "inn", defaultSize: 150 },
  { id: "archived_at", defaultSize: 150 },
  { id: "archived_by", defaultSize: 200 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
const sortFields: ColKey[] = ["name", "inn", "archived_at", "archived_by"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const displayName = (r: ArchivedLegalEntityRow) => r.short_name?.trim() || r.name;
const dash = <span className="text-muted-foreground">—</span>;

export function ArchivedLegalEntitiesClient({ rows }: { rows: ArchivedLegalEntityRow[] }) {
  const router = useRouter();
  const st = useTableState({ tableId: "org.legal-entities.archive", columns: columnConfig });
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  const [restoreTarget, setRestoreTarget] = useState<ArchivedLegalEntityRow | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, startRestore] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<ArchivedLegalEntityRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<LegalEntityArchiveImpact | null>(null);

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !q ||
          [r.name, r.short_name ?? "", r.inn ?? ""].some((v) =>
            v.toLocaleLowerCase("ru").includes(q),
          ),
      ),
    [rows, q],
  );

  const openDelete = async (row: ArchivedLegalEntityRow) => {
    setDeleteImpact(null);
    setDeleteTarget(row);
    setDeleteImpact(await getLegalEntityArchiveImpact(row.id));
  };

  const restore = () => {
    if (!restoreTarget) return;
    const target = restoreTarget;
    setRestoreError(null);
    startRestore(async () => {
      const { error } = await restoreLegalEntity(target.id);
      if (error) {
        setRestoreError(error);
        return;
      }
      toast.success(`Юрлицо «${displayName(target)}» восстановлено`);
      setRestoreTarget(null);
      router.refresh();
    });
  };

  const columns: ColumnDef<ArchivedLegalEntityRow>[] = [
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
        const subtitle = [legalFormLabel(r.legal_form), r.short_name?.trim() ? r.name : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileBadge2 className="size-4" />
            </span>
            <div className="min-w-0">
              <Link
                href={`/org/legal-entities/${r.id}`}
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
      id: "inn",
      header: labels.inn,
      size: 150,
      minSize: 100,
      accessorFn: (r) => r.inn ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? <span className="tabular-nums">{v}</span> : dash;
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
          { label: "Юридические лица", href: "/org/legal-entities" },
          { label: "Архив" },
        ]}
      />
      <TablePageHeader
        title="Юридические лица в архиве"
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
              placeholder: "Название или ИНН",
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
                label="Вернуться к действующим юрлицам"
                active
                onClick={() => router.push("/org/legal-entities")}
              >
                <Archive />
              </TableIconButton>
            }
          />
        }
      />
      <TableConditions
        label="Условия архива юрлиц"
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
          description="Сюда попадают юрлица, которые больше не используются. Их история сохраняется"
          action={
            <Button variant="outline" onClick={() => router.push("/org/legal-entities")}>
              К действующим юрлицам
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Юрлица не найдены"
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
            label="Юридические лица в архиве"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) => router.push(`/org/legal-entities/${row.original.id}`)}
            empty={null}
            mobile={{ label: "Карточки юрлиц в архиве", nameColumn: "name" }}
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
        title={restoreTarget ? `Восстановить юрлицо «${displayName(restoreTarget)}»?` : ""}
        description="Юрлицо снова появится в выборах при создании счетов, операций и заведений"
        confirmLabel="Восстановить юрлицо"
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
          entityGenitive="юрлицо"
          entityName={deleteTarget.name}
          impact={deleteImpact ? legalEntityDeleteImpact(deleteImpact) : []}
          restrictedBy={deleteImpact ? legalEntityDeleteRestrictions(deleteImpact) : []}
          onConfirm={async () => {
            const result = await deleteLegalEntity(deleteTarget.id, {
              confirmName: deleteTarget.name,
            });
            if (result.error) return { error: result.error };
            toast.success(`Юрлицо «${displayName(deleteTarget)}» удалено`);
            setDeleteTarget(null);
            setDeleteImpact(null);
            router.refresh();
          }}
        />
      ) : null}
    </PageFrame>
  );
}
