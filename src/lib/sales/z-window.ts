import { dayWindow } from "./time.ts";

/**
 * Кассовые отчёты (Z) рабочего дня: открытые с начала рабочего дня до начала
 * следующего, правая граница не входит. Тот же принцип, что у контроля кассы
 * (`normalizeCashControl`): Quick Resto ищет по календарной дате открытия,
 * поэтому список запрашивается за два календарных дня, а лишнее отсекается
 * здесь. Иначе касса, открытая после полуночи, терялась (чаевые и депозиты
 * дня занижались), а касса, открытая утром до начала дня, попадала не в свой
 * день.
 *
 * Отчёт без подтверждённого времени открытия — ошибка, а не пропуск: молча
 * выброшенная касса дала бы заниженные суммы.
 */
export function zReportIdsInWindow(
  list: unknown[],
  date: string,
  timezone: string,
  hour: number,
): number[] {
  const window = dayWindow(date, timezone, hour);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    const r = (item ?? {}) as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error("Нет номера кассового отчёта");
    if (seen.has(id)) throw new Error("Кассовые отчёты повторяются");
    seen.add(id);
    const opened = typeof r.opened === "string" ? Date.parse(r.opened) : NaN;
    if (
      typeof r.opened !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(r.opened) ||
      !Number.isFinite(opened)
    )
      throw new Error("Нет подтверждённого времени открытия кассовой смены");
    if (opened >= window.start && opened < window.end) ids.push(id);
  }
  return ids;
}
