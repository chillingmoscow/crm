"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Eye, RotateCcw, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableBulkBar,
  TableControls,
  TablePageHeader,
  TableRowMenu,
  useTableState,
} from "@/components/shared/table";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { countRu } from "@/lib/format/plural";
import { hardDeleteKbPages, restoreKbPages } from "@/lib/knowledge/pages";
import {
  KB_TRASH_BUCKET_LABEL,
  kbTrashBucket,
  kbTrashMatches,
} from "@/lib/knowledge/trash";
import { KbEmptyTrashButton } from "./kb-empty-trash-button";

export interface TrashRow {
  id: string;
  slug: string;
  title: string | null;
  icon: string | null;
  iconColor: string | null;
  /** Сколько подстраниц уехало в корзину вместе со страницей. */
  descendantsCount: number;
  deletedAt: string | null;
  deletedByName: string | null;
}

const LABELS: Record<string, string> = {
  title: "Страница",
  deletedBy: "Удалил",
  deletedAt: "Удалена",
};

const COLUMNS = [
  { id: "title", defaultSize: 420 },
  { id: "deletedBy", defaultSize: 200 },
  { id: "deletedAt", defaultSize: 180 },
];

const pages = (n: number) => countRu(n, "страница", "страницы", "страниц");

/**
 * Корзина базы знаний по образцу списков (DS → «List-страница»): шапка со
 * счётчиком и поиском, таблица с выбором и группами по дате удаления,
 * меню строки и панель выделенного. Срока хранения нет: страница лежит,
 * пока её не восстановят или не удалят навсегда (решение 27.11.2026).
 */
