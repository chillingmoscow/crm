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
import { Boxes, Crown, Plus, SearchX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { paletteText, type PaletteColor } from "@/lib/palette";
import { pluralRu } from "@/lib/format/plural";

import { ICON_REGISTRY } from "../../roles/_components/role-icons";
import { createDepartment, type DepartmentSummary } from "../actions";
import { DepartmentIconPicker } from "./department-icon-picker";
import {
  StaffStackCell,
  type StaffStackMember,
} from "@/components/people/staff-stack-cell";
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

// ── Columns ──────────────────────────────────────────────────

type ColKey = "name" | "head" | "roles" | "staff";

const labels: Record<ColKey, string> = {
  name: "Подразделение",
  head: "Руководитель",
  roles: "Должности",
  staff: "Сотрудники",
};
const columnConfig = [
  { id: "name", defaultSize: 360 },
  { id: "head", defaultSize: 220 },
  { id: "roles", defaultSize: 160 },
  { id: "staff", defaultSize: 160 },
];
const sortFields: ColKey[] = ["name", "head", "roles", "staff"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

// ── Main component ─────────────────────────────────────────────

interface Props {
  initialDepartments: DepartmentSummary[];
  /** Активные сотрудники на должностях подразделения, по алфавиту. */
  staffByDepartment: Record<string, StaffStackMember[]>;
  accountId: string | null;
  canManage: boolean;
}

export function DepartmentsClient({
  initialDepartments,
  staffByDepartment,
  accountId,
  canManage,
}: Props) {
  const router = useRouter();
  const [departments, setDepartments] = useState(initialDepartments);
  const [isPending, startTransition] = useTransition();

  const st = useTableState({
    tableId: "people.departments",
    legacyVisibilityKey: "crm-departments-visible-cols",
    columns: columnConfig,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [headFilter, setHeadFilter] = useState("");
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  // Create drawer
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  function resetForm() {
    setName("");
    setIcon(null);
    setIconColor(null);
    setDescription("");
  }

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filteredDepartments = useMemo(
    () =>
      departments.filter((d) => {
        if (q && !d.name.toLocaleLowerCase("ru").includes(q)) return false;
        if (headFilter === "assigned" && !d.head_role_id) return false;
        if (headFilter === "missing" && d.head_role_id) return false;
        return true;
      }),
    [departments, q, headFilter],
  );
  const isFiltered = q.length > 0 || !!headFilter;
  const resetConditions = () => {
    setHeadFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createDepartment({
        name: trimmed,
        icon,
        iconColor,
        description: description.trim() || null,
      });
      // `{ id: null, error: null }` — недопустимое состояние контракта,
      // но было прецедент. Guard оставляем, см. #291.
      if (result.error || !result.id) {
        toast.error(result.error ?? "Не удалось создать подразделение");
        return;
      }
      toast.success("Подразделение создано");
      const created: DepartmentSummary = {
        id: result.id,
        name: trimmed,
        icon,
        icon_color: iconColor,
        description: description.trim() || null,
        head_role_id: null,
        head_role_name: null,
        roles_count: 0,
        staff_count: 0,
      };
      setDepartments((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      );
      setSheetOpen(false);
      resetForm();
      router.push(`/people/departments/${result.id}`);
    });
  }

  const count = (n: number, forms: [string, string, string]) =>
    n ? (
      <span className="tabular-nums">
        {n} {pluralRu(n, ...forms)}
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  const columns: ColumnDef<DepartmentSummary>[] = [
    {
      id: "name",
      header: labels.name,
      size: 360,
      minSize: 220,
      enableHiding: false,
      accessorFn: (d) => d.name,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const d = row.original;
        const Icon = (d.icon && ICON_REGISTRY[d.icon]) || Boxes;
        const tint = paletteText(d.icon_color as PaletteColor | null);
        const desc = d.description?.trim();
        return (
          // span, а не div: правило карточки на телефоне растягивает первый
          // ребёнок div-обёртки имени на всю ширину (для бейджей сотрудника).
          <span className="flex min-w-0 items-center gap-3">
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ${tint || "text-muted-foreground"}`}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <Link
                href={`/people/departments/${d.id}`}
                className="block truncate font-medium hover:underline"
                data-tip={d.name}
              >
                {d.name}
              </Link>
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
      id: "head",
      header: labels.head,
      size: 220,
      minSize: 150,
      accessorFn: (d) => d.head_role_name ?? undefined,
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const name = getValue() as string | undefined;
        return name ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Crown className="size-3.5 shrink-0 text-amber-500" aria-hidden />
            <span className="truncate" data-tip={name}>
              {name}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "roles",
      header: labels.roles,
      size: 160,
      minSize: 120,
      accessorFn: (d) => d.roles_count,
      cell: ({ getValue }) =>
        count(getValue() as number, ["должность", "должности", "должностей"]),
    },
    {
      id: "staff",
      header: labels.staff,
      size: 160,
      minSize: 120,
      // Число — по тому же списку, что и карточка по наведению, чтобы они
      // не расходились.
      accessorFn: (d) => staffByDepartment[d.id]?.length ?? 0,
      cell: ({ row }) => (
        <StaffStackCell
          title={row.original.name}
          staff={staffByDepartment[row.original.id] ?? []}
        />
      ),
    },
  ];
  const table = useReactTable({
    data: filteredDepartments,
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
    getRowId: (d) => d.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const changeSorting = (next: typeof st.sorting) => {
    st.setSorting(next);
    firstPage();
  };
  const canCreate = !!accountId && canManage;
  const openCreate = () => {
    resetForm();
    setSheetOpen(true);
  };

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Люди" }, { label: "Подразделения" }]} />
      <TablePageHeader
        title="Подразделения"
        count={isFiltered ? `${filteredDepartments.length} из ${departments.length}` : departments.length}
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
              placeholder: "Название подразделения",
            }}
            filters={{
              active: !!headFilter,
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
              canCreate ? (
                <Button size="sm" className="h-9 gap-2" onClick={openCreate}>
                  <Plus className="size-4" />
                  Добавить подразделение
                </Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка подразделений"
        open={filtersOpen}
        hasFilters={!!headFilter}
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
        {(filtersOpen || !!headFilter) && (
          <TableFilterChip
            label="Руководитель"
            value={headFilter}
            onChange={(v) => {
              setHeadFilter(v);
              firstPage();
            }}
            options={[
              { value: "", label: "Все подразделения" },
              { value: "assigned", label: "Руководитель назначен" },
              { value: "missing", label: "Без руководителя" },
            ]}
          />
        )}
      </TableConditions>

      {departments.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Подразделений пока нет"
          description="Объедините похожие должности в подразделение, например «Бар», и назначьте руководителя"
          action={
            canCreate ? (
              <Button onClick={openCreate}>
                <Plus className="mr-2 size-4" />
                Добавить подразделение
              </Button>
            ) : undefined
          }
        />
      ) : filteredDepartments.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Подразделения не найдены"
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
            label="Подразделения"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            onRowClick={(row) =>
              router.push(`/people/departments/${row.original.id}`)
            }
            empty={null}
            mobile={{ label: "Карточки подразделений", nameColumn: "name" }}
          />
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filteredDepartments.length}
            onPageChange={(pageIndex) =>
              st.setPagination((p) => ({ ...p, pageIndex }))
            }
            onPageSizeChange={(pageSize) =>
              st.setPagination({ pageIndex: 0, pageSize })
            }
          />
        </>
      )}

      {/* Create drawer */}
      <EditDrawer
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) resetForm();
        }}
        title="Новое подразделение"
        description="Должности и руководителя добавите в карточке подразделения после создания"
        footer={
          <>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isPending || !name.trim()}
              data-tip={!name.trim() ? "Укажите название" : undefined}
            >
              {isPending ? "Создаём…" : "Создать подразделение"}
            </Button>
          </>
        }
      >
        <div className="flex items-end gap-2">
          <Field id="new-dep-name" label="Название" required className="flex-1">
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Бар"
                maxLength={120}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            )}
          </Field>
          <DepartmentIconPicker
            value={icon}
            color={iconColor}
            onChange={({ icon: nextIcon, color }) => {
              setIcon(nextIcon);
              setIconColor(color);
            }}
          />
        </div>

        <Field id="new-dep-desc" label="Описание">
          {(control) => (
            <Textarea
              {...control}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Кто входит, чем занимается"
              rows={3}
            />
          )}
        </Field>
      </EditDrawer>
    </PageFrame>
  );
}
