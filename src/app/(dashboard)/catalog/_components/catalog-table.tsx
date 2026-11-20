"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Archive,
  ChevronRight,
  ExternalLink,
  Folder,
  ImagePlus,
  Loader2,
  Package,
  SearchX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Money } from "@/components/shared/money";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TablePageHeader,
  TableRowMenu,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { formatInventoryQuantity } from "@/lib/format/amount";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";

import type { CatalogKindConfig } from "../_lib/kinds";
import {
  countProducts,
  countVisibleProducts,
  flattenCatalog,
  indexCatalog,
  type CatalogGroup,
  type CatalogProduct,
  type CatalogRow,
  type CatalogSortField,
} from "./catalog-tree";
import { useCatalogPhotoUpload } from "./use-catalog-photo-upload";

type ColKey = CatalogSortField | "actions";

const labels: Record<ColKey, string> = {
  name: "Название",
  unit: "Ед. изм.",
  article: "Артикул",
  barcode: "Штрих-код",
  code: "Код Quick Resto",
  quantity: "Остаток",
  cost: "Себестоимость",
  actions: "Действия",
};

// Конфиг столбцов — константы модуля: useTableState сравнивает их по ссылке.
const dataColumns = [
  { id: "name", defaultSize: 400 },
  { id: "unit", defaultSize: 110 },
  { id: "article", defaultSize: 140, defaultVisible: false },
  { id: "barcode", defaultSize: 160, defaultVisible: false },
  { id: "code", defaultSize: 150, defaultVisible: false },
  { id: "quantity", defaultSize: 140 },
  { id: "cost", defaultSize: 150 },
];
const columnsWithMenu = [...dataColumns, { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE }];
const sortFields: CatalogSortField[] = [
  "name",
  "unit",
  "article",
  "barcode",
  "code",
  "quantity",
  "cost",
];
const numericColumns = ["quantity", "cost"];

/** Отступ уровня дерева и место под стрелку раскрытия (кнопка 24 + отступ 12). */
const INDENT = 24;
const CHEVRON_SLOT = 36;

/**
 * Отступ уровня — только в таблице: на телефоне строки становятся
 * карточками, и лестница отступов съела бы и без того узкую ширину.
 */
function treePad(px: number): CSSProperties {
  return { "--tree-pad": `${px}px` } as CSSProperties;
}

function Thumb({ url, type }: { url: string | null; type: "group" | "product" }) {
  const Icon = type === "group" ? Folder : Package;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
      {url ? (
        // Подписанная ссылка хранилища: оптимизатор next/image её не ждёт.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon className="size-4" aria-hidden />
      )}
    </span>
  );
}

type Props = {
  config: CatalogKindConfig;
  groups: CatalogGroup[];
  products: CatalogProduct[];
  canManage: boolean;
  canSync: boolean;
  lastSyncedAt: string | null;
  /** Переключатель «весь каталог / из актов заведения»; null — заведение одно. */
  scope: "venue" | "all" | null;
  /** Почему список «из актов заведения» пуст. */
  scopeNotice: string | null;
};

