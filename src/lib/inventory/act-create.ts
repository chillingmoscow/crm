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

import { isCalendarDay, isClockTime } from "./act-date.ts";

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

/**
 * Паузы после отказа Quick Resto по частоте запросов (429), по порядку. Темп
 * самих запросов задаёт очередь клиента; это запас на случай, когда лимит
 * съел кто-то ещё (синхронизация, второй пользователь).
 */
export const CREATE_ACT_RATE_LIMIT_PAUSES_MS: readonly number[] = [5_000, 10_000, 20_000, 30_000];

/**
 * Положить позиции в акт по одной. После 429 — пауза и сверка с тем, что
 * реально лежит в акте: создание позиции не повторяем вслепую, чтобы не
 * положить её дважды. Другая ошибка (или кончились паузы) — стоп, `failure`.
 */
export async function addActItems(input: {
  items: readonly ActItemPlan[];
  existingKeys: ReadonlySet<string>;
  add: (item: ActItemPlan) => Promise<void>;
  readKeys: () => Promise<Set<string>>;
  isRateLimit: (error: unknown) => boolean;
  sleep: (ms: number) => Promise<void>;
  pausesMs?: readonly number[];
  /** Сколько позиций плана уже в акте — для хода создания. */
  onProgress?: (inAct: number) => void | Promise<void>;
  /** Пора отпустить задание (кончилось время тика) — остановиться без ошибки. */
  shouldStop?: () => boolean;
}): Promise<{ present: Set<string>; added: number; failure: unknown; inAct: number; stopped: boolean }> {
  const pauses = input.pausesMs ?? CREATE_ACT_RATE_LIMIT_PAUSES_MS;
  let present = new Set(input.existingKeys);
  let queue = pendingActItems(input.items, present);
  let added = 0;
  let failure: unknown = null;
  let pause = 0;
  let index = 0;
  let stopped = false;
  const report = () => input.onProgress?.(input.items.length - queue.length + index);
  await report();
  for (; index < queue.length; ) {
    if (input.shouldStop?.()) {
      stopped = true;
      break;
    }
    const item = queue[index];
    try {
      await input.add(item);
      present.add(item.key);
      added += 1;
      index += 1;
      await report();
    } catch (error) {
      if (!input.isRateLimit(error) || pause >= pauses.length) {
        failure = error;
        break;
      }
      await input.sleep(pauses[pause]);
      pause += 1;
      try {
        present = await input.readKeys();
      } catch (readError) {
        failure = readError;
        break;
      }
      queue = pendingActItems(input.items, present);
      index = 0;
      await report();
    }
  }
  const inAct = input.items.filter((item) => present.has(item.key)).length;
  return { present, added, failure, inAct, stopped };
}

/** Комментарий акта по умолчанию — названия выбранных групп, как разделы у CHILLING. */
export function defaultActComment(groupNames: readonly string[]): string {
  const text = groupNames.map((name) => name.trim()).filter(Boolean).join(" / ");
  return text.length > CREATE_ACT_COMMENT_MAX ? `${text.slice(0, CREATE_ACT_COMMENT_MAX - 1)}…` : text;
}

export type CreateActInput = {
  attemptId: string;
  storeId: string;
  /** YYYY-MM-DD — день в поясе заведения. */
  date: string;
  /** HH:mm — время акта в поясе заведения: на этот момент Quick Resto считает расчётный остаток. */
  time: string;
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
  if (!isCalendarDay(input.date)) return "Укажите дату акта.";
  if (!isClockTime(input.time)) return "Укажите время акта в формате ЧЧ:ММ.";
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

export type CreateActGroupRow = {
  node: CreateActGroupNode;
  hasChildren: boolean;
  open: boolean;
};

/**
 * Строки дерева групп для панели: подгруппы видны, когда группа раскрыта.
 * При поиске видны найденные группы и их родители (родители раскрыты сами);
 * подгруппы найденной группы — по раскрытию, как без поиска.
 *
 * `nodes` — результат buildGroupTree (порядок обхода: родитель перед детьми).
 */
export function groupTreeRows(input: {
  nodes: readonly CreateActGroupNode[];
  expanded: ReadonlySet<string>;
  query: string;
}): CreateActGroupRow[] {
  const ids = new Set(input.nodes.map((node) => node.id));
  const parentOf = (node: CreateActGroupNode) => (node.parentId && ids.has(node.parentId) ? node.parentId : null);
  const hasChildren = new Set<string>();
  for (const node of input.nodes) {
    const parent = parentOf(node);
    if (parent) hasChildren.add(parent);
  }

  const query = input.query.trim().toLocaleLowerCase("ru");
  const matches = new Set<string>();
  const forcedOpen = new Set<string>();
  if (query) {
    const byId = new Map(input.nodes.map((node) => [node.id, node]));
    for (const node of input.nodes) {
      if (!node.name.toLocaleLowerCase("ru").includes(query)) continue;
      matches.add(node.id);
      let parent = parentOf(node);
      while (parent && !forcedOpen.has(parent)) {
        forcedOpen.add(parent);
        const parentNode = byId.get(parent);
        parent = parentNode ? parentOf(parentNode) : null;
      }
    }
  }

  const isOpen = (id: string) => hasChildren.has(id) && (forcedOpen.has(id) || input.expanded.has(id));
  const shown = new Set<string>();
  const underMatch = new Set<string>();
  const rows: CreateActGroupRow[] = [];
  for (const node of input.nodes) {
    const parent = parentOf(node);
    if (parent && (!shown.has(parent) || !isOpen(parent))) continue;
    if (matches.has(node.id) || (parent && underMatch.has(parent))) underMatch.add(node.id);
    const visible = !query || matches.has(node.id) || forcedOpen.has(node.id) || (parent !== null && underMatch.has(parent));
    if (!visible) continue;
    shown.add(node.id);
    rows.push({ node, hasChildren: hasChildren.has(node.id), open: isOpen(node.id) });
  }
  return rows;
}

/** Группы, у которых выбрана какая-то подгруппа, — для «частичной» галочки свёрнутого родителя. */
export function groupsWithSelectedDescendants(
  groups: readonly CreateActGroup[],
  selectedIds: readonly string[],
): Set<string> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const out = new Set<string>();
  for (const id of selectedIds) {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent && byId.has(parent) && !out.has(parent)) {
      out.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }
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
