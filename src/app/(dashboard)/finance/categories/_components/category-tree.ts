/**
 * Дерево «группа → статьи» для таблицы статей — плоский список строк.
 * Чистые функции без React: раскрытие, поиск, фильтры и сортировка внутри
 * группы проверяются тестами (`category-tree.test.mts`).
 *
 * Правила те же, что у дерева номенклатуры (docs/design-system.md § «Дерево
 * в таблице»): строки не перемешиваются между группами, группы стоят перед
 * статьями без группы, пустые значения при сортировке — в конце. Пока есть
 * поиск, фильтр или открыт архив, дерево раскрыто целиком и показывает
 * только группы с совпадениями; группа, совпавшая по названию, — со всеми
 * статьями. Пустые группы в таблице не показываются (их видно в «Группах»).
 */

export type CategoryType = "income" | "expense";

export type TreeGroup = {
  id: string;
  name: string;
  /** Для каких статей группа: income / expense / mixed или без ограничения. */
  type: string | null;
  isPayroll: boolean;
};

export type TreeCategory = {
  id: string;
  name: string;
  type: CategoryType;
  groupId: string | null;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  /** Статья ФОТ должности: название и группу ведёт должность. */
  isPayroll: boolean;
  archived: boolean;
  archivedAt: string | null;
  /** Почему статью нельзя отправить в архив (системная, ФОТ работающей должности). */
  archiveBlocked: string | null;
  /** Активность: `null` — данных нет (нет права или миграции). */
  operations: number | null;
  lastDate: string | null;
  total: number | null;
};

export type CategoryTreeRow =
  | {
      type: "group";
      id: string;
      group: TreeGroup;
      /** Статей в группе с учётом архива, поиска и фильтров. */
      count: number;
      /** Эти статьи — для итогов группы по операциям. */
      items: TreeCategory[];
      expanded: boolean;
    }
  | { type: "category"; id: string; category: TreeCategory; depth: 0 | 1 };

export type CategorySort = { id: string; desc: boolean }[];

export type CategoryView = {
  /** Группы, свёрнутые вручную. По умолчанию группы раскрыты. */
  collapsed: ReadonlySet<string>;
  search: string;
  archived: boolean;
  /** "" — все типы. */
  type: "" | CategoryType;
  /** "" — все, "none" — без группы, иначе id группы. */
  group: string;
  sorting: CategorySort;
};

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

const TYPE_ORDER: Record<CategoryType, number> = { income: 0, expense: 1 };

function includes(value: string | null | undefined, search: string) {
  return Boolean(value && value.toLocaleLowerCase("ru").includes(search));
}

function value(category: TreeCategory, field: string): string | number | null {
  switch (field) {
    case "name":
      return category.name;
    case "type":
      return TYPE_ORDER[category.type];
    case "operations":
      return category.operations;
    case "lastDate":
      return category.lastDate ? new Date(category.lastDate).getTime() : null;
    case "total":
      return category.total;
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
    typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return desc ? -result : result;
}

/** Без выбранной сортировки: сначала доходы, потом расходы, внутри — по названию. */
export function compareCategories(sorting: CategorySort) {
  return (a: TreeCategory, b: TreeCategory) => {
    for (const { id, desc } of sorting) {
      const result = compareValues(value(a, id), value(b, id), desc);
      if (result !== 0) return result;
    }
    return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || collator.compare(a.name, b.name);
  };
}

/** Статья проходит архив и фильтры (поиск — отдельно, у него свои правила). */
function passesFilters(category: TreeCategory, view: CategoryView, groupIds: ReadonlySet<string>) {
  if (category.archived !== view.archived) return false;
  if (view.type && category.type !== view.type) return false;
  const groupId = category.groupId && groupIds.has(category.groupId) ? category.groupId : null;
  if (view.group === "none" && groupId) return false;
  if (view.group && view.group !== "none" && groupId !== view.group) return false;
  return true;
}

function matches(category: TreeCategory, search: string) {
  return includes(category.name, search) || includes(category.description, search);
}

export function isNarrowed(view: Pick<CategoryView, "search" | "archived" | "type" | "group">) {
  return Boolean(view.search.trim()) || view.archived || view.type !== "" || view.group !== "";
}

/** Видимые строки дерева. */
export function flattenCategories(
  groups: TreeGroup[],
  categories: TreeCategory[],
  view: CategoryView,
): CategoryTreeRow[] {
  const search = view.search.trim().toLocaleLowerCase("ru");
  const narrowing = isNarrowed(view);
  const groupIds = new Set(groups.map((group) => group.id));
  const byCategory = compareCategories(view.sorting);
  const groupsDesc = view.sorting.find((s) => s.id === "name")?.desc ?? false;

  const visible = categories.filter((category) => passesFilters(category, view, groupIds));
  const inGroup = new Map<string | null, TreeCategory[]>();
  for (const category of visible) {
    const key = category.groupId && groupIds.has(category.groupId) ? category.groupId : null;
    const list = inGroup.get(key) ?? [];
    list.push(category);
    inGroup.set(key, list);
  }

  const rows: CategoryTreeRow[] = [];
  const sortedGroups = [...groups].sort((a, b) => collator.compare(a.name, b.name));
  if (groupsDesc) sortedGroups.reverse();
  for (const group of sortedGroups) {
    const groupMatched = Boolean(search) && includes(group.name, search);
    const items = (inGroup.get(group.id) ?? []).filter(
      (category) => !search || groupMatched || matches(category, search),
    );
    if (items.length === 0) continue;
    const expanded = narrowing || !view.collapsed.has(group.id);
    rows.push({ type: "group", id: `group:${group.id}`, group, count: items.length, items, expanded });
    if (!expanded) continue;
    for (const category of items.sort(byCategory)) {
      rows.push({ type: "category", id: category.id, category, depth: 1 });
    }
  }
  const loose = (inGroup.get(null) ?? []).filter((category) => !search || matches(category, search));
  for (const category of loose.sort(byCategory)) {
    rows.push({ type: "category", id: category.id, category, depth: 0 });
  }
  return rows;
}

/** Сколько статей в режиме (живые или архив) — для счётчика у заголовка. */
export function countCategories(categories: TreeCategory[], archived: boolean) {
  return categories.filter((category) => category.archived === archived).length;
}

/** Сколько статей видно — с учётом поиска и фильтров (для «N из M»). */
export function countVisibleCategories(
  groups: TreeGroup[],
  categories: TreeCategory[],
  view: CategoryView,
) {
  // Свёрнутые группы тоже считаются: свернуть — не значит отфильтровать.
  return flattenCategories(groups, categories, { ...view, collapsed: new Set() }).filter(
    (row) => row.type === "category",
  ).length;
}
