import type { LooseQuery } from "@/lib/supabase/loose";

/** Сколько строк PostgREST отдаёт за один запрос (`max_rows` в supabase/config.toml). */
export const POSTGREST_PAGE_SIZE = 1000;

/**
 * Все строки запроса постранично. PostgREST молча обрезает ответ до
 * `max_rows` (1000), и без постраничного чтения длинный справочник теряет
 * хвост — например, ингредиенты после тысячной позиции по алфавиту.
 *
 * `build` вызывается заново на каждую страницу: билдер запроса Supabase
 * одноразовый. Порядок обязан быть стабильным, поэтому к сортировке
 * вызывающего добавляется `id` как последний ключ.
 */
export async function fetchAllRows<T>(
  build: () => LooseQuery<T[]>,
  pageSize = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build()
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** Делит список на части — для `.in(...)`, чтобы не упереться в длину URL. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
