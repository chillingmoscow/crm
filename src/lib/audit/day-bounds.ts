/** Начало календарного дня `YYYY-MM-DD` в часовом поясе `timeZone` —
 *  как ISO-момент. Нужен фильтру «Период» журнала: сутки считаются по
 *  часовому поясу заведения (как и заголовки дней в ленте), а не по поясу
 *  сервера, иначе события после 21:00 по Москве уезжали бы в «завтра».
 *
 *  `addDays` сдвигает день (1 — начало следующих суток, то есть
 *  исключающая верхняя граница). Невалидная дата → `null`. */
export function zonedDayStartIso(
  yyyyMmDd: string,
  timeZone: string,
  addDays = 0,
): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const wall = Date.UTC(y, m - 1, d + addDays);
  if (Number.isNaN(wall)) return null;
  // Полночь по местному времени = полночь UTC минус смещение пояса.
  // Смещение берём дважды: второй раз — в найденный момент, чтобы день
  // перехода на летнее время не съехал на час.
  let instant = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  instant = wall - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant).toISOString();
}

function offsetMinutes(at: Date, timeZone: string): number {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
  } catch {
    return 0;
  }
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? "");
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}
