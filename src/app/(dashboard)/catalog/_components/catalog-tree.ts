/**
 * Дерево раздела номенклатуры «категория → позиции» в виде плоского списка
 * строк для таблицы. Чистые функции без React: раскрытие, поиск, фильтры и
 * сортировка внутри группы проверяются тестами (`catalog-tree.test.mts`).
 *
 * Сортировка у дерева своя: строки не перемешиваются между категориями,
 * порядок задаётся среди соседей одного уровня. Категории стоят перед
 * позициями своего уровня и идут по названию.
 */

export type CatalogGroup = {
  id: string;
  externalId: string;
  name: string;
  parentGroupId: string | null;
  /** Уменьшенная копия фото для строки. */
  imageUrl: string | null;
  /** Крупная копия для просмотра при наведении. */
  previewUrl: string | null;
};

export type CatalogProduct = {
  id: string;
  externalId: string;
  name: string;
  article: string | null;
  barcode: string | null;
  measureUnitName: string | null;
  currentPrimeCost: number | null;
  storeQuantity: number | null;
  groupId: string | null;
  /** Уменьшенная копия фото для строки. */
  imageUrl: string | null;
  /** Крупная копия для просмотра при наведении. */
  previewUrl: string | null;
  /** Удалена в Quick Resto: видна только в архиве. */
  archived: boolean;
};

export type CatalogRow =
  | {
      type: "group";
      id: string;
      group: CatalogGroup;
      depth: number;
      /** Позиции в группе и во вложенных — с учётом архива и фильтров. */
      productCount: number;
      expanded: boolean;
    }
  | { type: "product"; id: string; product: CatalogProduct; depth: number };

export type CatalogSortField =
  | "name"
  | "unit"
  | "article"
  | "barcode"
  | "code"
  | "quantity"
  | "cost";

export type CatalogSort = { id: string; desc: boolean }[];

export type CatalogView = {
  /** Раскрытые вручную категории. */
  expanded: ReadonlySet<string>;
  search: string;
  archived: boolean;
  photo: "" | "with" | "without";
  sorting: CatalogSort;
};

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

function includes(value: string | null | undefined, search: string) {
  return Boolean(value && value.toLocaleLowerCase("ru").includes(search));
}

function productValue(product: CatalogProduct, field: string): string | number | null {
  switch (field) {
    case "name":
      return product.name;
    case "unit":
      return product.measureUnitName;
    case "article":
      return product.article;
    case "barcode":
      return product.barcode;
    case "code":
      return product.externalId;
    case "quantity":
      return product.storeQuantity;
    case "cost":
      return product.currentPrimeCost;
    default:
      return null;
  }
}

/** Пустые значения всегда в конце, в какую сторону ни сортируй. */
function compareValues(a: string | number | null, b: string | number | null, desc: boolean) {
  const aEmpty = a === null || a === "";
  const bEmpty = b === null || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const result =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collator.compare(String(a), String(b));
  return desc ? -result : result;
}

export function compareProducts(sorting: CatalogSort) {
  return (a: CatalogProduct, b: CatalogProduct) => {
    for (const { id, desc } of sorting) {
      const result = compareValues(productValue(a, id), productValue(b, id), desc);
      if (result !== 0) return result;
    }
    return collator.compare(a.name, b.name);
  };
}

export type CatalogIndex = {
  groupsByParent: Map<string | null, CatalogGroup[]>;
  productsByGroup: Map<string | null, CatalogProduct[]>;
};

/** Дети по родителю. Ссылка на несуществующую категорию — значит, корень. */
export function indexCatalog(groups: CatalogGroup[], products: CatalogProduct[]): CatalogIndex {
  const groupIds = new Set(groups.map((group) => group.id));
  const groupsByParent = new Map<string | null, CatalogGroup[]>();
  for (const group of groups) {
    const parent =
      group.parentGroupId && groupIds.has(group.parentGroupId) && group.parentGroupId !== group.id
        ? group.parentGroupId
        : null;
    const list = groupsByParent.get(parent) ?? [];
    list.push(group);
    groupsByParent.set(parent, list);
  }
  for (const list of groupsByParent.values()) list.sort((a, b) => collator.compare(a.name, b.name));

  const productsByGroup = new Map<string | null, CatalogProduct[]>();
  for (const product of products) {
    const groupId = product.groupId && groupIds.has(product.groupId) ? product.groupId : null;
    const list = productsByGroup.get(groupId) ?? [];
    list.push(product);
    productsByGroup.set(groupId, list);
  }
  return { groupsByParent, productsByGroup };
}

