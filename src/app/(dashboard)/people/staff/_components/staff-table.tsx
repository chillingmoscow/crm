"use client";

import { MotionPresence } from "@/components/shared/motion-presence";
import { useEffect, useState, type ReactNode } from "react";
import { isGender } from "@/lib/people/gender";
import { useRouter } from "next/navigation";
import { arrayMove } from "@dnd-kit/sortable";
import {
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { RotateCcw, SearchX, UserX, Users, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  StaffMember,
  PendingInvitation,
  FiredStaffMember,
} from "../actions";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TablePagination,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { PeopleListHeader } from "@/components/people/people-list-header";
import type { CasualStaffRow } from "@/lib/payroll/casual-list";
import { matchesStaffKind } from "@/lib/people/staff-kind-filter";
import { flyToStaffCard } from "@/lib/people/avatar-flight";

type Row =
  | { kind: "staff"; id: string; member: StaffMember }
  | { kind: "fired"; id: string; member: FiredStaffMember }
  | { kind: "invitation"; id: string; invitation: PendingInvitation }
  | { kind: "casual"; id: string; casual: CasualStaffRow };
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
  | "pin"
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
  { id: "pin", label: "PIN кассы", size: 132, min: 112, visible: true },
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
// Контакты, пол, дата рождения и причина увольнения коллег приходят с сервера
// только при праве на детали сотрудника (миграция 359). Без права эти колонки
// были бы пустыми — убираем их вместе с поиском и фильтром по ним.
const personalColumns = new Set<StaffColKey>([
  "email",
  "phone",
  "telegram",
  "gender",
  "birth_date",
  "fired_reason",
]);
const withoutPersonal = (definitions: StaffColumn[]) =>
  definitions.filter((c) => !personalColumns.has(c.id));
const limitedActiveDefinitions = withoutPersonal(activeDefinitions);
const limitedFiredDefinitions = withoutPersonal(firedDefinitions);
const activeConfig = toConfig(activeDefinitions);
const firedConfig = toConfig(firedDefinitions);
const limitedActiveConfig = toConfig(limitedActiveDefinitions);
const limitedFiredConfig = toConfig(limitedFiredDefinitions);
const labels = Object.fromEntries(
  [...activeDefinitions, ...firedDefinitions].map((c) => [c.id, c.label]),
);
const collator = new Intl.Collator("ru", {
  numeric: true,
  sensitivity: "base",
});
const name = (m: StaffMember | FiredStaffMember) =>
  [m.first_name, m.last_name].filter(Boolean).join(" ") ||
  m.email?.split("@")[0] ||
  "Без имени";
function value(row: Row, id: StaffColKey): string | undefined {
  if (row.kind === "casual") {
    const c = row.casual;
    return (
      ({ name: c.name, role: c.roleName, department: c.departmentName, pin: c.pin } as Record<string, string | null>)[id] ||
      undefined
    );
  }
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
        pin: m.terminal_pin,
        employment_date: m.employment_date ?? m.joined_at,
      } as Record<string, string | null | undefined>
    )[id] || undefined
  );
}
const rowHref = (row: Exclude<Row, { kind: "invitation" }>) =>
  row.kind === "casual"
    ? `/people/payroll/${row.casual.id}`
    : `/people/staff/${row.member.user_id}`;