export function KbTrashClient({ rows }: { rows: TrashRow[] }) {
  const router = useRouter();
  const st = useTableState({ tableId: "kb-trash.v2", columns: COLUMNS });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pending, startTransition] = useTransition();
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  // Сначала недавно удалённые: группы по дате идут подряд.
  const visible = useMemo(
    () =>
      rows
        .filter((r) => kbTrashMatches(r.title || "Без названия", st.search))
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
    [rows, st.search],
  );
  const selectedIds = visible.filter((r) => rowSelection[r.id]).map((r) => r.id);
  const clearSelection = () => setRowSelection({});
  // После действия снимаем отметки только с тех страниц, над которыми оно
  // было: восстановление одной строки из меню ⋯ не сбрасывает остальной выбор.
  const unselect = (ids: string[]) =>
    setRowSelection((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });

  // restoreKbPages / hardDeleteKbPages применяют успешные и продолжают после
  // ошибки, поэтому всегда обновляем список и снимаем выбор (Codex #314 P2).
  const runRestore = (ids: string[]) => {
    if (ids.length === 0) return;
    startTransition(async () => {
      const { restored, error } = await restoreKbPages(ids);
      if (restored > 0) {
        toast.success(restored > 1 ? `Восстановлено: ${pages(restored)}` : "Страница восстановлена");
      }
      if (error) {
        toast.error(
          restored > 0
            ? "Часть страниц не восстановилась. Попробуйте ещё раз"
            : ids.length > 1
              ? "Не удалось восстановить страницы. Попробуйте ещё раз"
              : "Не удалось восстановить страницу. Попробуйте ещё раз",
        );
      }
      unselect(ids);
      router.refresh();
    });
  };

  const runHardDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    startTransition(async () => {
      const { deleted, error } = await hardDeleteKbPages(ids);
      if (deleted > 0) {
        toast.success(deleted > 1 ? `Удалено навсегда: ${pages(deleted)}` : "Страница удалена навсегда");
      }
      if (error) {
        toast.error(
          deleted > 0
            ? "Часть страниц не удалилась. Попробуйте ещё раз"
            : ids.length > 1
              ? "Не удалось удалить страницы. Попробуйте ещё раз"
              : "Не удалось удалить страницу. Попробуйте ещё раз",
        );
      }
      setConfirmIds(null);
      unselect(ids);
      router.refresh();
    });
  };

  const columns = useMemo<ColumnDef<TrashRow>[]>(
    () => [
      {
        id: "select",
        size: 44,
        minSize: 44,
        maxSize: 44,
        enableResizing: false,
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            aria-label={`Выбрать «${row.original.title || "Без названия"}»`}
            className="align-middle"
          />
        ),
      },
      {
        id: "title",
        header: LABELS.title,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="flex min-w-0 items-center gap-2.5">
              <KbPageIcon icon={r.icon} color={r.iconColor} size={16} />
              <span className="flex min-w-0 flex-col">
                <Link
                  href={`/knowledge/${r.slug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate font-medium transition-colors hover:text-brand"
                >
                  {r.title || "Без названия"}
                </Link>
                {r.descendantsCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Вместе с {countRu(r.descendantsCount, "подстраницей", "подстраницами", "подстраницами")}
                  </span>
                )}
              </span>
            </span>
          );
        },
      },
      {
        id: "deletedBy",
        header: LABELS.deletedBy,
        cell: ({ row }) => row.original.deletedByName ?? "—",
      },
      {
        id: "deletedAt",
        header: LABELS.deletedAt,
        cell: ({ row }) =>
          row.original.deletedAt
            ? formatDistanceToNow(new Date(row.original.deletedAt), { addSuffix: true, locale: ru })
            : "—",
      },
      {
        id: "actions",
        size: ROW_MENU_COLUMN_SIZE,
        minSize: ROW_MENU_COLUMN_SIZE,
        maxSize: ROW_MENU_COLUMN_SIZE,
        enableResizing: false,
        cell: ({ row }) => (
          <TableRowMenu
            label={`Действия со страницей «${row.original.title || "Без названия"}»`}
            actions={[
              {
                label: "Открыть для чтения",
                icon: <Eye className="size-4" />,
                onSelect: () => router.push(`/knowledge/${row.original.slug}`),
              },
              {
                label: "Восстановить",
                icon: <RotateCcw className="size-4" />,
                disabled: pending,
                onSelect: () => runRestore([row.original.id]),
              },
              {
                label: "Удалить навсегда",
                icon: <Trash2 className="size-4" />,
                destructive: true,
                separatorBefore: true,
                disabled: pending,
                onSelect: () => setConfirmIds([row.original.id]),
              },
            ]}
          />
        ),
      },
    ],
    // runRestore и router стабильны по смыслу; pending обновляет доступность.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending],
  );

  const table = useReactTable({
    data: visible,
    columns,
    getRowId: (r) => r.id,
    state: {
      columnOrder: ["select", ...st.columnOrder, "actions"],
      columnSizing: st.columnSizing,
      rowSelection,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: st.setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
  });

  const confirmRows = rows.filter((r) => confirmIds?.includes(r.id));
  const confirmChildren = confirmRows.reduce((sum, r) => sum + r.descendantsCount, 0);

  return (
    <div className={selectedIds.length > 0 ? "flex flex-col gap-6 pb-28 md:pb-24" : "flex flex-col gap-6"}>
      <TablePageHeader
        title="Корзина"
        count={rows.length === 0 ? undefined : st.search ? `${visible.length} из ${rows.length}` : rows.length}
        actions={
          rows.length > 0 ? (
            <TableControls
              search={{
                value: st.search,
                onChange: st.setSearch,
                open: st.searchOpen,
                onOpenChange: st.setSearchOpen,
                placeholder: "Название страницы",
              }}
              primaryActions={<KbEmptyTrashButton count={rows.length} />}
            />
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Корзина пуста"
          description="Удалённые страницы попадают сюда вместе с подстраницами и лежат, пока их не восстановят или не удалят навсегда"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Ничего не найдено"
          description="В корзине нет страниц с таким названием"
        />
      ) : (
        <DataTable
          table={table}
          label="Удалённые страницы"
          labels={LABELS}
          onColumnSizingChange={st.setColumnSizing}
          onRowClick={(row) => row.toggleSelected()}
          empty={null}
          controlColumns={["select", "actions"]}
          renderControlHeader={(header) =>
            header.column.id === "select" ? (
              <Checkbox
                checked={
                  table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")
                }
                onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
                aria-label="Выбрать все страницы"
                className="align-middle"
              />
            ) : null
          }
          groups={{
            key: (r) => kbTrashBucket(r.deletedAt),
            header: (_rows, key) => KB_TRASH_BUCKET_LABEL[key as keyof typeof KB_TRASH_BUCKET_LABEL],
          }}
          mobile={{
            label: "Удалённые страницы",
            nameColumn: "title",
            // В шапке карточки уже флажок выбора, меню ⋯ — в подвале
            // (как в зарплате и документах).
            actionsPlacement: "footer",
            selection: (
              <label className="flex min-h-10 items-center gap-3 text-sm text-muted-foreground">
                <Checkbox
                  checked={
                    table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")
                  }
                  onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
                />
                Выбрать все
              </label>
            ),
          }}
        />
      )}

      <TableBulkBar
        floating
        selectedCount={selectedIds.length}
        onClear={clearSelection}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => runRestore(selectedIds)} disabled={pending}>
              <RotateCcw className="size-4" />
              Восстановить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmIds(selectedIds)}
              disabled={pending}
            >
              <Trash2 className="size-4" />
              Удалить навсегда
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={confirmIds !== null}
        onOpenChange={(open) => !open && setConfirmIds(null)}
        tone="destructive"
        title={
          confirmRows.length === 1
            ? `Удалить «${confirmRows[0].title || "Без названия"}» навсегда?`
            : `Удалить ${pages(confirmRows.length)} навсегда?`
        }
        consequences={[
          ...(confirmChildren > 0
            ? [
                {
                  kind: "remove" as const,
                  text:
                    confirmRows.length === 1
                      ? "Подстраницы удалятся вместе с ней"
                      : "Подстраницы удалятся вместе с ними",
                  count: confirmChildren,
                },
              ]
            : []),
          { kind: "irreversible" as const, text: "Восстановить будет нельзя" },
        ]}
        confirmLabel="Удалить навсегда"
        pendingLabel="Удаляем…"
        busy={pending}
        onConfirm={() => confirmIds && runHardDelete(confirmIds)}
      />
    </div>
  );
}
