import { countRu } from "../format/plural.ts";

/**
 * Тексты разнесения списаний: итог массового разнесения и подписи плательщика
 * в общем журнале. Без импортов из `@/...`: тест-раннер не резолвит alias.
 */

const acts = (n: number) => countRu(n, "акт", "акта", "актов");

/** Ответ `set_writeoff_pool_bulk`: сколько актов разнесено и почему остальные пропущены. */
export type WriteoffBulkResult = {
  applied: number;
  /** Уже были разнесены на этого плательщика. */
  unchanged: number;
  /** Черновики и акты, которых больше нет в Quick Resto: в расчёт не идут. */
  notCounted: number;
  /** Акт не найден в заведении (например, пропал между открытием страницы и сохранением). */
  notFound: number;
};

/** «Разнесено: 7 актов, пропущено: 3 акта» и пояснение, почему пропущены. */
export function writeoffBulkSummary(r: WriteoffBulkResult): {
  title: string;
  description: string | null;
} {
  const skipped = r.unchanged + r.notCounted + r.notFound;
  const title =
    skipped > 0
      ? `Разнесено: ${acts(r.applied)}, пропущено: ${acts(skipped)}`
      : `Разнесено: ${acts(r.applied)}`;
  const reasons = [
    r.unchanged > 0 ? `уже с этим плательщиком: ${r.unchanged}` : null,
    r.notCounted > 0 ? `черновики и акты, которых нет в Quick Resto: ${r.notCounted}` : null,
    r.notFound > 0 ? `не найдены: ${r.notFound}` : null,
  ].filter((x): x is string => !!x);
  const description = reasons.length
    ? reasons.join("; ").replace(/^./, (c) => c.toLocaleUpperCase("ru-RU"))
    : null;
  return { title, description };
}

/**
 * Плательщик из `details.before` / `details.after` события журнала.
 * Новые строки (миграция 368) несут имя на момент записи; у старых имени нет,
 * тогда показывается только вариант. `null` - плательщика не было.
 */
export function writeoffJournalPayer(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { pool?: unknown; name?: unknown };
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : null;
  switch (v.pool) {
    case "shared":
      return "Вся команда";
    case "excluded":
      return "Не удерживать";
    case "department":
      return name ? `Подразделение: ${name}` : "Подразделение";
    case "personal":
      return name ? `Сотрудник: ${name}` : "Сотрудник";
    default:
      return null;
  }
}

/** «№ 15» по номеру акта из журнала; у старых строк номера нет - `null`. */
export function writeoffJournalNumber(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? `№ ${value.trim()}` : null;
}

/** Номера актов массового разнесения: «№ 1, № 2, № 3 и ещё 9». */
export function writeoffJournalNumbers(actsList: unknown, limit = 5): string | null {
  if (!Array.isArray(actsList) || actsList.length === 0) return null;
  const numbers = actsList.map(
    (a) =>
      writeoffJournalNumber((a as { number?: unknown } | null)?.number) ??
      "без номера",
  );
  const shown = numbers.slice(0, limit).join(", ");
  const rest = numbers.length - Math.min(limit, numbers.length);
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}
