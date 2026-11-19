"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { Check, Lock, Plus, SearchX, Shield } from "lucide-react";
import { iconForRole } from "./role-icons";
import { IconPicker } from "./icon-picker";
import { paletteText, type PaletteColor } from "@/lib/palette";
import { pluralRu } from "@/lib/format/plural";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditDrawer } from "@/components/ui/edit-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createRole } from "../actions";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TablePageHeader,
  TablePagination,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";

// ── Types ────────────────────────────────────────────────────

type Role = {
  id: string;
  venue_id: string | null;
  name: string;
  code: string;
  comment: string | null;
  icon: string | null;
  icon_color: string | null;
  department_id: string | null;
};

type Permission = {
  id: string;
};

type RolePermission = {
  role_id: string;
  permission_id: string;
  granted: boolean;
};

type DepartmentLite = {
  id: string;
  name: string;
};

type Props = {
  roles: Role[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  accountId: string | null;
  activeVenueId: string | null;
  staffCountByRole: Record<string, number>;
  importedRoleIds: string[];
  departments: DepartmentLite[];
};

// ── Columns ──────────────────────────────────────────────────

type ColKey = "name" | "department" | "staff" | "permissions" | "qr_import";

const labels: Record<ColKey, string> = {
  name: "Должность",
  department: "Подразделение",
  staff: "Сотрудники",
  permissions: "Права",
  qr_import: "Импорт из Quick Resto",
};
const columnConfig = [
  { id: "name", defaultSize: 320 },
  { id: "department", defaultSize: 200 },
  { id: "staff", defaultSize: 160 },
  { id: "permissions", defaultSize: 220 },
  { id: "qr_import", defaultSize: 190 },
];
const sortFields: ColKey[] = [
  "name",
  "department",
  "staff",
  "permissions",
  "qr_import",
];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

// ── Main component ─────────────────────────────────────────────

export function RolesClient({
  roles: initialRoles,
  permissions,
  rolePermissions,
  accountId,
  activeVenueId,
  staffCountByRole,
  importedRoleIds,
  departments,
}: Props) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const importedSet = useMemo(() => new Set(importedRoleIds), [importedRoleIds]);
  const [isPending, startTransition] = useTransition();

  const st = useTableState({
    tableId: "people.roles",
    legacyVisibilityKey: "crm-roles-visible-cols",
    columns: columnConfig,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState({ department: "", imported: "" });
  const departmentNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  // Create drawer
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleIcon, setNewRoleIcon] = useState<string | null>(null);
  const [newRoleIconColor, setNewRoleIconColor] = useState<string | null>(null);
  // "" = create from scratch; otherwise = source role id to copy permissions from
  const [copyFromRoleId, setCopyFromRoleId] = useState<string>("");

  // Roles available as a "copy from" source — exclude the role being created.
  // Sorted: system roles first, then custom by name.
  const copyableRoles = useMemo(
    () =>
      [...roles].sort((a, b) => {
        // System owner (venue_id NULL) сверху, потом venue-scoped по имени.
        if (a.venue_id === null && b.venue_id !== null) return -1;
        if (a.venue_id !== null && b.venue_id === null) return 1;
        return a.name.localeCompare(b.name, "ru");
      }),
    [roles],
  );

  const grantedByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rp of rolePermissions)
      if (rp.granted) counts.set(rp.role_id, (counts.get(rp.role_id) ?? 0) + 1);
    return counts;
  }, [rolePermissions]);

  const q = st.search.toLocaleLowerCase("ru").trim();
  const hasFilters = !!(filter.department || filter.imported);
  const filteredRoles = roles.filter((r) => {
    if (q && !r.name.toLocaleLowerCase("ru").includes(q)) return false;
    const imported = importedSet.has(r.id);
    if (filter.imported === "yes" && !imported) return false;
    if (filter.imported === "no" && imported) return false;
    if (filter.department === "__none__" && r.department_id) return false;
    if (
      filter.department &&
      filter.department !== "__none__" &&
      r.department_id !== filter.department
    )
      return false;
    return true;
  });
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setFilter({ department: "", imported: "" });
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  function handleCreate() {
    const name = newRoleName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createRole({
        name,
        copyFromRoleId: copyFromRoleId || undefined,
        icon: newRoleIcon,
        iconColor: newRoleIconColor,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success("Должность создана");
      }
      if (result.id) {
        const created: Role = {
          id: result.id,
          venue_id: activeVenueId,
          name,
          code: `custom_${name
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_]/g, "")
            .substring(0, 40)}`,
          comment: null,
          icon: newRoleIcon,
          icon_color: newRoleIconColor,
          department_id: null,
        };
        setRoles((prev) => [...prev, created]);
        setSheetOpen(false);
        setNewRoleName("");
        setNewRoleIcon(null);
        setNewRoleIconColor(null);
        setCopyFromRoleId("");
        router.push(`/people/roles/${result.id}`);
      }
    });
  }

  const total = permissions.length;
  const columns: ColumnDef<Role>[] = [
    {
      id: "name",
      header: labels.name,
      size: 320,
      minSize: 220,
      enableHiding: false,
      accessorFn: (r) => r.name,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const role = row.original;
        const RoleIcon = iconForRole(role.code, role.icon);
        const tint = paletteText(role.icon_color as PaletteColor | null);
        const desc = role.comment?.trim();
        return (
          // span, а не div: правило карточки на телефоне растягивает первый
          // ребёнок div-обёртки имени на всю ширину (для бейджей сотрудника).
          <span className="flex min-w-0 items-center gap-3">
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                role.code === "owner"
                  ? "bg-brand/10 text-brand"
                  : `bg-muted ${tint || "text-muted-foreground"}`
              }`}
            >
              <RoleIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/people/roles/${role.id}`}
                  className="truncate font-medium hover:underline"
                  data-tip={role.name}
                >
                  {role.name}
                </Link>
                {role.venue_id === null && (
                  <StatusBadge icon={<Lock />} className="shrink-0">
                    Системная
                  </StatusBadge>
                )}
              </div>
              {desc && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {desc}
                </div>
              )}
            </div>
          </span>
        );
      },
    },
    {
      id: "department",
      header: labels.department,
      size: 200,
      minSize: 150,
      accessorFn: (r) =>
        r.department_id ? departmentNameById.get(r.department_id) : undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const name = getValue() as string | undefined;
        return name ? (
          <span className="block truncate" data-tip={name}>
            {name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "staff",
      header: labels.staff,
      size: 160,
      minSize: 120,
      accessorFn: (r) => staffCountByRole[r.id] ?? 0,
      cell: ({ getValue }) => {
        const count = getValue() as number;
        return count ? (
          <span className="tabular-nums">
            {count} {pluralRu(count, "сотрудник", "сотрудника", "сотрудников")}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "permissions",
      header: labels.permissions,
      size: 220,
      minSize: 160,
      accessorFn: (r) => grantedByRole.get(r.id) ?? 0,
      cell: ({ getValue }) => {
        const granted = getValue() as number;
        const pct = total > 0 ? Math.round((granted / total) * 100) : 0;
        return (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium tabular-nums">
                {granted} из {total}
              </span>
              <span
                className={`tabular-nums ${pct === 100 ? "text-brand" : "text-muted-foreground"}`}
              >
                {pct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      id: "qr_import",
      header: labels.qr_import,
      size: 190,
      minSize: 170,
      accessorFn: (r) => (importedSet.has(r.id) ? 1 : 0),
      cell: ({ getValue }) =>
        getValue() ? (
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-4 text-brand" aria-hidden />
            Да
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  const table = useReactTable({
    data: filteredRoles,
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
  const openCreate = () => {
    setNewRoleName("");
    setSheetOpen(true);
  };

  return (
    <PageFrame>
      <Breadcrumbs items={[{ label: "Люди" }, { label: "Должности" }]} />
      <TablePageHeader
        title="Должности"
        count={isFiltered ? `${filteredRoles.length} из ${roles.length}` : roles.length}
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
              placeholder: "Название должности",
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
            primaryActions={
              accountId ? (
                <Button size="sm" className="h-9 gap-2" onClick={openCreate}>
                  <Plus className="size-4" />
                  Добавить
                </Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка должностей"
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
        {(filtersOpen || !!filter.department) && (
          <TableFilterChip
            label="Подразделение"
            value={filter.department}
            onChange={(v) => {
              setFilter((f) => ({ ...f, department: v }));
              firstPage();
            }}
            options={[
              { value: "", label: "Все подразделения" },
              { value: "__none__", label: "Без подразделения" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        )}
        {(filtersOpen || !!filter.imported) && (
          <TableFilterChip
            label="Импорт из Quick Resto"
            value={filter.imported}
            onChange={(v) => {
              setFilter((f) => ({ ...f, imported: v }));
              firstPage();
            }}
            options={[
              { value: "", label: "Все должности" },
              { value: "yes", label: "Только импортированные" },
              { value: "no", label: "Только созданные вручную" },
            ]}
          />
        )}
      </TableConditions>

      {roles.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="Должностей пока нет"
          description="Создайте первую должность, чтобы назначать сотрудникам права и оплату"
          action={
            accountId ? (
              <Button onClick={openCreate}>
                <Plus className="mr-2 size-4" />
                Добавить должность
              </Button>
            ) : undefined
          }
        />
      ) : filteredRoles.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Должности не найдены"
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
            label="Должности"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) => router.push(`/people/roles/${row.original.id}`)}
            empty={null}
            mobile={{ label: "Карточки должностей", nameColumn: "name" }}
          />
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filteredRoles.length}
            onPageChange={(pageIndex) =>
              st.setPagination((p) => ({ ...p, pageIndex }))
            }
            onPageSizeChange={(pageSize) =>
              st.setPagination({ pageIndex: 0, pageSize })
            }
          />
        </>
      )}

      {/* Create drawer (520px, design-system pattern) */}
      <EditDrawer
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setNewRoleName("");
            setNewRoleIcon(null);
            setNewRoleIconColor(null);
            setCopyFromRoleId("");
          }
        }}
        title="Новая должность"
        description="Создайте роль с нуля или скопируйте права у существующей."
        footer={
          <>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isPending || !newRoleName.trim()}
            >
              Создать
            </Button>
          </>
        }
      >
        {/* Name (left, flex-1) + Icon picker (right, compact) — consistent
            with detail Settings tab; matches design J0qwQg row pattern. */}
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 flex-1 min-w-0">
            <Label htmlFor="new-role-name" className="text-[13px] font-medium">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-role-name"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Например: Бармен"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <IconPicker
            value={newRoleIcon}
            color={newRoleIconColor}
            roleCode=""
            onChange={({ icon, color }) => {
              setNewRoleIcon(icon);
              setNewRoleIconColor(color);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="copy-from" className="text-[13px] font-medium">
            На основе существующей роли
          </Label>
          <Select
            value={copyFromRoleId || "__none__"}
            onValueChange={(v) => setCopyFromRoleId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger id="copy-from">
              <SelectValue placeholder="Не копировать — настроить с нуля" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                Не копировать — настроить с нуля
              </SelectItem>
              {copyableRoles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                  {r.venue_id === null && (
                    <span className="text-muted-foreground"> · системная</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Скопируйте «Хостес» или «Официант», если новая роль похожа —
            настроить только разницу прав быстрее, чем 48 чекбоксов с нуля.
          </p>
        </div>
      </EditDrawer>
    </PageFrame>
  );
}
