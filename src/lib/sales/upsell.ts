import { validOrder, type Order, type OrderDetail } from "./calculate.ts";

export type UpsellTarget = "dish" | "dish_group" | "modifier" | "modifier_group";
export type UpsellLine = { target: UpsellTarget; external_id: string; name: string; rate: number };
export type UpsellCatalog = {
  /** "dish:123" | "modifier:7" → группа "dish_group:45" */
  items: Map<string, { name: string; group: string | null }>;
  /** "dish_group:45" → родитель */
  groups: Map<string, { name: string; parent: string | null }>;
};
export type UpsellDayResult = {
  bonus: number;
  lines: { key: string; quantity: number; amount: number }[];
  paid: Record<string, string>;
  unknown: { key: string; quantity: number }[];
};

const TARGETS: readonly string[] = ["dish", "dish_group", "modifier", "modifier_group"];
const MAX_LINES = 500;

const precise = (n: number) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineKey = (l: Pick<UpsellLine, "target" | "external_id">) => `${l.target}:${l.external_id}`;

/** Те же правила, что `private.sales_validate_upsell_lines` в БД. */
export function validateUpsellLines(lines: UpsellLine[]): void {
  if (!Array.isArray(lines)) throw new Error("Проверьте строки правил допродаж");
  if (lines.length > MAX_LINES) throw new Error("В версии правил допродаж не больше 500 строк");
  const seen = new Set<string>();
  for (const l of lines) {
    if (
      !l ||
      typeof l !== "object" ||
      typeof l.target !== "string" ||
      typeof l.external_id !== "string" ||
      typeof l.name !== "string" ||
      typeof l.rate !== "number"
    )
      throw new Error("Проверьте строки правил допродаж");
    if (!TARGETS.includes(l.target))
      throw new Error("В правилах допродаж можно выбрать блюдо, категорию блюд, модификатор или группу модификаторов");
    if (!/^[0-9]+$/.test(l.external_id)) throw new Error("Некорректный код позиции в правилах допродаж");
    const n = l.name.trim().length;
    if (n < 1 || n > 200) throw new Error("Название позиции в правилах допродаж — от 1 до 200 символов");
    if (!Number.isFinite(l.rate) || l.rate < 0 || l.rate > 1_000_000 || !/^\d+(\.\d{1,2})?$/.test(String(l.rate)))
      throw new Error("Некорректная ставка допродаж");
    const k = lineKey(l);
    if (seen.has(k)) throw new Error("Позиция повторяется в правилах допродаж");
    seen.add(k);
  }
}

/**
 * Строка правил для позиции чека. `broken` — путь вверх упёрся в группу,
 * которой нет в каталоге, раньше любого правила: оплату определить нельзя.
 */
function walkUpsellLine(
  itemKey: string,
  keys: Set<string>,
  catalog: UpsellCatalog,
): { key: string | null; broken: boolean } {
  if (keys.has(itemKey)) return { key: itemKey, broken: false };
  let group = catalog.items.get(itemKey)?.group ?? null;
  const visited = new Set<string>();
  while (group !== null) {
    if (visited.has(group)) throw new Error(`Цикл в дереве категорий: ${group}`);
    visited.add(group);
    if (keys.has(group)) return { key: group, broken: false };
    const g = catalog.groups.get(group);
    if (!g) return { key: null, broken: true };
    group = g.parent;
  }
  return { key: null, broken: false };
}

/** Ключ строки правил для позиции чека: своё правило, иначе ближайшая группа со строкой. */
export function resolveUpsellLine(itemKey: string, lines: UpsellLine[], catalog: UpsellCatalog): string | null {
  return walkUpsellLine(itemKey, new Set(lines.map(lineKey)), catalog).key;
}

export function countUpsellDay(input: {
  orders: Order[];
  details: OrderDetail[];
  staffIds: number[];
  lines: UpsellLine[];
  catalog: UpsellCatalog;
}): UpsellDayResult {
  const { orders, details, staffIds, lines, catalog } = input;
  validateUpsellLines(lines);
  const staff = new Set(staffIds);
  const byId = new Map(details.map((d) => [d.id, d]));
  if (
    new Set(orders.map((o) => o.id)).size !== orders.length ||
    byId.size !== details.length ||
    orders.length !== details.length
  )
    throw new Error("Неполные или повторяющиеся чеки");

  const keySet = new Set(lines.map(lineKey));
  const rateByKey = new Map(lines.map((l) => [lineKey(l), l.rate]));
  const qty = new Map<string, number>([...rateByKey.keys()].map((k) => [k, 0]));
  const unknown = new Map<string, number>();
  const paid: Record<string, string> = {};

  for (const o of orders) {
    const d = byId.get(o.id);
    if (!d) throw new Error(`Нет деталей чека ${o.id}`);
    if (!validOrder(o) || d.returned || d.deleted) continue;
    if (o.payer_id !== null && staff.has(o.payer_id)) continue;
    for (const line of d.lines) {
      if (!(line.amount > 0)) continue;
      if (line.kind === "other") continue;
      let itemKey: string;
      if (line.kind === "dish" || line.kind === "modifier") {
        itemKey = `${line.kind}:${line.product_id}`;
      } else {
        const dish = `dish:${line.product_id}`;
        const mod = `modifier:${line.product_id}`;
        const found = [dish, mod].filter((k) => catalog.items.has(k));
        itemKey = found.length === 1 ? found[0] : `?:${line.product_id}`;
      }
      const { key: target, broken } = walkUpsellLine(itemKey, keySet, catalog);
      if (target !== null) {
        qty.set(target, precise((qty.get(target) ?? 0) + line.quantity));
        paid[itemKey] = target;
      } else if (broken || !catalog.items.has(itemKey)) {
        unknown.set(itemKey, precise((unknown.get(itemKey) ?? 0) + line.quantity));
      }
    }
  }

  let bonus = 0;
  const out = lines.map((l) => {
    const key = lineKey(l);
    const quantity = qty.get(key) ?? 0;
    bonus += quantity * l.rate;
    return { key, quantity, amount: money(quantity * l.rate) };
  });
  return {
    bonus: Math.round(bonus),
    lines: out,
    paid,
    unknown: [...unknown.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, quantity]) => ({ key, quantity })),
  };
}
