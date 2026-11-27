// Создание акта инвентаризации из Sheerly: что положить в новый акт.
//
// Quick Resto создаёт акт пустым. В его интерфейсе позиции добавляют кнопкой
// «Добавить группы» — по группам номенклатуры. Повторить эту кнопку через API
// не удалось: `items/action AddGroups` отвечает 400 «UnknownWebClientBehaviour»
// (проверено на проде 27.11.2026). Поэтому состав групп берём из нашего
// каталога (он сверяется с Quick Resto раз в три часа и кнопкой
// «Синхронизировать»), а позиции кладём по одной — тем же `items/create`, что и
// при выносе на пересчёт.
//
// Pure-модуль без импортов из `@/...`: его читает node:test напрямую, а
// используют и серверное действие, и боковая панель.

export type CreateActNomenclatureKind = "ingredient" | "dish" | "semi_finished" | "modifier" | "product";

export type CreateActGroup = {
  id: string;
  parentId: string | null;
  name: string;
  kind: CreateActNomenclatureKind;
};

export type CreateActProduct = {
  id: string;
  groupId: string | null;
  kind: CreateActNomenclatureKind;
  externalId: string | null;
  name: string;
  rawPayload: unknown;
};

/** Виды, которые в акте инвентаризации не считают: модификаторы — не остатки. */
export const CREATE_ACT_KINDS: readonly CreateActNomenclatureKind[] = [
  "ingredient",
  "semi_finished",
  "dish",
];

export const CREATE_ACT_KIND_LABELS: Record<CreateActNomenclatureKind, string> = {
  ingredient: "Ингредиенты",
  semi_finished: "Полуфабрикаты",
  dish: "Блюда",
  modifier: "Модификаторы",
  product: "Товары",
};

/** Предел позиций в одном акте: дальше запрос к Quick Resto идёт слишком долго. */
export const CREATE_ACT_MAX_ITEMS = 600;

export const CREATE_ACT_COMMENT_MAX = 200;

const INVENTORY_ITEM_CLASS = "ru.edgex.quickresto.modules.warehouse.inventory.items.InventoryItem";
const MEASURE_UNIT_CLASS = "ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit";

/** Выбранные группы вместе со всеми подгруппами: в Quick Resto группа включает вложенные. */
export function collectGroupSubtree(
  groups: readonly CreateActGroup[],
  selectedIds: readonly string[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parentId) continue;
    const bucket = children.get(group.parentId) ?? [];
    bucket.push(group.id);
    children.set(group.parentId, bucket);
  }
  const known = new Set(groups.map((group) => group.id));
  const result = new Set<string>();
  const stack = selectedIds.filter((id) => known.has(id));
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (result.has(id)) continue; // цикл в данных не должен зациклить обход
    result.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return result;
}

