/**
 * Бейдж статуса акта инвентаризации. Один источник правды для
 * цветов в light/dark — раньше STATUS_BADGE_CLASS дублировался
 * в documents-table.tsx и document-act-header.tsx со светлыми
 * значениями (на тёмной теме читалось плохо).
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const INVENTORY_STATUS_LABEL: Record<string, string> = {
  synced: "Новый",
  assigned: "Назначен",
  in_progress: "В работе",
  ready_for_review: "Готов к проверке",
  recount_pending: "На пересчёте",
  processed: "Проведен",
  results_blocked: "Итоги требуют проверки",
};

// Dark-варианты по образцу staff-detail-page (см. memory
// feedback_design_system_first и docs/design-system.md):
// — light: bg-{color}-100, text-{color}-700, border-{color}-200
// — dark:  bg-{color}-500/15, text-{color}-300/400, border-{color}-500/30
const STATUS_BADGE_CLASS: Record<string, string> = {
  synced:
    "bg-slate-100 dark:bg-slate-500/15 " +
    "text-slate-700 dark:text-slate-300 " +
    "border-slate-200 dark:border-slate-500/30",
  assigned:
    "bg-blue-50 dark:bg-blue-500/15 " +
    "text-blue-700 dark:text-blue-300 " +
    "border-blue-200 dark:border-blue-500/30",
  in_progress:
    "bg-amber-50 dark:bg-amber-500/15 " +
    "text-amber-700 dark:text-amber-300 " +
    "border-amber-200 dark:border-amber-500/30",
  ready_for_review:
    "bg-violet-50 dark:bg-violet-500/15 " +
    "text-violet-700 dark:text-violet-300 " +
    "border-violet-200 dark:border-violet-500/30",
  // recount_pending — rose-токен, как destructive, но мягче: акт «отозван
  // менеджером» — состояние требует внимания, не ошибка.
  recount_pending:
    "bg-rose-50 dark:bg-rose-500/15 " +
    "text-rose-700 dark:text-rose-300 " +
    "border-rose-200 dark:border-rose-500/30",
  processed:
    "bg-emerald-50 dark:bg-emerald-500/15 " +
    "text-emerald-700 dark:text-emerald-400 " +
    "border-emerald-200 dark:border-emerald-500/30",
  results_blocked:
    "bg-rose-50 dark:bg-rose-500/15 " +
    "text-rose-700 dark:text-rose-300 " +
    "border-rose-200 dark:border-rose-500/30",
};

const STATUS_FALLBACK_CLASS =
  "bg-slate-50 dark:bg-slate-500/15 " +
  "text-slate-700 dark:text-slate-300 " +
  "border-slate-200 dark:border-slate-500/30";

export function InventoryStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const label = INVENTORY_STATUS_LABEL[status] ?? status;
  return (
    <Badge
      variant="outline"
      title={label}
      className={cn(
        // max-w-full + overflow-hidden + внутренний truncate: в узком столбце
        // чип усекается многоточием, сохраняя скруглённую рамку и паддинги,
        // а не режется жёстко краем ячейки (td overflow-hidden).
        "max-w-full overflow-hidden text-xs font-normal",
        STATUS_BADGE_CLASS[status] ?? STATUS_FALLBACK_CLASS,
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  );
}
