"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { arrayMove } from "@dnd-kit/sortable";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, X } from "lucide-react";
import type {
  StaffMember,
  PendingInvitation,
  FiredStaffMember,
} from "../actions";
import { Button } from "@/components/ui/button";
import {
  TableControls,
  TableColumnManager,
  TablePagination,
  TableControlPin,
  ResizableTableHead,
  useTableState,
} from "@/components/shared/table";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import {
  TableSortPicker,
  TableSortSettings,
} from "@/components/shared/table/table-sort-settings";
import { useTableColumnResize } from "@/components/shared/table/use-table-column-resize";
import { PeopleListHeader } from "@/components/people/people-list-header";
import { PeopleMobileCards } from "@/components/people/people-mobile-cards";
import styles from "@/components/people/people-table.module.css";

type Row =
  | { kind: "staff"; id: string; member: StaffMember }
  | { kind: "fired"; id: string; member: FiredStaffMember }
  | { kind: "invitation"; id: string; invitation: PendingInvitation };
export type StaffColKey =
  | "avatar"
  | "name"
  | "email"
  | "phone"
  | "telegram"
  | "gender"
  | "birth_date"
  | "role"
  | "department"
  | "qr_import"
  | "employment_date"
  | "fired_at"
  | "fired_reason";
type StaffColumn = {
  id: StaffColKey;
  label: string;
  size: number;
  min: number;
  visible: boolean;
};
const activeDefinitions: StaffColumn[] = [
  { id: "avatar", label: "Фото", size: 72, min: 72, visible: true },
  { id: "name", label: "Сотрудник", size: 300, min: 280, visible: true },
  { id: "email", label: "Email", size: 230, min: 140, visible: true },
  { id: "phone", label: "Телефон", size: 180, min: 168, visible: false },
  { id: "telegram", label: "Telegram", size: 150, min: 112, visible: false },
  { id: "gender", label: "Пол", size: 92, min: 76, visible: false },
  {
    id: "birth_date",
    label: "Дата рождения",
    size: 180,
    min: 156,
    visible: false,
  },
  { id: "role", label: "Должность", size: 210, min: 144, visible: true },
  {
    id: "department",
    label: "Подразделение",
    size: 190,
    min: 156,
    visible: true,
  },
  {
    id: "qr_import",
    label: "Импорт из QR",
    size: 156,
    min: 144,
    visible: true,
  },
  {
    id: "employment_date",
    label: "Трудоустройство",
    size: 190,
    min: 168,
    visible: true,
  },
];
const firedDefinitions: StaffColumn[] = [
  ...activeDefinitions
    .filter((column) => ["avatar", "name", "email", "role"].includes(column.id))
    .map((column) =>
      column.id === "email"
        ? { ...column, visible: false }
        : column.id === "name"
          ? { ...column, min: 220 }
          : column,
    ),
  {
    id: "fired_at",
    label: "Дата увольнения",
    size: 180,
    min: 168,
    visible: true,
  },
  {
    id: "fired_reason",
    label: "Причина увольнения",
    size: 300,
    min: 176,
    visible: true,
  },
];
const toConfig = (definitions: StaffColumn[]) =>
  definitions.map((c) => ({
    id: c.id,
    defaultSize: c.size,
    defaultVisible: c.visible,
  }));
const activeConfig = toConfig(activeDefinitions);
const firedConfig = toConfig(firedDefinitions);
const labels = Object.fromEntries(
  [...activeDefinitions, ...firedDefinitions].map((c) => [c.id, c.label]),
);
const collator = new Intl.Collator("ru", {
  numeric: true,
  sensitivity: "base",
});
const name = (m: StaffMember | FiredStaffMember) =>
  [m.first_name, m.last_name].filter(Boolean).join(" ") ||
  m.email.split("@")[0];
