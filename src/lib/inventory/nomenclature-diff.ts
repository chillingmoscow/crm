// Чистая логика сверки номенклатуры Quick Resto с каталогом: что писать, что
// архивировать. Без обращений к базе и сети — чтобы проверять тестами.

/**
 * JSON с упорядоченными ключами. Postgres хранит jsonb со своим порядком
 * ключей, поэтому сравнивать прочитанный из базы payload со свежим ответом
 * Quick Resto простым JSON.stringify нельзя — одна и та же позиция выглядела
 * бы изменённой при каждом запуске.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/** Совпадают ли строки по перечисленным полям (отсутствующее поле = null). */
export function sameFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => stableStringify(existing[key] ?? null) === stableStringify(incoming[key] ?? null));
}

/**
 * Делит пришедшие строки на новые, изменённые и неизменённые.
 *
 * Неизменённые не пишутся вовсе — ни в каталог, ни в снимки: каждые три часа
 * переписывать две тысячи одинаковых строк незачем, а у каждой записи ещё и
 * сдвигается updated_at.
 */
export function splitByChange<T extends { external_id: string }>(
  incoming: T[],
  existingByExternalId: Map<string, Record<string, unknown>>,
  keys: readonly string[],
): { inserted: T[]; changed: T[]; unchanged: T[] } {
  const inserted: T[] = [];
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const row of incoming) {
    const existing = existingByExternalId.get(row.external_id);
    if (!existing) inserted.push(row);
    else if (sameFields(existing, row as unknown as Record<string, unknown>, keys)) unchanged.push(row);
    else changed.push(row);
  }
  return { inserted, changed, unchanged };
}

/**
 * Сколько позиций должно пропасть разом, чтобы это сочли сбоем выгрузки, а не
 * правкой меню: при маленьком справочнике «больше половины» — это две-три
 * позиции, и такая чистка вполне может быть настоящей.
 */
export const MASS_ARCHIVE_MIN_ITEMS = 5;

export type LocalCatalogRow = {
  id: string;
  external_id: string | null;
  archived_at: string | null;
};

export type ArchivePlan = {
  toArchive: string[];
  toUnarchive: string[];
  /** Архивация пропущена защитой; toArchive в этом случае пуст. */
  guarded: boolean;
  /** Сколько позиций защита не дала заархивировать. */
  guardedCount: number;
};

/**
 * Что архивировать и что вернуть из архива по итогам выгрузки одного вида.
 *
 * Защита от массовой архивации: пустой ответ Quick Resto или ответ, после
 * которого пропала бы больше чем половина живых позиций, — скорее сбой
 * выгрузки (права, таймаут, другой модуль), чем настоящая чистка меню. В этом
 * случае не архивируем ничего, а вызывающий пишет предупреждение. Возврат из
 * архива при этом идёт как обычно — он безопасен.
 */
export function planArchive(input: {
  incomingExternalIds: ReadonlySet<string>;
  local: readonly LocalCatalogRow[];
}): ArchivePlan {
  const { incomingExternalIds, local } = input;
  const live = local.filter((row) => row.external_id && !row.archived_at);
  const missing = live.filter((row) => !incomingExternalIds.has(row.external_id as string)).map((row) => row.id);
  const toUnarchive = local
    .filter((row) => row.external_id && row.archived_at && incomingExternalIds.has(row.external_id))
    .map((row) => row.id);

  const emptyResponse = incomingExternalIds.size === 0 && missing.length > 0;
  const mostVanished = missing.length >= MASS_ARCHIVE_MIN_ITEMS && missing.length * 2 > live.length;
  if (emptyResponse || mostVanished) {
    return { toArchive: [], toUnarchive, guarded: true, guardedCount: missing.length };
  }
  return { toArchive: missing, toUnarchive, guarded: false, guardedCount: 0 };
}