/** Ключ позиции в Quick Resto: id уникален только внутри класса. */
export function quickRestoProductKey(className: string | null | undefined, id: unknown): string | null {
  if (typeof id !== "number" && typeof id !== "string") return null;
  const raw = String(id).trim();
  if (!raw) return null;
  const suffix = (className ?? "").split(".").pop() ?? "";
  return `${suffix}#${raw}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export type InventoryItemSample = {
  className: string;
  product: { id: number; className: string; title: string };
  measureUnit: { id: number; className: string };
};

/**
 * Тело `items/create` для позиции каталога: класс строки акта, ссылка на товар
 * и его единица измерения. Остаток, себестоимость и разницу Quick Resto
 * посчитает сам на дату акта. Формат проверен на проде 27.11.2026
 * (ингредиент и блюдо, ответ 200).
 *
 * null — в каталоге не хватает данных Quick Resto (нет id, класса или единицы).
 */
export function buildInventoryItemSample(product: CreateActProduct): InventoryItemSample | null {
  const raw = asRecord(product.rawPayload);
  if (!raw) return null;
  const id = Number(raw.id ?? product.externalId);
  const className = typeof raw.className === "string" ? raw.className : null;
  const unit = asRecord(raw.measureUnit);
  const unitId = Number(unit?.id);
  if (!Number.isInteger(id) || id <= 0 || !className || !Number.isInteger(unitId)) return null;
  const title =
    (typeof raw.itemTitle === "string" && raw.itemTitle.trim()) ||
    (typeof raw.name === "string" && raw.name.trim()) ||
    product.name;
  return {
    className: INVENTORY_ITEM_CLASS,
    product: { id, className, title },
    measureUnit: {
      id: unitId,
      className: typeof unit?.className === "string" ? unit.className : MEASURE_UNIT_CLASS,
    },
  };
}

export type ActItemPlan = {
  key: string;
  productId: string;
  name: string;
  sample: InventoryItemSample;
};

/**
 * Позиции нового акта: живые товары выбранных групп и их подгрупп, без
 * повторов, по алфавиту. `skipped` — позиции без данных Quick Resto: их не
 * положить в акт, и об этом нужно сказать, а не потерять молча.
 */
export function planActItems(input: {
  groups: readonly CreateActGroup[];
  products: readonly CreateActProduct[];
  selectedGroupIds: readonly string[];
}): { items: ActItemPlan[]; skipped: string[] } {
  const groupIds = collectGroupSubtree(input.groups, input.selectedGroupIds);
  const groupKind = new Map(input.groups.map((group) => [group.id, group.kind]));
  const byKey = new Map<string, ActItemPlan>();
  const skipped: string[] = [];
  for (const product of input.products) {
    if (!product.groupId || !groupIds.has(product.groupId)) continue;
    // Группа и позиция одного вида: в общей таблице групп лежат и категории
    // блюд, и группы ингредиентов.
    if (groupKind.get(product.groupId) !== product.kind) continue;
    const sample = buildInventoryItemSample(product);
    const key = sample ? quickRestoProductKey(sample.product.className, sample.product.id) : null;
    if (!sample || !key) {
      skipped.push(product.name);
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, { key, productId: product.id, name: product.name, sample });
  }
  const items = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { items, skipped: skipped.sort((a, b) => a.localeCompare(b, "ru")) };
}

/** Что ещё нужно добавить: повтор после сбоя не кладёт позицию второй раз. */
export function pendingActItems(items: readonly ActItemPlan[], existingKeys: ReadonlySet<string>): ActItemPlan[] {
  return items.filter((item) => !existingKeys.has(item.key));
}

/** Комментарий акта по умолчанию — названия выбранных групп, как разделы у CHILLING. */
export function defaultActComment(groupNames: readonly string[]): string {
  const text = groupNames.map((name) => name.trim()).filter(Boolean).join(" / ");
  return text.length > CREATE_ACT_COMMENT_MAX ? `${text.slice(0, CREATE_ACT_COMMENT_MAX - 1)}…` : text;
}

export type CreateActInput = {
  attemptId: string;
  storeId: string;
  /** YYYY-MM-DD */
  date: string;
  groupIds: string[];
  comment: string;
  assignedTo: string | null;
  reviewerId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Проверка формы до похода в базу и Quick Resto. null — всё в порядке. */
export function validateCreateActInput(input: CreateActInput): string | null {
  if (!isUuid(input.attemptId)) return "Обновите страницу и попробуйте ещё раз.";
  if (!isUuid(input.storeId)) return "Выберите склад.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T09:00:00.000Z`))) {
    return "Укажите дату акта.";
  }
  if (input.groupIds.length === 0) return "Выберите хотя бы одну группу.";
  if (input.groupIds.some((id) => !isUuid(id))) return "Обновите страницу и выберите группы заново.";
  if (input.comment.trim().length > CREATE_ACT_COMMENT_MAX) {
    return `Комментарий длиннее ${CREATE_ACT_COMMENT_MAX} символов.`;
  }
  if (input.assignedTo !== null && !isUuid(input.assignedTo)) return "Выберите исполнителя из списка.";
  if (input.reviewerId !== null && !isUuid(input.reviewerId)) return "Выберите проверяющего из списка.";
  if (input.assignedTo && input.assignedTo === input.reviewerId) {
    return "Исполнитель и проверяющий должны быть разными людьми";
  }
  return null;
}

/** Время акта для Quick Resto: 09:00 UTC — безопасная точка внутри суток заведения. */
export function actInvoiceDateMs(date: string): number {
  return Date.parse(`${date}T09:00:00.000Z`);
}

export type CreateActGroupNode = CreateActGroup & {
  depth: number;
  /** Позиций в группе вместе с подгруппами. */
  itemCount: number;
};

/**
 * Дерево групп для панели: плоский список в порядке обхода (родитель, затем
 * дети по алфавиту), с глубиной и числом позиций. Пустые ветки не показываем —
 * акт по ним вышел бы пустым.
 */
export function buildGroupTree(input: {
  groups: readonly CreateActGroup[];
  productCountByGroup: ReadonlyMap<string, number>;
}): CreateActGroupNode[] {
  const byId = new Map(input.groups.map((group) => [group.id, group]));
  const children = new Map<string | null, CreateActGroup[]>();
  for (const group of input.groups) {
    const parent = group.parentId && byId.has(group.parentId) ? group.parentId : null;
    const bucket = children.get(parent) ?? [];
    bucket.push(group);
    children.set(parent, bucket);
  }
  for (const bucket of children.values()) bucket.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const totals = new Map<string, number>();
  const visiting = new Set<string>();
  const total = (id: string): number => {
    const cached = totals.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let sum = input.productCountByGroup.get(id) ?? 0;
    for (const child of children.get(id) ?? []) sum += total(child.id);
    visiting.delete(id);
    totals.set(id, sum);
    return sum;
  };

  const out: CreateActGroupNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const group of children.get(parent) ?? []) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      const itemCount = total(group.id);
      if (itemCount === 0) continue;
      out.push({ ...group, depth, itemCount });
      walk(group.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Сколько позиций попадёт в акт при выбранных группах (без повторов: выбрать
 * и родителя, и его подгруппу — не удвоение).
 */
export function countSelectedItems(input: {
  groups: readonly CreateActGroup[];
  productCountByGroup: ReadonlyMap<string, number>;
  selectedGroupIds: readonly string[];
}): number {
  let sum = 0;
  for (const id of collectGroupSubtree(input.groups, input.selectedGroupIds)) {
    sum += input.productCountByGroup.get(id) ?? 0;
  }
  return sum;
}
