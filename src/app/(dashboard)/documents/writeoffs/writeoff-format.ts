import type { StatusTone } from "@/components/ui/status-badge";
import { formatDayMonthTime } from "@/lib/format/date";
import {
  filterWriteoffs,
  type WriteoffPoolFilter,
  type WriteoffRow,
} from "@/lib/stock/writeoff-view";

/** Тон статуса акта или записи: один для таблицы, карточек и панели. */
export function writeoffStatusTone(status: string): StatusTone {
  if (status === "Проведён") return "success";
  if (status.startsWith("Удал") || status === "Нет в источнике") return "danger";
  return "neutral";
}

/**
 * Момент времени в часовом поясе заведения: «16 ноября, 14:05».
 * `formatDayMonthTime` форматирует в поясе браузера, поэтому сначала
 * переводим момент в «настенное» время заведения.
 */
export function writeoffStamp(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  let wall = date;
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((x) => [x.type, x.value]),
    );
    wall = new Date(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
  } catch {
    // Неизвестный пояс — показываем в поясе браузера.
  }
  return formatDayMonthTime(wall) ?? "—";
}

/**
 * Условия списка поверх общего `filterWriteoffs`: «» у типа и разнесения —
 * «не выбрано». Поиск дополнительно находит акт по его номеру в Quick Resto
 * (`external_id`), который в общий поиск не входит.
 */
export function applyWriteoffConditions(
  rows: WriteoffRow[],
  month: string,
  kind: string,
  pool: WriteoffPoolFilter | "",
  search: string,
): WriteoffRow[] {
  const base = filterWriteoffs(rows, month, kind || "all", "", pool || "all");
  const needle = search.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
  if (!needle) return base;
  const hits = new Set(
    filterWriteoffs(base, month, "all", search, "all").map((r) => r.id),
  );
  return base.filter(
    (r) =>
      hits.has(r.id) ||
      (!!r.native && String(r.native.external_id).includes(needle)),
  );
}

/** Количество позиции: точность как в источнике, до 6 знаков. */
export const writeoffQuantity = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