export function CatalogTable({
  config,
  groups,
  products,
  canManage,
  canSync,
  lastSyncedAt,
  scope,
  scopeNotice,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const photo = useCatalogPhotoUpload();

  const st = useTableState({
    tableId: `catalog.${config.kind}`,
    columns: canManage ? columnsWithMenu : dataColumns,
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [archived, setArchived] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<"" | "with" | "without">("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const index = useMemo(() => indexCatalog(groups, products), [groups, products]);
  const rows = useMemo(
    () =>
      flattenCatalog(index, {
        expanded,
        search: st.search,
        archived,
        photo: photoFilter,
        sorting: st.sorting,
      }),
    [index, expanded, st.search, archived, photoFilter, st.sorting],
  );

  const archivedCount = useMemo(
    () => countProducts(products, { archived: true, photo: "" }),
    [products],
  );
  const total = countProducts(products, { archived, photo: "" });
  const narrowed = st.search.trim().length > 0 || photoFilter !== "";
  const visible = narrowed ? countVisibleProducts(rows) : total;
  const venueScoped = scope === "venue" && !archived;
  const hasFilters = photoFilter !== "" || venueScoped;

  const toggleGroup = (groupId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const setScope = (next: "venue" | "all") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "venue") params.set("scope", "venue");
    else params.delete("scope");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const resetConditions = () => {
    st.setSearch("");
    st.setSorting([]);
    setPhotoFilter("");
    if (scope === "venue") setScope("all");
  };

  const productHref = (product: CatalogProduct) => `${pathname}/${product.id}`;

  const columns: ColumnDef<CatalogRow>[] = [
    {
      id: "name",
      header: labels.name,
      size: 400,
      minSize: 240,
      enableHiding: false,
      cell: ({ row }) => {
        const item = row.original;
        if (item.type === "group") {
          const { group } = item;
          return (
            <span
              className="flex min-w-0 items-center gap-3 sm:pl-[var(--tree-pad)]"
              style={treePad(item.depth * INDENT)}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={item.expanded}
                aria-label={`${item.expanded ? "Свернуть" : "Раскрыть"} категорию «${group.name}»`}
                className="touch-target flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <ChevronRight
                  className={cn("size-4 transition-transform", item.expanded && "rotate-90")}
                />
              </button>
              <Thumb url={group.imageUrl} type="group" />
              <span className="min-w-0">
                <span className="block truncate font-medium" data-tip={group.name}>
                  {group.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {countRu(item.productCount, config.countNoun.one, config.countNoun.few, config.countNoun.many)}
                </span>
              </span>
            </span>
          );
        }
        const { product } = item;
        return (
          <span
            className="flex min-w-0 items-center gap-3 sm:pl-[var(--tree-pad)]"
            // Стрелки у позиции нет, но место под неё (24 + отступ 12) держим:
            // фото позиции стоит на шаг правее фото своей категории.
            style={treePad(item.depth * INDENT + CHEVRON_SLOT)}
          >
            <Thumb url={product.imageUrl} type="product" />
            <Link
              href={productHref(product)}
              className="block min-w-0 truncate hover:underline"
              data-tip={product.name}
            >
              {product.name}
            </Link>
          </span>
        );
      },
    },
    {
      id: "unit",
      header: labels.unit,
      size: 110,
      minSize: 90,
      cell: ({ row }) =>
        row.original.type === "product" ? (
          <span className="block truncate">{row.original.product.measureUnitName ?? "—"}</span>
        ) : null,
    },
    {
      id: "article",
      header: labels.article,
      size: 140,
      minSize: 100,
      cell: ({ row }) =>
        row.original.type === "product" ? (
          <span className="block truncate">{row.original.product.article ?? "—"}</span>
        ) : null,
    },
    {
      id: "barcode",
      header: labels.barcode,
      size: 160,
      minSize: 110,
      cell: ({ row }) =>
        row.original.type === "product" ? (
          <span className="block truncate tabular-nums">{row.original.product.barcode ?? "—"}</span>
        ) : null,
    },
    {
      id: "code",
      header: labels.code,
      size: 150,
      minSize: 140,
      cell: ({ row }) => (
        <span className="block truncate tabular-nums text-muted-foreground">
          {row.original.type === "product"
            ? row.original.product.externalId
            : row.original.group.externalId}
        </span>
      ),
    },
    {
      id: "quantity",
      header: labels.quantity,
      size: 140,
      minSize: 100,
      cell: ({ row }) =>
        row.original.type === "product"
          ? formatInventoryQuantity(
              row.original.product.storeQuantity,
              row.original.product.measureUnitName,
            )
          : null,
    },
    {
      id: "cost",
      header: labels.cost,
      size: 150,
      minSize: 130,
      // Себестоимость грамма бывает в копейках: целые превратили бы её в ноль.
      cell: ({ row }) =>
        row.original.type === "product" ? (
          <Money value={row.original.product.currentPrimeCost} fraction="auto" />
        ) : null,
    },
  ];
  if (canManage) {
    columns.push({
      id: "actions",
      header: "",
      size: ROW_MENU_COLUMN_SIZE,
      minSize: ROW_MENU_COLUMN_SIZE,
      maxSize: ROW_MENU_COLUMN_SIZE,
      enableHiding: false,
      cell: ({ row }) => {
        const item = row.original;
        const targetId = item.type === "group" ? item.group.id : item.product.id;
        if (photo.pendingId === targetId) {
          return (
            <span className="flex size-8 items-center justify-center" aria-label="Загружаем фото">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </span>
          );
        }
        if (item.type === "group") {
          return (
            <TableRowMenu
              actions={[
                {
                  label: item.group.imageUrl ? "Заменить фото категории" : "Загрузить фото категории",
                  icon: <ImagePlus />,
                  onSelect: () => photo.pick({ type: "group", id: item.group.id }),
                },
              ]}
            />
          );
        }
        return (
          <TableRowMenu
            actions={[
              {
                label: "Открыть карточку",
                icon: <ExternalLink />,
                onSelect: () => router.push(productHref(item.product)),
              },
              {
                label: item.product.imageUrl ? "Заменить фото" : "Загрузить фото",
                icon: <ImagePlus />,
                onSelect: () => photo.pick({ type: "product", id: item.product.id }),
              },
            ]}
          />
        );
      },
    });
  }

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting: st.sorting,
      columnVisibility: { ...st.columnVisibility, name: true, actions: true },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    // Порядок строк задаёт дерево (сортировка внутри категории), не TanStack.
    manualSorting: true,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const changeSorting = (next: SortingState) => st.setSorting(next);

  const noun = config.countNoun.many;
  const emptyCatalog = !archived && total === 0;

  let body: ReactNode;
  if (emptyCatalog && venueScoped) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Позиции не найдены"
        description={scopeNotice ?? "В актах этого заведения таких позиций пока нет"}
        action={
          <Button variant="outline" onClick={() => setScope("all")}>
            Показать весь каталог
          </Button>
        }
      />
    );
  } else if (emptyCatalog) {
    body = (
      <EmptyState
        icon={Package}
        title={`${noun.charAt(0).toLocaleUpperCase("ru")}${noun.slice(1)} пока нет`}
        // Кнопка синхронизации уже стоит в шапке: второй синей здесь не нужно.
        description={
          canSync
            ? "Они появятся после синхронизации с Quick Resto"
            : "Они появятся после синхронизации с Quick Resto. Запустить её может администратор"
        }
      />
    );
  } else if (archived && total === 0) {
    body = (
      <EmptyState
        icon={Archive}
        title="Архив пуст"
        description="Сюда попадают позиции, удалённые в Quick Resto. История в актах у них сохраняется"
        action={
          <Button variant="outline" onClick={() => setArchived(false)}>
            К действующим позициям
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Позиции не найдены"
        description="Измените условия поиска или сбросьте фильтры"
        action={
          <Button variant="outline" onClick={resetConditions}>
            Очистить все
          </Button>
        }
      />
    );
  } else {
    body = (
      <DataTable
        table={table}
        label={config.title}
        labels={labels}
        onColumnSizingChange={st.setColumnSizing}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortable={sortFields}
        numeric={numericColumns}
        onRowClick={(row) => {
          const item = row.original;
          if (item.type === "group") toggleGroup(item.group.id);
          else router.push(productHref(item.product));
        }}
        empty={null}
        mobile={{ label: `Карточки: ${config.title.toLocaleLowerCase("ru")}`, nameColumn: "name" }}
      />
    );
  }

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Номенклатура" }, { label: config.title }]} />
      {photo.input}
      <TablePageHeader
        // Заголовок в архиве тот же: режим виден по нажатой кнопке архива, а
        // длинный заголовок сталкивал инструменты на вторую строку шапки.
        title={config.title}
        count={narrowed ? `${visible} из ${total}` : total}
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: st.setSearch,
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: "Название, артикул, штрих-код",
            }}
            filters={{
              active: hasFilters,
              onClick: () => setFiltersOpen((open) => !open),
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
                      const column = table.getColumn(id)!;
                      return {
                        id,
                        label: labels[id as ColKey],
                        visible: column.getIsVisible(),
                        canHide: column.getCanHide(),
                      };
                    })}
                  onVisibilityChange={(id, value) => table.getColumn(id)?.toggleVisibility(value)}
                  onMoveColumn={(from, to) =>
                    st.setColumnOrder((order) =>
                      arrayMove(order, order.indexOf(from), order.indexOf(to)),
                    )
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            secondaryActions={
              <IconTooltip
                label={archived ? "Вернуться к действующим позициям" : `Архив · ${archivedCount}`}
              >
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={
                    archived
                      ? "Показать действующие позиции"
                      : `Показать архив (${archivedCount})`
                  }
                  aria-pressed={archived}
                  onClick={() => setArchived((value) => !value)}
                  className={cn(
                    "touch-target size-8 text-muted-foreground sm:size-9",
                    archived && "border-brand bg-brand/5 text-brand",
                  )}
                >
                  <Archive className="size-4" />
                </Button>
              </IconTooltip>
            }
            primaryActions={
              <InventorySyncButton canSync={canSync} lastSyncedAt={lastSyncedAt} layout="toolbar" />
            }
          />
        }
      />
      <TableConditions
        label={`Условия списка: ${config.title.toLocaleLowerCase("ru")}`}
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => st.setSearch("")}
        onReset={resetConditions}
      >
        {scope !== null && !archived && (filtersOpen || venueScoped) ? (
          <TableFilterChip
            label="Заведение"
            value={venueScoped ? "venue" : ""}
            onChange={(value) => setScope(value === "venue" ? "venue" : "all")}
            options={[
              { value: "", label: "Весь каталог" },
              { value: "venue", label: "Из актов заведения" },
            ]}
          />
        ) : null}
        {filtersOpen || photoFilter ? (
          <TableFilterChip
            label="Фото"
            value={photoFilter}
            onChange={(value) => setPhotoFilter(value as "" | "with" | "without")}
            options={[
              { value: "", label: "Все позиции" },
              { value: "with", label: "С фото" },
              { value: "without", label: "Без фото" },
            ]}
          />
        ) : null}
      </TableConditions>
      {body}
    </PageFrame>
  );
}
