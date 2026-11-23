import type { AdditionalRules } from "./additional.ts";
import { lineKey, type UpsellLine, type UpsellTarget } from "./upsell.ts";

/** Позиция номенклатуры, которую можно выбрать в правилах допродаж. */
export type UpsellPickerItem = {
  /** `lineKey` строки правил: "dish:11", "dish_group:2" */
  key: string;
  target: UpsellTarget;
  external_id: string;
  name: string;
  /** Категории над позицией от корня через « → »; у корневой — пусто. */
  path: string;
  /** Ключ родительской группы ("dish_group:2") или null. */
  parent: string | null;
  /** Есть тег «Продажи / Бар» — только для подсказок первой версии. */
  tagged: boolean;
  archived: boolean;
};

type CatalogItemRow = {
  external_id: string;
  kind: string;
  name: string;
  group_id: string | null;
  tags: unknown;
  archived_at: string | null;
};
type CatalogGroupRow = {
  id: string;
  external_id: string;
  kind: string;
  name: string;
  parent_group_id: string | null;
  store_tags: unknown;
};

const KINDS = new Set(["dish", "modifier"]);
const norm = (s: string) => s.toLocaleLowerCase("ru").replace(/\s+/g, "");
const BAR_TAG = norm("Продажи / Бар");

/** Тег Quick Resto `storeItemTags[]`: `{ id, name, … }`; ищем по названию. */
function hasBarTag(tags: unknown): boolean {
  return (
    Array.isArray(tags) &&
    tags.some(
      (t) =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as { name?: unknown }).name === "string" &&
        norm((t as { name: string }).name) === BAR_TAG,
    )
  );
}

export function buildUpsellPicker(items: CatalogItemRow[], groups: CatalogGroupRow[]): UpsellPickerItem[] {
  const groupById = new Map(groups.filter((g) => KINDS.has(g.kind)).map((g) => [g.id, g]));
  const groupKey = (g: CatalogGroupRow) => `${g.kind}_group:${g.external_id}`;
  const pathOf = (groupId: string | null) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let g = groupId ? groupById.get(groupId) : undefined;
    while (g && !seen.has(g.id)) {
      seen.add(g.id);
      names.unshift(g.name);
      g = g.parent_group_id ? groupById.get(g.parent_group_id) : undefined;
    }
    return names.join(" → ");
  };
  const parentOf = (groupId: string | null) => {
    const g = groupId ? groupById.get(groupId) : undefined;
    return g ? groupKey(g) : null;
  };
  const out: UpsellPickerItem[] = [];
  for (const g of groupById.values())
    out.push({
      key: groupKey(g),
      target: `${g.kind}_group` as UpsellTarget,
      external_id: g.external_id,
      name: g.name,
      path: pathOf(g.parent_group_id),
      parent: parentOf(g.parent_group_id),
      tagged: hasBarTag(g.store_tags),
      archived: false,
    });
  for (const i of items) {
    if (!KINDS.has(i.kind)) continue;
    out.push({
      key: `${i.kind}:${i.external_id}`,
      target: i.kind as UpsellTarget,
      external_id: i.external_id,
      name: i.name,
      path: pathOf(i.group_id),
      parent: parentOf(i.group_id),
      tagged: hasBarTag(i.tags),
      archived: i.archived_at !== null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key));
}

/** Ставки кальянных мастеров за штуку (решение владельца, 22.11.2026). */
export const MASTERS_PREFILL: readonly { name: string; rate: number }[] = [
  { name: "Премиальный табак", rate: 100 },
  { name: "Дегустация", rate: 250 },
  { name: "Эксклюзивные кальяны", rate: 450 },
];

export type UpsellPrefill = {
  lines: UpsellLine[];
  /** Названия из старых правил, которых нет в номенклатуре. */
  notFound: string[];
  /** Помечены тегом «Продажи / Бар», но не оплачиваются новой версией. */
  taggedWithoutRate: string[];
  /** Оплачиваются, но ни сама цель, ни позиции внутри не помечены тегом. */
  ratedWithoutTag: string[];
};

/**
 * Первая версия правил подразделения из старых правил: бар — каждая
 * категория Quick Resto старой группы ищется категорией блюд с тем же
 * именем, иначе блюдом; кальяны — три категории с решёнными ставками.
 */
export function prefillUpsell(input: {
  legacyKind: "bar" | "masters";
  oldRules: AdditionalRules;
  picker: UpsellPickerItem[];
}): UpsellPrefill {
  const { legacyKind, oldRules, picker } = input;
  const find = (target: UpsellTarget, name: string) => {
    const matches = picker.filter((p) => p.target === target && p.name === name);
    return matches.find((p) => !p.archived) ?? matches[0];
  };
  const lines: UpsellLine[] = [];
  const notFound: string[] = [];
  const add = (p: UpsellPickerItem, rate: number) => {
    if (lines.some((l) => lineKey(l) === p.key)) return;
    lines.push({ target: p.target, external_id: p.external_id, name: p.name, rate });
  };

  if (legacyKind === "masters") {
    for (const m of MASTERS_PREFILL) {
      const p = find("dish_group", m.name);
      if (p) add(p, m.rate);
      else notFound.push(m.name);
    }
    return { lines, notFound, taggedWithoutRate: [], ratedWithoutTag: [] };
  }

  for (const g of oldRules.bar)
    for (const raw of g.branches) {
      const name = raw.trim();
      if (!name) continue;
      const p = find("dish_group", name) ?? find("dish", name);
      if (p) add(p, g.rate);
      else if (!notFound.includes(name)) notFound.push(name);
    }

  const byKey = new Map(picker.map((p) => [p.key, p]));
  const ancestors = (p: UpsellPickerItem) => {
    const out: UpsellPickerItem[] = [];
    const seen = new Set([p.key]);
    let cur = p.parent ? byKey.get(p.parent) : undefined;
    while (cur && !seen.has(cur.key)) {
      seen.add(cur.key);
      out.push(cur);
      cur = cur.parent ? byKey.get(cur.parent) : undefined;
    }
    return out;
  };
  const keys = new Set(lines.map(lineKey));
  const covered = (p: UpsellPickerItem) => keys.has(p.key) || ancestors(p).some((a) => keys.has(a.key));
  const live = picker.filter((p) => !p.archived);
  const uncovered = new Set(live.filter((p) => p.tagged && !covered(p)).map((p) => p.key));
  // Помеченную категорию называем один раз — её помеченные позиции уже в ней.
  const taggedWithoutRate = live
    .filter((p) => uncovered.has(p.key) && !ancestors(p).some((a) => uncovered.has(a.key)))
    .map((p) => p.name);

  const withTagInside = new Set<string>();
  for (const p of live) if (p.tagged) for (const a of ancestors(p)) withTagInside.add(a.key);
  const ratedWithoutTag = lines
    .filter((l) => {
      const p = byKey.get(lineKey(l));
      return p !== undefined && !p.tagged && !withTagInside.has(p.key);
    })
    .map((l) => l.name);

  return { lines, notFound, taggedWithoutRate, ratedWithoutTag };
}
