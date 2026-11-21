import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { SalesDay } from "@/lib/sales/types";

/**
 * Статусы смены — одни и те же слова в таблице, фильтре, панели, экспорте и
 * справке. «С исправлениями» — не статус, а признак: он есть только в
 * фильтре и в шапке панели рядом с основным статусом.
 */
export const salesStatuses = {
  preliminary: {
    label: "Предварительно",
    tone: "info",
    description:
      "Текущий рабочий день. Показатели ещё меняются и обновляются автоматически, если автообновление включено",
  },
  complete: {
    label: "Завершена",
    tone: "success",
    description:
      "Прошедший рабочий день пересчитан из Quick Resto. Смену можно обновить повторно",
  },
  imported: {
    label: "Ожидает пересчёта",
    tone: "warning",
    description:
      "Смена перенесена из прежнего учёта и ещё не пересчитана из Quick Resto. До пересчёта части показателей может не быть",
  },
  adjusted: {
    label: "С исправлениями",
    tone: "accent",
    description:
      "Есть ручные исправления. Основной статус смены сохраняется, исправленные значения отмечены точкой",
  },
  error: {
    label: "Ошибка обновления",
    tone: "danger",
    description:
      "Последнее обновление не удалось. Показаны последние сохранённые значения, причина в подсказке к статусу",
  },
} satisfies Record<
  string,
  { label: string; tone: StatusTone; description: string }
>;

export type SalesStatusKey = keyof typeof salesStatuses;

/** Статус строки смены: ошибка обновления важнее основного статуса. */
export function salesDayStatus(day: Pick<SalesDay, "status" | "sync_error">): SalesStatusKey {
  return day.sync_error ? "error" : day.status;
}

export function SalesStatusBadge({
  status,
  tip,
}: {
  status: SalesStatusKey;
  /** Подсказка вместо общего описания статуса — например, текст ошибки. */
  tip?: string;
}) {
  const entry = salesStatuses[status];
  return (
    <StatusBadge tone={entry.tone} tip={tip ?? entry.description}>
      {entry.label}
    </StatusBadge>
  );
}
