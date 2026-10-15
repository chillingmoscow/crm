import { AlertCircle, Check, Clock3, History, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const salesStatuses = {
  preliminary: {
    label: "Предварительно",
    icon: Clock3,
    description:
      "Текущий рабочий день. Показатели ещё меняются и обновляются автоматически, если автообновление включено.",
    color:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  },
  complete: {
    label: "Завершена",
    icon: Check,
    description:
      "Прошедший рабочий день пересчитан из Quick Resto. Кассовые отчёты проверены; смену можно обновить повторно.",
    color:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30",
  },
  imported: {
    label: "Ожидает пересчёта",
    icon: History,
    description:
      "Историческая смена ещё не пересчитана напрямую из Quick Resto. До пересчёта часть показателей может отсутствовать.",
    color:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  },
  adjusted: {
    label: "С исправлениями",
    icon: Pencil,
    description:
      "Фильтр смен с ручными исправлениями. Это дополнительный признак: смена сохраняет свой основной статус, а исправленные значения отмечены янтарной точкой.",
    color:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  },
  error: {
    label: "Ошибка обновления",
    icon: AlertCircle,
    description:
      "Последнее обновление не удалось. В таблице остаются последние успешно рассчитанные значения. Причину можно увидеть в подсказке к статусу и в истории смены.",
    color:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  },
};

export function SalesStatusBadge({
  status,
  title,
}: {
  status: keyof typeof salesStatuses;
  title?: string;
}) {
  const entry = salesStatuses[status];
  const Icon = entry.icon;
  return (
    <Badge
      variant="outline"
      title={title ?? entry.description}
      className={cn(
        "max-w-full gap-1 overflow-hidden whitespace-nowrap font-normal",
        entry.color,
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{entry.label}</span>
    </Badge>
  );
}
