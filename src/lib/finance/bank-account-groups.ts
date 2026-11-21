/**
 * Группы счетов: проверка списка из панели «Группы счетов» и расчёт, что
 * поменять в базе. Чистые функции без алиасов — их гоняет `node:test`.
 *
 * Панель отдаёт желаемый список целиком (порядок = порядок в списке),
 * сервер сам сравнивает его с тем, что лежит в базе. Так устаревшая
 * вкладка не затрёт чужую правку молча: незнакомый id — ошибка.
 */

export const GROUP_NAME_MAX = 60;

export type GroupDraft = {
  /** null — новая группа. */
  id: string | null;
  name: string;
};

export type SavedGroup = {
  id: string;
  name: string;
  sort_order: number;
};

export type GroupPlan = {
  create: { name: string; sort_order: number }[];
  update: { id: string; name?: string; sort_order?: number }[];
  remove: SavedGroup[];
  /** Переименования «было → стало» — для журнала. */
  renamed: { id: string; from: string; to: string }[];
  /** Порядок поменялся у оставшихся групп. */
  reordered: boolean;
};

/** Пробелы по краям убираем, внутренние схлопываем: «Банк  ВТБ » → «Банк ВТБ». */
export function normalizeGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Ошибки по позициям списка. Пусто — можно сохранять. */
export function validateGroupDrafts(drafts: GroupDraft[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Map<string, number>();
  drafts.forEach((d, i) => {
    const name = normalizeGroupName(d.name);
    if (!name) {
      errors[i] = "Введите название группы";
      return;
    }
    if (name.length > GROUP_NAME_MAX) {
      errors[i] = `Не длиннее ${GROUP_NAME_MAX} символов`;
      return;
    }
    const key = name.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) {
      errors[i] = "Такая группа уже есть";
      return;
    }
    seen.set(key, i);
  });
  return errors;
}

/**
 * Что сделать в базе, чтобы получить список `drafts`. `sort_order` —
 * номер в списке с единицы; меняется только у тех, чей номер сдвинулся.
 * Бросает ошибку, если в списке есть id, которого нет среди сохранённых
 * (группу удалили в другой вкладке).
 */
export function planGroupChanges(saved: SavedGroup[], drafts: GroupDraft[]): GroupPlan {
  const byId = new Map(saved.map((g) => [g.id, g]));
  const kept = new Set<string>();
  const plan: GroupPlan = { create: [], update: [], remove: [], renamed: [], reordered: false };

  const savedOrder = [...saved]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru"))
    .map((g) => g.id);

  drafts.forEach((d, i) => {
    const name = normalizeGroupName(d.name);
    const sort_order = i + 1;
    if (!d.id) {
      plan.create.push({ name, sort_order });
      return;
    }
    const current = byId.get(d.id);
    if (!current) throw new Error("STALE_GROUP");
    if (kept.has(d.id)) throw new Error("DUPLICATE_GROUP");
    kept.add(d.id);
    const patch: GroupPlan["update"][number] = { id: d.id };
    if (current.name !== name) {
      patch.name = name;
      plan.renamed.push({ id: d.id, from: current.name, to: name });
    }
    if (current.sort_order !== sort_order) patch.sort_order = sort_order;
    if (patch.name !== undefined || patch.sort_order !== undefined) plan.update.push(patch);
  });

  plan.remove = saved.filter((g) => !kept.has(g.id));

  const keptOrderBefore = savedOrder.filter((id) => kept.has(id));
  const keptOrderAfter = drafts.flatMap((d) => (d.id ? [d.id] : []));
  plan.reordered = keptOrderBefore.some((id, i) => id !== keptOrderAfter[i]);

  return plan;
}

export function isEmptyGroupPlan(plan: GroupPlan): boolean {
  return plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;
}

/** Список в панели отличается от сохранённого (для «не сохранять изменения?»). */
export function groupDraftsDirty(saved: SavedGroup[], drafts: GroupDraft[]): boolean {
  const ordered = [...saved].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru"));
  if (ordered.length !== drafts.length) return true;
  return drafts.some((d, i) => d.id !== ordered[i].id || normalizeGroupName(d.name) !== ordered[i].name);
}

/**
 * Названия удалённых групп из записей журнала «изменил(а) группы счетов»
 * (`details.deleted = [{ id, name }]`). Нужны истории счёта: после удаления
 * группы в базе её нет, а в событиях счёта остался её id.
 */
export function deletedGroupNames(detailsList: unknown[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const details of detailsList) {
    const deleted = (details as { deleted?: unknown } | null)?.deleted;
    if (!Array.isArray(deleted)) continue;
    for (const g of deleted) {
      const { id, name } = (g ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id === "string" && typeof name === "string" && !names.has(id)) names.set(id, name);
    }
  }
  return names;
}
