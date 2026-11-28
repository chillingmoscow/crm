"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import { DataTable, useTableState } from "@/components/shared/table";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { formatDateCell } from "@/lib/format/date";

export type KbOverviewPageRow = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  views: number;
  seconds: number;
  /** «Прочитали N из M» — только у обязательных и при праве. */
  read: { read: number; total: number } | null;
  updatedAt: string | null;
};

const LABELS: Record<string, string> = {
  title: "Страница",
  views: "Просмотры",
  seconds: "Время чтения",
  read: "Прочитали",
  updatedAt: "Обновлена",
};

const COLUMNS = [
  { id: "title", defaultSize: 360 },
  { id: "views", defaultSize: 120 },
  { id: "seconds", defaultSize: 140 },
  { id: "read", defaultSize: 140 },
  { id: "updatedAt", defaultSize: 140 },
];

function minutes(seconds: number): string {
  if (seconds <= 0) return "—";
  const min = Math.round(seconds / 60);
  return min < 1 ? "меньше минуты" : `${min} мин`;
}

/**
 * Вид «По страницам»: все живые страницы с просмотрами и временем за период,
 * долей прочитавших у обязательных и датой правки. `sortUpdated` — переход из
 * строки «давно не обновлялись»: сначала самые старые.
 */
export function KbOverviewPagesTable({
  rows,
  timeZone,
  sortUpdated,
  showRead,
}: {
  rows: KbOverviewPageRow[];
  timeZone: string;
  sortUpdated: boolean;
  showRead: boolean;
}) {
  const router = useRouter();
  const st = useTableState({ tableId: "kb-overview-pages.v1", columns: COLUMNS });
  const { setSorting } = st;

  useEffect(() => {
    if (sortUpdated) setSorting([{ id: "updatedAt", desc: false }]);
  }, [sortUpdated, setSorting]);

  const columns = useMemo<ColumnDef<KbOverviewPageRow>[]>(
    () => [
      {
        id: "title",
        header: LABELS.title,
        accessorFn: (r) => r.title.trim() || "Без названия",
        cell: ({ row }) => (
          <Link
            href={`/knowledge/overview/${row.original.slug}`}
            className="flex min-w-0 items-center gap-2 transition-colors hover:text-brand"
          >
            <KbPageIcon icon={row.original.icon} color={row.original.iconColor} size={16} />
            <span className="truncate">{row.original.title.trim() || "Без названия"}</span>
          </Link>
        ),
      },
      { id: "views", header: LABELS.views, accessorFn: (r) => r.views, cell: ({ row }) => row.original.views || "—" },
      { id: "seconds", header: LABELS.seconds, accessorFn: (r) => r.seconds, cell: ({ row }) => minutes(row.original.seconds) },
      // «Прочитали» — только руководителю с правом обязательного чтения.
      ...(showRead
        ? [
            {
              id: "read",
              header: LABELS.read,
              accessorFn: (r: KbOverviewPageRow) =>
                r.read && r.read.total > 0 ? r.read.read / r.read.total : -1,
              cell: ({ row }: { row: { original: KbOverviewPageRow } }) =>
                row.original.read ? `${row.original.read.read} из ${row.original.read.total}` : "—",
            } satisfies ColumnDef<KbOverviewPageRow>,
          ]
        : []),
      {
        id: "updatedAt",
        header: LABELS.updatedAt,
        accessorFn: (r) => r.updatedAt ?? "",
        cell: ({ row }) => formatDateCell(row.original.updatedAt, timeZone) ?? "—",
      },
    ],
    [timeZone, showRead],
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

  return (
    <DataTable
      table={table}
      label="Страницы базы знаний"
      labels={LABELS}
      onColumnSizingChange={st.setColumnSizing}
      sorting={st.sorting}
      onSortingChange={st.setSorting}
      sortable={["title", "views", "seconds", "read", "updatedAt"]}
      numeric={["views", "seconds", "read"]}
      onRowClick={(row) => router.push(`/knowledge/overview/${row.original.slug}`)}
      empty="Страниц пока нет"
      mobile={{ label: "Страницы", nameColumn: "title" }}
    />
  );
}
