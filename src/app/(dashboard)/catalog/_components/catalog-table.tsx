"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Money } from "@/components/shared/money";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
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
  type CatalogGroupStock,
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

/**
 * Фото в строке 36px; при наведении (или фокусе, или нажатии на телефоне) —
 * крупно, как у кандидатов (`PersonAvatar`). Без фото — значок вида.
 */
function Thumb({
  url,
  previewUrl,
  type,
  name,
}: {
  url: string | null;
  previewUrl: string | null;
  type: "group" | "product";
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const Icon = type === "group" ? Folder : Package;
  const tile =
    "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground";
  if (!url || failed) {
    return (
      <span className={tile}>
        <Icon className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Увеличить фото: ${name}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className={cn(tile, "outline-none focus-visible:ring-2 focus-visible:ring-brand/30")}
        >
          {/* Пока фото грузится, под ним виден значок — ячейка не пустая. */}
          <Icon className="size-4" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        collisionPadding={16}
        className="w-80 max-w-[calc(100vw-32px)] p-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl ?? url}
          alt={`Фото: ${name}`}
          width={300}
          height={300}
          className="max-h-[60dvh] w-full rounded-md object-contain"
        />
      </HoverCardContent>
    </HoverCard>
  );
}

type SavedView = {
  expanded: string[];
  archived: boolean;
  photo: "" | "with" | "without";
  search: string;
  sorting: SortingState;
  scrollY: number;
};

function readSavedView(key: string): SavedView | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedView>;
    return {
      expanded: Array.isArray(v.expanded) ? v.expanded.filter((id) => typeof id === "string") : [],
      archived: v.archived === true,
      photo: v.photo === "with" || v.photo === "without" ? v.photo : "",
      search: typeof v.search === "string" ? v.search : "",
      sorting: Array.isArray(v.sorting)
        ? v.sorting.filter(
            (s): s is { id: string; desc: boolean } =>
              Boolean(s) && typeof s.id === "string" && typeof s.desc === "boolean",
          )
        : [],
      scrollY: typeof v.scrollY === "number" && v.scrollY > 0 ? v.scrollY : 0,
    };
  } catch {
    return null;
  }
}

function writeSavedView(key: string, view: SavedView) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(view));
  } catch {
    // Приватный режим или запрет хранилища — список просто откроется свёрнутым.
  }
}

/**
 * Возврат из карточки позиции — на то же место: раскрытые категории, поиск,
 * фильтры, сортировка и прокрутка хранятся во вкладке браузера
 * (sessionStorage) и восстанавливаются при следующем открытии раздела. В
 * новой вкладке или после закрытия браузера список открывается с начала.
 */
