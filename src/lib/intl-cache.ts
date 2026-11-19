/**
 * `new Intl.DateTimeFormat(...)` дорогой: ICU разбирает локаль и часовой пояс
 * заново на каждый вызов (≈25 мкс против ≈1,5 мкс у готового форматтера).
 * Расписание переводит даты смен в пояс заведения тысячи раз за рендер — на
 * сетке недели это давало 0,4–0,9 с подвисания на «Показать задачи».
 * Форматтер неизменяемый, поэтому один экземпляр на набор опций безопасно
 * переиспользовать.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, format);
  }
  return format;
}