/** Позиция проходит архив и фильтр по фото (поиск — отдельно, у него свои правила). */
function passesFilters(product: CatalogProduct, view: CatalogView) {
  if (product.archived !== view.archived) return false;
  if (view.photo === "with" && !product.imageUrl) return false;
  if (view.photo === "without" && product.imageUrl) return false;
  return true;
}

function matchesProduct(product: CatalogProduct, search: string) {
  return (
    includes(product.name, search) ||
    includes(product.article, search) ||
    includes(product.barcode, search) ||
    includes(product.externalId, search)
  );
}

/**
 * Видимые строки дерева. Пока есть поиск, фильтр или открыт архив, дерево
 * раскрыто целиком и показывает только ветки с совпадениями: искать
 * совпадение по закрытым категориям вручную никто не будет. Категория,
 * совпавшая по названию, показывается со всем содержимым.
 */
export function flattenCatalog(index: CatalogIndex, view: CatalogView): CatalogRow[] {
  const search = view.search.trim().toLocaleLowerCase("ru");
  const narrowing = Boolean(search) || view.archived || view.photo !== "";
  const sortGroupsDesc = view.sorting.find((s) => s.id === "name")?.desc ?? false;
  const byProduct = compareProducts(view.sorting);

  // Сколько позиций проходит условия в ветке (с учётом совпадения названия
  // категории-предка) — считаем один раз на ветку.
  const countMemo = new Map<string, number>();
  const visibleProducts = (groupId: string | null, ancestorMatched: boolean) =>
    (index.productsByGroup.get(groupId) ?? []).filter(
      (product) =>
        passesFilters(product, view) &&
        (!search || ancestorMatched || matchesProduct(product, search)),
    );
  const countBranch = (group: CatalogGroup, ancestorMatched: boolean): number => {
    const matched = ancestorMatched || (Boolean(search) && includes(group.name, search));
    const key = `${group.id}:${matched ? 1 : 0}`;
    const cached = countMemo.get(key);
    if (cached !== undefined) return cached;
    let count = visibleProducts(group.id, matched).length;
    for (const child of index.groupsByParent.get(group.id) ?? []) count += countBranch(child, matched);
    countMemo.set(key, count);
    return count;
  };

  const rows: CatalogRow[] = [];
  const walk = (parentId: string | null, depth: number, ancestorMatched: boolean) => {
    const groups = [...(index.groupsByParent.get(parentId) ?? [])];
    if (sortGroupsDesc) groups.reverse();
    for (const group of groups) {
      const productCount = countBranch(group, ancestorMatched);
      // Пустые категории не показываем: в них нечего открыть и нечего искать.
      if (productCount === 0) continue;
      const matched = ancestorMatched || (Boolean(search) && includes(group.name, search));
      const expanded = narrowing || view.expanded.has(group.id);
      rows.push({ type: "group", id: `group:${group.id}`, group, depth, productCount, expanded });
      if (!expanded) continue;
      walk(group.id, depth + 1, matched);
      for (const product of visibleProducts(group.id, matched).sort(byProduct)) {
        rows.push({ type: "product", id: product.id, product, depth: depth + 1 });
      }
    }
  };
  walk(null, 0, false);
  for (const product of visibleProducts(null, false).sort(byProduct)) {
    rows.push({ type: "product", id: product.id, product, depth: 0 });
  }
  return rows;
}

/** Сколько позиций в разделе проходит архив и фильтры — для счётчика у заголовка. */
export function countProducts(products: CatalogProduct[], view: Pick<CatalogView, "archived" | "photo">) {
  return products.filter((product) =>
    passesFilters(product, { ...view, expanded: new Set(), search: "", sorting: [] }),
  ).length;
}

/** Сколько позиций видно в списке — с учётом поиска (для «N из M»). */
export function countVisibleProducts(rows: CatalogRow[]) {
  let count = 0;
  for (const row of rows) if (row.type === "product") count += 1;
  return count;
}
