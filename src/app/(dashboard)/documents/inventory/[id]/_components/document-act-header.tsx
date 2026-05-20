"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  synced: "Новый",
  assigned: "Назначен",
  in_progress: "В работе",
  ready_for_review: "Готов к проверке",
  processed: "Проведен",
  results_blocked: "Итоги требуют проверки",
  sync_error: "Ошибка синхронизации",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  synced:           "bg-slate-100 text-slate-700 border-slate-200",
  assigned:         "bg-blue-50 text-blue-700 border-blue-200",
  in_progress:      "bg-amber-50 text-amber-700 border-amber-200",
  ready_for_review: "bg-violet-50 text-violet-700 border-violet-200",
  processed:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  results_blocked:  "bg-rose-50 text-rose-700 border-rose-200",
  sync_error:       "bg-rose-50 text-rose-700 border-rose-200",
};

/**
 * Header layout'а акта. Заголовок (Номер + статус), back-кнопка
 * к списку, табы переключения между «Заполнение» и «Итоги».
 *
 * Видимость табов зависит от прав:
 * - canFill: показываем «Заполнение». Без права (но с view_results)
 *   тaб просто скрыт — пользователь видит только «Итоги».
 * - canViewResults: показываем «Итоги». Без права таб скрыт.
 *   Дополнительно: если на акте нет построчных итогов (т.е. ещё
 *   не обработан), таб «Итоги» disabled — показывает только
 *   placeholder-страницу.
 */
export function DocumentActHeader({
  documentId,
  documentNumber,
  status,
  canFill,
  canViewResults,
  resultsAvailable,
}: {
  documentId: string;
  documentNumber: string;
  status: string;
  canFill: boolean;
  canViewResults: boolean;
  /** processed || results_has_line_amounts || results_blocked */
  resultsAvailable: boolean;
}) {
  const pathname = usePathname();
  const fillingHref = `/documents/inventory/${documentId}`;
  const resultsHref = `/documents/inventory/${documentId}/results`;
  const onResultsTab = pathname?.endsWith("/results") ?? false;

  return (
    <div className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pt-4 md:px-6 md:pt-5">
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/documents/inventory">
              <ArrowLeft className="h-4 w-4" />
              <span className="ml-2">К списку</span>
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Акт № {documentNumber}
          </h1>
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-normal",
              STATUS_BADGE_CLASS[status] ?? "bg-slate-50 text-slate-700 border-slate-200",
            )}
          >
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>

        <div className="flex items-center gap-1 -mb-px">
          {canFill ? (
            <Link
              href={fillingHref}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                !onResultsTab
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Заполнение
            </Link>
          ) : null}
          {canViewResults ? (
            resultsAvailable ? (
              <Link
                href={resultsHref}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  onResultsTab
                    ? "border-brand text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Итоги
              </Link>
            ) : (
              <span
                className="cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground/50"
                title="Итоги появятся после проведения акта"
              >
                Итоги
              </span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