function value(row: Row, id: StaffColKey): string | undefined {
  if (row.kind === "invitation")
    return id === "name" || id === "email"
      ? row.invitation.email
      : id === "role"
        ? row.invitation.role_name
        : id === "employment_date"
          ? row.invitation.invited_at
          : undefined;
  if (row.kind === "fired") {
    const m = row.member;
    return (
      (
        {
          name: name(m),
          email: m.email,
          role: m.role_name,
          fired_at: m.fired_at,
          fired_reason: m.fired_reason,
        } as Record<string, string | null>
      )[id] || undefined
    );
  }
  const m = row.member;
  return (
    (
      {
        name: name(m),
        email: m.email,
        phone: m.phone,
        telegram: m.telegram_id,
        gender: m.gender,
        birth_date: m.birth_date,
        role: m.role_name,
        department: m.department_name,
        qr_import: m.imported_from_quickresto ? "Да" : "Нет",
        employment_date: m.employment_date ?? m.joined_at,
      } as Record<string, string | null | undefined>
    )[id] || undefined
  );
}
export function StaffTable({
  staff,
  fired,
  showFired,
  invitations,
  roles,
  departments,
  preferenceKey,
  renderCell,
  renderInvCell,
  renderFiredCell,
  primaryAction,
  secondaryActions,
  canEdit,
  isPending,
  onCancelInvitation,
  onRestore,
}: {
  staff: StaffMember[];
  fired: FiredStaffMember[];
  showFired: boolean;
  invitations: PendingInvitation[];
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  preferenceKey: string;
  renderCell: (key: StaffColKey, m: StaffMember) => ReactNode;
  renderInvCell: (key: StaffColKey, i: PendingInvitation) => ReactNode;
  renderFiredCell: (key: StaffColKey, m: FiredStaffMember) => ReactNode;
  primaryAction: ReactNode;
  secondaryActions: ReactNode;
  canEdit: boolean;
  isPending: boolean;
  onCancelInvitation: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const router = useRouter();
  const definitions = showFired ? firedDefinitions : activeDefinitions;
  const sortable = new Set(
    definitions.filter((c) => c.id !== "avatar").map((c) => c.id),
  );
  const fields = [...sortable];
  const st = useTableState({
    tableId: `staff.list.${preferenceKey}${showFired ? ".fired" : ""}`,
    legacyVisibilityKey: showFired ? undefined : "crm-staff-visible-cols",
    columns: showFired ? firedConfig : activeConfig,
    defaultPageSize: 25,
  });
  // Same chip vocabulary as Candidates; filtering is local because the full venue roster is loaded.
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filter, setFilter] = useState({
    role: "",
    department: "",
    gender: "",
    imported: "",
  });
  const q = st.search.trim().toLocaleLowerCase("ru");
  const active = Object.values(filter).some(Boolean);
  const source: Row[] = showFired
    ? fired.map((member) => ({ kind: "fired", id: member.uvr_id, member }))
    : [
        ...staff.map((member) => ({
          kind: "staff" as const,
          id: member.uvr_id,
          member,
        })),
        ...invitations.map((invitation) => ({
          kind: "invitation" as const,
          id: invitation.inv_id,
          invitation,
        })),
      ];
  const rows = source.filter((row) => {
    if (
      q &&
      !fields.some((id) => value(row, id)?.toLocaleLowerCase("ru").includes(q))
    )
      return false;
    if (row.kind === "invitation")
      return (
        (!filter.role || row.invitation.role_id === filter.role) &&
        !filter.department &&
        !filter.gender &&
        !filter.imported
      );
    if (row.kind === "fired")
      return !filter.role || row.member.role_id === filter.role;
    const m = row.member;
    return (
      (!filter.role || m.role_id === filter.role) &&
      (!filter.gender || m.gender === filter.gender) &&
      (!filter.department ||
        (filter.department === "__none__"
          ? !m.department_id
          : m.department_id === filter.department)) &&
      (!filter.imported ||
        (filter.imported === "yes") === !!m.imported_from_quickresto)
    );
  });
  const columns: ColumnDef<Row>[] = [
    ...definitions.map(
      (c) =>
        ({
          id: c.id,
          header: c.label,
          size: c.size,
          minSize: c.min,
          maxSize: 3000,
          enableHiding: c.id !== "name",
          accessorFn: (r: Row) => value(r, c.id),
          sortUndefined: "last" as const,
          sortingFn: (a, b, id) =>
            collator.compare(
              String(a.getValue(id) ?? ""),
              String(b.getValue(id) ?? ""),
            ),
          cell: ({ row }) =>
            row.original.kind === "staff"
              ? renderCell(c.id, row.original.member)
              : row.original.kind === "fired"
                ? renderFiredCell(c.id, row.original.member)
                : renderInvCell(c.id, row.original.invitation),
        }) satisfies ColumnDef<Row>,
    ),
    {
      id: "actions",
      size: showFired ? 152 : 44,
      minSize: showFired ? 152 : 44,
      maxSize: showFired ? 152 : 44,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }) =>
        row.original.kind === "fired" && canEdit ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 px-2 text-xs"
            aria-label={`Восстановить: ${name(row.original.member)}`}
            disabled={isPending}
            onClick={() => onRestore(row.original.id)}
          >
            <RotateCcw className="size-3.5" />
            Восстановить
          </Button>
        ) : row.original.kind === "invitation" && canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={`Отменить приглашение: ${row.original.invitation.email}`}
            disabled={isPending}
            onClick={() => {
              if (row.original.kind === "invitation")
                onCancelInvitation(row.original.invitation.inv_id);
            }}
          >
            <X className="size-4" />
          </Button>
        ) : null,
    },
  ];
  const table = useReactTable({
    data: rows,
    columns,
    state: {
      columnVisibility: {
        ...st.columnVisibility,
        name: true,
        actions:
          canEdit && (showFired ? fired.length > 0 : invitations.length > 0),
      },
      columnOrder: [...st.columnOrder, "actions"],
      columnSizing: st.columnSizing,
      sorting: st.sorting,
      pagination: st.pagination,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnSizingChange: st.setColumnSizing,
    onColumnVisibilityChange: st.setColumnVisibility,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const { tableRef, onResizeStart, columnWidths, minTableWidth } =
    useTableColumnResize(table, st.setColumnSizing);
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  const changeSorting = (sorting: typeof st.sorting) => {
    st.setSorting(sorting);
    firstPage();
  };
  const set = (key: keyof typeof filter, v: string) => {
    setFilter((f) => ({ ...f, [key]: v }));
    firstPage();
  };
  const reset = () => {
    setFilter({ role: "", department: "", gender: "", imported: "" });
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };
  const pageCount = Math.max(
    1,
    Math.ceil(rows.length / st.pagination.pageSize),
  );
  const { pagination, setPagination } = st;
  useEffect(() => {
    if (pagination.pageIndex >= pageCount)
      setPagination((p) => ({ ...p, pageIndex: pageCount - 1 }));
  }, [pageCount, pagination.pageIndex, setPagination]);
  return (
    <>
      <PeopleListHeader
        title="Сотрудники"
        count={rows.length}
        description={
          showFired
            ? "Уволенные сотрудники, история и восстановление"
            : "Состав команды и приглашения в выбранном заведении"
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
              placeholder: "Имя, телефон, email или должность",
            }}
            filters={{
              active: filtersVisible || active,
              onClick: () => setFiltersVisible((v) => !v),
            }}
            sort={{
              active: !!st.sorting.length,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={fields}
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
                      label: labels[id],
                      visible: c.getIsVisible(),
                      canHide: c.getCanHide(),
                    };
                  })}
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
            primaryActions={primaryAction}
            secondaryActions={secondaryActions}
          />
        }
      />
      {(filtersVisible || active || q || st.sorting.length > 0) && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Условия списка сотрудников"
        >
          {st.sorting.length > 0 && (
            <TableControlPin
              active
              label={
                st.sorting.length === 1
                  ? labels[st.sorting[0].id]
                  : `${st.sorting.length} сортировки`
              }
              icon={<ArrowUpDown />}
              contentClassName="w-auto p-3"
            >
              <TableSortSettings
                sorting={st.sorting}
                onChange={changeSorting}
                fields={fields}
                labels={labels}
              />
            </TableControlPin>
          )}
          {(filtersVisible || !!filter.role) && (
            <TableFilterChip
              label="Должность"
              value={filter.role}
              onChange={(v) => set("role", v)}
              options={[
                { value: "", label: "Все должности" },
                ...(showFired
                  ? [
                      ...new Map(
                        fired.map((m) => [
                          m.role_id,
                          { id: m.role_id, name: m.role_name },
                        ]),
                      ).values(),
                    ]
                  : roles
                ).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          )}
          {!showFired && (filtersVisible || !!filter.department) && (
            <TableFilterChip
              label="Подразделение"
              value={filter.department}
              onChange={(v) => set("department", v)}
              options={[
                { value: "", label: "Все подразделения" },
                { value: "__none__", label: "Без подразделения" },
                ...departments.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          )}
          {!showFired && (filtersVisible || !!filter.gender) && (
            <TableFilterChip
              label="Пол"
              value={filter.gender}
              onChange={(v) => set("gender", v)}
              options={[
                { value: "", label: "Любой пол" },
                { value: "male", label: "Мужской" },
                { value: "female", label: "Женский" },
              ]}
            />
          )}
          {!showFired && (filtersVisible || !!filter.imported) && (
            <TableFilterChip
              label="Импорт из QR"
              value={filter.imported}
              onChange={(v) => set("imported", v)}
              options={[
                { value: "", label: "Все сотрудники" },
                { value: "yes", label: "Из Quick Resto" },
                { value: "no", label: "Созданы в Sheerly" },
              ]}
            />
          )}
          {q && (
            <span className="inline-flex h-8 max-w-64 items-center gap-2 rounded-full border border-brand/20 bg-brand/10 pl-3 pr-2 text-sm text-brand">
              <span className="truncate">Поиск: «{st.search}»</span>
              <button
                type="button"
                aria-label="Сбросить поиск"
                onClick={() => {
                  st.setSearch("");
                  firstPage();
                }}
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}
          {(active || q || st.sorting.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={reset}
            >
              Очистить все
            </Button>
          )}
        </div>
      )}
      <div className={styles.scroll}>
        <table
          ref={tableRef}
          className={styles.table}
          style={{
            minWidth: minTableWidth,
          }}
          aria-label="Сотрудники"
        >
          <ResizableTableHead
            table={table}
            onResizeStart={onResizeStart}
            columnWidths={columnWidths}
            isControlColumn={(id) => id === "actions"}
            sortableColumnIds={sortable}
            onSort={(id) => {
              const current = st.sorting.find((s) => s.id === id);
              changeSorting(
                !current
                  ? [...st.sorting, { id, desc: false }]
                  : !current.desc
                    ? st.sorting.map((s) =>
                        s.id === id ? { ...s, desc: true } : s,
                      )
                    : st.sorting.filter((s) => s.id !== id),
              );
            }}
            headerAriaSort={(id) => {
              if (!sortable.has(id as StaffColKey)) return undefined;
              const s = st.sorting.find((s) => s.id === id);
              return s ? (s.desc ? "descending" : "ascending") : "none";
            }}
            headerIndicator={(id) => {
              const i = st.sorting.findIndex((s) => s.id === id);
              return i < 0 ? null : (
                <span className="inline-flex items-center gap-0.5">
                  {st.sorting[i].desc ? (
                    <ArrowDown className="size-3" />
                  ) : (
                    <ArrowUp className="size-3" />
                  )}
                  {st.sorting.length > 1 && (
                    <span className="text-[10px]">{i + 1}</span>
                  )}
                </span>
              );
            }}
          />
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={
                  row.original.kind !== "invitation"
                    ? "cursor-pointer"
                    : undefined
                }
                onClick={(e) => {
                  if (
                    row.original.kind !== "invitation" &&
                    !(e.target as HTMLElement).closest("button,a,input")
                  )
                    router.push(`/people/staff/${row.original.member.user_id}`);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="!h-32 text-center text-muted-foreground"
                >
                  {active || q
                    ? "По этим условиям сотрудников нет"
                    : showFired
                      ? "Уволенных сотрудников нет."
                      : "Добавьте первого сотрудника или отправьте приглашение."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PeopleMobileCards
        table={table}
        label={
          showFired ? "Карточки уволенных сотрудников" : "Карточки сотрудников"
        }
        actionsPlacement={showFired ? "footer" : "header"}
        nameColumn="name"
        photoColumn="avatar"
        roleColumn="role"
        labels={labels}
        onOpen={(row) => {
          if (row.original.kind !== "invitation")
            router.push(`/people/staff/${row.original.member.user_id}`);
        }}
        empty={
          active || q
            ? "По этим условиям сотрудников нет"
            : showFired
              ? "Уволенных сотрудников нет."
              : "Добавьте первого сотрудника или отправьте приглашение."
        }
      />
      <TablePagination
        pageIndex={Math.min(st.pagination.pageIndex, pageCount - 1)}
        pageSize={st.pagination.pageSize}
        total={rows.length}
        onPageChange={(pageIndex) =>
          st.setPagination((p) => ({ ...p, pageIndex }))
        }
        onPageSizeChange={(pageSize) =>
          st.setPagination({ pageIndex: 0, pageSize })
        }
      />
    </>
  );
}