export function StaffTable({
  staff,
  casual,
  officialUserIds,
  fired,
  showFired,
  invitations,
  roles,
  departments,
  preferenceKey,
  renderCell,
  renderInvCell,
  renderFiredCell,
  renderCasualCell,
  primaryAction,
  emptyAction,
  secondaryActions,
  overviewPanel,
  canEdit,
  canSeeDetails,
  canOpenCasual = false,
  isPending,
  onCancelInvitation,
  onRestore,
}: {
  staff: StaffMember[];
  casual: CasualStaffRow[];
  /** Пользователи с открытым сегодня официальным трудоустройством; пусто — фильтра нет. */
  officialUserIds: string[];
  fired: FiredStaffMember[];
  showFired: boolean;
  invitations: PendingInvitation[];
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  preferenceKey: string;
  renderCell: (key: StaffColKey, m: StaffMember) => ReactNode;
  renderInvCell: (key: StaffColKey, i: PendingInvitation) => ReactNode;
  renderFiredCell: (key: StaffColKey, m: FiredStaffMember) => ReactNode;
  renderCasualCell: (key: StaffColKey, c: CasualStaffRow) => ReactNode;
  primaryAction: ReactNode;
  /** Кнопка в пустом состоянии списка: «Добавить сотрудника», если есть право. */
  emptyAction?: ReactNode;
  secondaryActions: ReactNode;
  overviewPanel: ReactNode;
  canEdit: boolean;
  /** people.view_staff + people.view_staff_details: личные данные коллег и
   *  карточка сотрудника. Без права строки штатных и уволенных не открываются. */
  canSeeDetails: boolean;
  /** payroll.view: строка разового ведёт в его расчёт в «Зарплате». */
  canOpenCasual?: boolean;
  isPending: boolean;
  onCancelInvitation: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const router = useRouter();
  const definitions = canSeeDetails
    ? showFired
      ? firedDefinitions
      : activeDefinitions
    : showFired
      ? limitedFiredDefinitions
      : limitedActiveDefinitions;
  const sortable = new Set(
    definitions.filter((c) => c.id !== "avatar").map((c) => c.id),
  );
  const fields = [...sortable];
  const st = useTableState({
    tableId: `staff.list.${preferenceKey}${showFired ? ".fired" : ""}`,
    legacyVisibilityKey: showFired ? undefined : "crm-staff-visible-cols",
    columns: canSeeDetails
      ? showFired
        ? firedConfig
        : activeConfig
      : showFired
        ? limitedFiredConfig
        : limitedActiveConfig,
    defaultPageSize: 25,
  });
  // Same chip vocabulary as Candidates; filtering is local because the full venue roster is loaded.
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filter, setFilter] = useState({
    role: "",
    department: "",
    gender: "",
    kind: "",
  });
  const officialSet = new Set(officialUserIds);
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
        ...casual.map((c) => ({ kind: "casual" as const, id: c.id, casual: c })),
      ];
  const rows = source.filter((row) => {
    if (
      q &&
      !fields.some((id) => value(row, id)?.toLocaleLowerCase("ru").includes(q))
    )
      return false;
    if (
      !matchesStaffKind(
        filter.kind,
        { kind: row.kind, userId: row.kind === "staff" ? row.member.user_id : null },
        officialSet,
      )
    )
      return false;
    if (row.kind === "casual")
      return (
        (!filter.role || row.casual.roleId === filter.role) &&
        !filter.gender &&
        (!filter.department ||
          (filter.department === "__none__"
            ? !row.casual.departmentId
            : row.casual.departmentId === filter.department))
      );
    if (row.kind === "invitation")
      return (
        (!filter.role || row.invitation.role_id === filter.role) &&
        !filter.department &&
        !filter.gender
      );
    if (row.kind === "fired")
      return !filter.role || row.member.role_id === filter.role;
    const m = row.member;
    return (
      (!filter.role || m.role_id === filter.role) &&
      (!filter.gender ||
        (filter.gender === "__none__"
          ? !isGender(m.gender)
          : m.gender === filter.gender)) &&
      (!filter.department ||
        (filter.department === "__none__"
          ? !m.department_id
          : m.department_id === filter.department))
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
                : row.original.kind === "casual"
                  ? renderCasualCell(c.id, row.original.casual)
                  : renderInvCell(c.id, row.original.invitation),
        }) satisfies ColumnDef<Row>,
    ),
    {
      id: "actions",
      size: showFired ? 152 : ROW_MENU_COLUMN_SIZE,
      minSize: showFired ? 152 : ROW_MENU_COLUMN_SIZE,
      maxSize: showFired ? 152 : ROW_MENU_COLUMN_SIZE,
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
  // Карточка штатного/уволенного требует права на детали (иначе редирект);
  // разовые открываются в «Зарплате» — только с правом на неё.
  const opensCard = (
    row: Row,
  ): row is Exclude<Row, { kind: "invitation" }> =>
    (row.kind === "casual" && canOpenCasual) ||
    (row.kind !== "invitation" && row.kind !== "casual" && canSeeDetails);
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
    setFilter({ role: "", department: "", gender: "", kind: "" });
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };
  // Счётчик — люди, а не строки: приглашения в него не входят. При поиске
  // или фильтре — «N из M», чтобы число не выдавалось за весь состав.
  const people = (list: Row[]) => list.filter((r) => r.kind !== "invitation").length;
  const count =
    active || q ? `${people(rows)} из ${people(source)}` : people(source);
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
        title={showFired ? "Уволенные сотрудники" : "Сотрудники"}
        crumb="Сотрудники"
        count={count}
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
              placeholder: canSeeDetails
                ? "Имя, телефон, email или должность"
                : "Имя или должность",
            }}
            filters={{
              active,
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
      {overviewPanel}
      <TableConditions
        label="Условия списка сотрудников"
        open={filtersVisible}
        hasFilters={active}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={fields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => {
          st.setSearch("");
          firstPage();
        }}
        onReset={reset}
      >
        <MotionPresence show={filtersVisible || !!filter.role}>
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
        </MotionPresence>
        <MotionPresence show={!showFired && (filtersVisible || !!filter.department)}>
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
        </MotionPresence>
        <MotionPresence show={!showFired && canSeeDetails && (filtersVisible || !!filter.gender)}>
          <TableFilterChip
            label="Пол"
            value={filter.gender}
            onChange={(v) => set("gender", v)}
            options={[
              { value: "", label: "Любой пол" },
              { value: "male", label: "Мужской" },
              { value: "female", label: "Женский" },
              { value: "__none__", label: "Пол не указан" },
            ]}
          />
        </MotionPresence>
        <MotionPresence show={!showFired && (filtersVisible || !!filter.kind)}>
          <TableFilterChip
            label="Тип"
            value={filter.kind}
            onChange={(v) => set("kind", v)}
            options={[
              { value: "", label: "Все сотрудники" },
              { value: "staff", label: "Штатные" },
              { value: "casual", label: "Разовые" },
              ...(officialUserIds.length > 0
                ? [{ value: "official", label: "Официально трудоустроены" }]
                : []),
            ]}
          />
        </MotionPresence>
      </TableConditions>
      {rows.length === 0 ? (
        <EmptyState
          icon={active || q ? SearchX : showFired ? UserX : Users}
          title={
            active || q
              ? "Сотрудники не найдены"
              : showFired
                ? "Уволенных сотрудников нет"
                : "Сотрудников пока нет"
          }
          description={
            active || q
              ? "Измените поиск или условия списка."
              : showFired
                ? "Здесь появятся сотрудники после увольнения."
                : "Добавьте сотрудника вручную или отправьте приглашение на почту."
          }
          action={
            active || q ? (
              <Button variant="outline" onClick={reset}>
                Очистить все
              </Button>
            ) : showFired ? undefined : (
              emptyAction
            )
          }
        />
      ) : (
        <>
        <DataTable
          table={table}
          label={showFired ? "Уволенные сотрудники" : "Сотрудники"}
          labels={labels}
          onColumnSizingChange={st.setColumnSizing}
          sorting={st.sorting}
          onSortingChange={changeSorting}
          sortable={sortable}
          onRowClick={(row) => {
            const r = row.original;
            if (!opensCard(r)) return;
            const href = rowHref(r);
            if (r.kind === "casual") return router.push(href);
            // Карточка сотрудника: аватар строки перелетает в её шапку.
            flyToStaffCard(
              { userId: r.member.user_id, src: r.member.avatar_url, name: name(r.member) },
              () => router.push(href),
            );
          }}
          rowClassName={(row) =>
            opensCard(row.original) ? undefined : "!cursor-default"
          }
          empty="По этим условиям сотрудников нет"
          mobile={{
            label: showFired
              ? "Карточки уволенных сотрудников"
              : "Карточки сотрудников",
            nameColumn: "name",
            photoColumn: "avatar",
            roleColumn: "role",
            actionsPlacement: showFired ? "footer" : "header",
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
            st.setPagination({ pageIndex: 0, pageSize })
          }
        />
        </>
      )}
    </>
  );
}
