/**
 * Бейдж статуса акта инвентаризации. Один источник правды для подписи и тона
 * статуса — список актов, шапка акта, справка, сличение удержания.
 *
 * Палитра — общая (`StatusBadge`, design-system § «Статусные бейджи»): один
 * рецепт на обе темы, без рамки. Соседние этапы процесса не делят цвет:
 * «Назначен» синий, «В работе» янтарный, «Готов к проверке» фиолетовый,
 * «Проведен» зелёный; «На пересчёте» и «Итоги требуют проверки» — красные,
 * они требуют действия менеджера.
 */

import { StatusBadge, statusTones, type StatusTone } from "@/components/ui/status-badge";

export const INVENTORY_STATUS_LABEL: Record<string, string> = {
  synced: "Новый",
  assigned: "Назначен",
  in_progress: "В работе",
  ready_for_review: "Готов к проверке",
  recount_pending: "На пересчёте",
  processed: "Проведен",
  results_blocked: "Итоги требуют проверки",
};

export const INVENTORY_STATUS_TONE: Record<string, StatusTone> = {
  synced: "neutral",
  assigned: "info",
  in_progress: "warning",
  ready_for_review: "accent",
  recount_pending: "danger",
  processed: "success",
  results_blocked: "danger",
};

/**
 * Янтарный тон «требует внимания» для маркеров вне актов (например,
 * «Подразделение не задано» в справочнике складов). Тот же рецепт, что у
 * `StatusBadge tone="warning"`; новые места берут сам `StatusBadge`.
 */
export const WARNING_BADGE_CLASS = statusTones.warning;

export function InventoryStatusBadge({
  status,
  label: labelOverride,
  className,
}: {
  status: string;
  /** Своя подпись при той же палитре (например, в сличении удержания). */
  label?: string;
  className?: string;
}) {
  const label = labelOverride ?? INVENTORY_STATUS_LABEL[status] ?? status;
  return (
    <StatusBadge
      tone={INVENTORY_STATUS_TONE[status] ?? "neutral"}
      // Подсказка с полной подписью: в узком столбце чип усекается многоточием.
      tip={label}
      className={className}
    >
      {label}
    </StatusBadge>
  );
}
