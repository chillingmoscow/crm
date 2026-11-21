/**
 * Поля-ссылки в `details.changes` («группа: <id> → <id>»): триггер пишет id,
 * а в журнале нужно название. Список событий собирает id, одним запросом
 * берёт названия и подменяет значения до рендера. Удалённый объект
 * показывается подписью `missing`, а не голым id.
 *
 * Чистые функции без алиасов — их гоняет `node:test`.
 */

type Change = { field?: unknown; old?: unknown; new?: unknown };

function changesOf(details: Record<string, unknown> | null | undefined): Change[] {
  const raw = details?.changes;
  return Array.isArray(raw) ? (raw as Change[]) : [];
}

/** Все id из изменений поля `field`. */
export function collectChangeIds(
  details: Record<string, unknown> | null | undefined,
  field: string,
): string[] {
  const ids: string[] = [];
  for (const c of changesOf(details)) {
    if (c.field !== field) continue;
    for (const v of [c.old, c.new]) if (typeof v === "string" && v) ids.push(v);
  }
  return ids;
}

/** Копия `details`, где id поля `field` заменены названиями. */
export function resolveChangeIds(
  details: Record<string, unknown>,
  field: string,
  names: Map<string, string>,
  missing: string,
): Record<string, unknown> {
  const changes = changesOf(details);
  if (!changes.some((c) => c.field === field)) return details;
  const label = (v: unknown) => (typeof v === "string" && v ? (names.get(v) ?? missing) : v);
  return {
    ...details,
    changes: changes.map((c) => (c.field === field ? { ...c, old: label(c.old), new: label(c.new) } : c)),
  };
}
