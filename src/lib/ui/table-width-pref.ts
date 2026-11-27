// Ширина контейнера таблиц — запоминается в cookie этого браузера.
//
// Таблица (`DataTable`) раскладывает ширины столбцов по ширине своего
// контейнера, а сервер её не знает: раньше он рисовал столбцы по минимумам, и
// после загрузки скриптов они разъезжались вбок. Теперь браузер сохраняет
// замеренную ширину, и со следующего захода сервер рисует столбцы сразу так,
// как их разложит браузер (design-system, «Страница открывается готовой»).
//
// Значение — «ключ:ширина» через точку; ключ — короткий хэш адреса страницы и
// набора столбцов. Хранятся последние `MAX_ENTRIES` таблиц, чтобы cookie не
// росла (она уходит с каждым запросом).

export const TABLE_WIDTH_COOKIE = "sheerly_table_w";
const MAX_ENTRIES = 24;

/** Ключ таблицы: адрес страницы и столбцы (у двух таблиц одной страницы они разные). */
export function tableWidthKey(pathname: string, columnIds: readonly string[]) {
  const text = `${pathname}|${columnIds.join(",")}`;
  // FNV-1a, 32 бита: коротко и одинаково на сервере и в браузере.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Значение cookie → ширины по ключам (порядок — от старых к новым). */
export function parseTableWidths(value: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!value) return map;
  for (const part of value.split(".")) {
    const [key, raw] = part.split(":");
    const width = Number(raw);
    if (key && /^[0-9a-z]{1,8}$/.test(key) && Number.isInteger(width) && width > 0 && width < 10000)
      map.set(key, width);
  }
  return map;
}

/** Ширины → значение cookie; новая запись — в конец, старые лишние отбрасываются. */
export function serializeTableWidths(map: Map<string, number>, key: string, width: number) {
  const next = new Map(map);
  next.delete(key);
  next.set(key, Math.round(width));
  const entries = [...next.entries()].slice(-MAX_ENTRIES);
  return entries.map(([k, w]) => `${k}:${w}`).join(".");
}
