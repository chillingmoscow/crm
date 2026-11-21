import type { RuleNameKind, RuleNames } from "./phrase.ts";
import type { RuleContext } from "./types.ts";

type Named = {
  id: string;
  name: string;
  archived_at?: string | null;
  deleted_at?: string | null;
};

/** Справочники, которые видит пользователь (под его RLS). Архивные — тоже:
 *  по ним правило помечается «Требует внимания». */
export type RuleDirectories = {
  counterparties: Array<Named & { inn: string | null; group_id: string | null }>;
  counterpartyGroups: Array<{ id: string; name: string }>;
  bankAccounts: Named[];
  categories: Array<Named & { type: "income" | "expense" | "mixed" }>;
  venues: Named[];
  /** Архивные записи, на которые ссылаются правила, но которых нет в списках
   *  выше (например, архивное заведение, скрытое от пользователя RLS). */
  archivedIds?: string[];
};

const isArchived = (item: Named) => Boolean(item.archived_at || item.deleted_at);

/** Неактивными считаются только записи, про которые известно, что они в
 *  архиве. Невидимые пользователю (чужое юрлицо) — не неактивные: правило
 *  с ними просто не совпадёт у этого пользователя. */
export function buildRuleContext(
  dirs: RuleDirectories,
  allowedVenueIds: string[] | null,
): RuleContext {
  const inactiveIds = new Set<string>();
  for (const list of [dirs.counterparties, dirs.bankAccounts, dirs.categories, dirs.venues]) {
    for (const item of list) if (isArchived(item)) inactiveIds.add(item.id);
  }
  for (const id of dirs.archivedIds ?? []) inactiveIds.add(id);
  return {
    counterparties: new Map(
      dirs.counterparties.map((c) => [c.id, { inn: c.inn, group_id: c.group_id }]),
    ),
    categoryTypes: new Map(dirs.categories.map((c) => [c.id, c.type])),
    inactiveIds,
    allowedVenueIds: allowedVenueIds === null ? null : new Set(allowedVenueIds),
  };
}

/** Названия для фразы правила; заведение вне доступных — без названия. */
export function buildRuleNames(dirs: RuleDirectories, allowedVenueIds: string[] | null): RuleNames {
  const allowed = allowedVenueIds === null ? null : new Set(allowedVenueIds);
  const maps: Record<RuleNameKind, Map<string, string>> = {
    counterparty: new Map(dirs.counterparties.map((c) => [c.id, c.name])),
    counterparty_group: new Map(dirs.counterpartyGroups.map((g) => [g.id, g.name])),
    bank_account: new Map(dirs.bankAccounts.map((a) => [a.id, a.name])),
    category: new Map(dirs.categories.map((c) => [c.id, c.name])),
    venue: new Map(
      dirs.venues.filter((v) => allowed === null || allowed.has(v.id)).map((v) => [v.id, v.name]),
    ),
  };
  return { lookup: (kind, id) => maps[kind].get(id) ?? null };
}