function useRestoredView({
  key,
  expanded,
  archived,
  photoFilter,
  search,
  sorting,
  restore,
}: {
  key: string;
  expanded: Set<string>;
  archived: boolean;
  photoFilter: "" | "with" | "without";
  search: string;
  sorting: SortingState;
  restore: (view: SavedView) => void;
}) {
  const [restored, setRestored] = useState(false);
  const pendingScroll = useRef(0);
  const scrollY = useRef(0);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  // Восстановление — после гидратации: на сервере хранилища нет, и первая
  // отрисовка должна совпасть с серверной.
  useEffect(() => {
    const saved = readSavedView(key);
    if (saved) {
      restoreRef.current(saved);
      pendingScroll.current = saved.scrollY;
      scrollY.current = saved.scrollY;
    }
    setRestored(true);
  }, [key]);

  // Прокрутка — когда строки восстановленного дерева уже отрисованы.
  useEffect(() => {
    if (!restored || pendingScroll.current <= 0) return;
    const y = pendingScroll.current;
    pendingScroll.current = 0;
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }, [restored]);

  const snapshot = (): SavedView => ({
    expanded: Array.from(expanded),
    archived,
    photo: photoFilter,
    search,
    sorting,
    scrollY: scrollY.current,
  });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // До восстановления не пишем: иначе пустое начальное состояние затёрло бы
  // сохранённое.
  useEffect(() => {
    if (restored) writeSavedView(key, snapshotRef.current());
  }, [key, restored, expanded, archived, photoFilter, search, sorting]);

  useEffect(() => {
    if (!restored) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scrollY.current = window.scrollY;
        writeSavedView(key, snapshotRef.current());
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [key, restored]);
}

const positions = (count: number) => countRu(count, "позиция", "позиции", "позиций");

/**
 * Остаток категории: сумма, если у позиций с остатком одна единица, иначе —
 * сколько позиций с остатком (килограммы со штуками не складываются).
 */
function GroupQuantity({ stock }: { stock: CatalogGroupStock }) {
  // Остатков в ветке нет (у блюд их не бывает) — ячейка пустая, как раньше:
  // итожить нечего, а прочерки на карточках телефона были бы шумом.
  if (stock.withStock === 0) return null;
  if (stock.quantity !== null) {
    return (
      <span
        className="whitespace-nowrap font-medium tabular-nums"
        data-tip="Сумма остатков категории"
        data-tip-sub={`Позиций с остатком: ${stock.withStock}. Отрицательные остатки не учитываются`}
      >
        {formatInventoryQuantity(stock.quantity, stock.unit)}
      </span>
    );
  }
  return (
    <span
      className="whitespace-nowrap text-muted-foreground"
      data-tip={`Позиций с остатком: ${stock.withStock}`}
      data-tip-sub="Единицы измерения разные, поэтому количество не складывается"
    >
      {positions(stock.withStock)}
    </span>
  );
}

/** Стоимость остатков категории: остаток × себестоимость по позициям ветки. */
function GroupValue({ stock }: { stock: CatalogGroupStock }) {
  if (stock.withStock === 0) return null;
  if (stock.value === null) {
    return (
      <span className="text-muted-foreground" data-tip="У позиций с остатком нет себестоимости">
        —
      </span>
    );
  }
  const priced = stock.withStock - stock.unpriced;
  return (
    <span
      className="font-medium"
      data-tip="Стоимость остатков: остаток × себестоимость"
      data-tip-sub={
        stock.unpriced > 0
          ? `Позиций в сумме: ${priced}. Без себестоимости, не вошли: ${stock.unpriced}`
          : `Позиций в сумме: ${priced}. Отрицательные остатки не учитываются`
      }
    >
      <Money value={stock.value} />
      {/* На телефоне подсказки нет, а подпись поля там — «Себестоимость». */}
      <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground sm:hidden">в остатках</span>
      {/* Неполную сумму помечаем прямо в тексте: без подсказки она выглядела бы полной. */}
      {stock.unpriced > 0 ? (
        <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground">
          (без {countRu(stock.unpriced, "позиции", "позиций", "позиций")})
        </span>
      ) : null}
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
  /** Предупреждения или ошибка последней сверки с Quick Resto; null — всё прошло. */
  syncNotice: { at: string; messages: string[]; failed: boolean } | null;
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
  syncNotice,
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
  useRestoredView({
    key: `sheerly.catalog.view.${config.kind}`,
    expanded,
    archived,
    photoFilter,
    search: st.search,
    sorting: st.sorting,
    restore: (view) => {
      setExpanded(new Set(view.expanded));
      setArchived(view.archived);
      setPhotoFilter(view.photo);
      if (view.search) {
        st.setSearch(view.search);
        st.setSearchOpen(true);
      }
      st.setSorting(view.sorting);
    },
  });

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
                  className={cn("motion-chevron size-4", item.expanded && "rotate-90")}
                />
              </button>
              <Thumb url={group.imageUrl} previewUrl={group.previewUrl} type="group" name={group.name} />
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
            <Thumb
              url={product.imageUrl}
              previewUrl={product.previewUrl}
              type="product"
              name={product.name}
            />
            <Link
              href={productHref(product)}
              className="block min-w-0 truncate transition-colors duration-200 hover:text-brand"
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
        row.original.type === "product" ? (
          formatInventoryQuantity(
            row.original.product.storeQuantity,
            row.original.product.measureUnitName,
          )
        ) : (
          <GroupQuantity stock={row.original.stock} />
        ),
    },
    {
      id: "cost",
      header: labels.cost,
      size: 150,
      minSize: 130,
      // Себестоимость грамма бывает в копейках: целые превратили бы её в ноль.
      // У категории — стоимость остатков ветки: себестоимость единицы у
      // папки смысла не имеет, а «сколько денег лежит в овощах» — имеет.
      cell: ({ row }) =>
        row.original.type === "product" ? (
          <Money value={row.original.product.currentPrimeCost} fraction="auto" />
        ) : (
          <GroupValue stock={row.original.stock} />
        ),
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
              <TableIconButton
                label={archived ? "Вернуться к действующим позициям" : `Архив · ${archivedCount}`}
                active={archived}
                pressed={archived}
                onClick={() => setArchived((value) => !value)}
              >
                <Archive />
              </TableIconButton>
            }
            primaryActions={
              <InventorySyncButton canSync={canSync} lastSyncedAt={lastSyncedAt} layout="toolbar" />
            }
          />
        }
      />
      {syncNotice ? (
        // Сверка идёт и по расписанию, без человека у кнопки, — поэтому её
        // предупреждения висят здесь, пока следующий запуск не пройдёт чисто.
        // Сбой целиком — с повтором прямо здесь: искать кнопку в шапке не нужно.
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Сверка с Quick Resto, <LocalDateTime value={syncNotice.at} variant="dayTime" />
            </p>
            {syncNotice.messages.map((issue) => (
              <p key={issue} className="text-muted-foreground">
                {issue}
              </p>
            ))}
          </div>
          {syncNotice.failed ? (
            <InventorySyncButton canSync={canSync} lastSyncedAt={lastSyncedAt} layout="retry" />
          ) : null}
        </div>
      ) : null}
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
