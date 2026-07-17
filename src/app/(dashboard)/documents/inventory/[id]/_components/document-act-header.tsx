"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";

import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Tab = "overview" | "form" | "results" | "history" | "danger";

/**
 * Шапка страницы акта инвентаризации. Состоит из:
 *  - <PageBreadcrumb> в топ-баре («‹ К списку»),
 *  - крупный заголовок «Акт № …» + статус-бейдж по образцу
 *    /people/staff/[userId] и /people/roles/[roleId],
 *  - контекст-строка под заголовком: «<Склад> · <N> позиций»,
 *  - ряд табов по центру: Форма / Итоги / Журнал / Опасная зона.
 *
 * Видимость табов:
 *  - «Форма» — если canFill && мой_акт ИЛИ canView,
 *  - «Итоги» — если canViewResults (view_results ИЛИ назначенный исполнитель
 *    проведённого акта, read-only). Дисейблится, когда у акта ещё нет
 *    построчных результатов (см. resultsAvailable). Для ready_for_review мы
 *    тоже считаем что итоги есть — менеджер должен посмотреть их при approve.
 *  - «Журнал» — только canViewJournal (настоящий view_results; read-only
 *    исполнителю журнал не положен). Зеркалится серверным гейтом в
 *    history/page.tsx.
 *  - «Опасная зона» — только canManage. Destructive-стиль.
 */
export function DocumentActHeader({
  documentId,
  documentNumber,
  status,
  storeTitle,
  canFill,
  canViewResults,
  canViewJournal,
  canManage,
  resultsAvailable,
  reopenedAfterProcessed,
}: {
  documentId: string;
  documentNumber: string;
  status: string;
  storeTitle: string | null;
  canFill: boolean;
  /** Таб «Итоги»: view_results ИЛИ назначенный исполнитель проведённого акта. */
  canViewResults: boolean;
  /** Таб «Журнал»: только настоящий view_results (см. history/page.tsx). */
  canViewJournal: boolean;
  canManage: boolean;
  resultsAvailable: boolean;
  /** Проведённый акт переоткрывали для правки итогов (F6): управленческие
      итоги могут расходиться с Quick Resto. */
  reopenedAfterProcessed: boolean;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const activeTab: Tab = pathname.endsWith("/overview")
    ? "overview"
    : pathname.endsWith("/results")
      ? "results"
      : pathname.endsWith("/history")
        ? "history"
        : pathname.endsWith("/danger")
          ? "danger"
          : "form";

  const tabHref: Record<Tab, string> = {
    overview: `/documents/inventory/${documentId}/overview`,
    form: `/documents/inventory/${documentId}`,
    results: `/documents/inventory/${documentId}/results`,
    history: `/documents/inventory/${documentId}/history`,
    danger: `/documents/inventory/${documentId}/danger`,
  };

  return (
    <>
      <PageBreadcrumb>
        <Link
          href="/documents/inventory"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          К списку
        </Link>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <h1 className="text-[28px] font-bold tracking-tight leading-tight truncate">
            Акт № {documentNumber}
          </h1>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {storeTitle ?? "Склад не указан"}
            </span>
            <InventoryStatusBadge status={status} />
            {reopenedAfterProcessed ? (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                title="Проведённый акт переоткрывали и правили итоги — управленческие суммы могут расходиться с Quick Resto."
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Итоги правились после проведения
              </span>
            ) : null}
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => router.push(tabHref[value as Tab])}
        >
          <TabsList className="justify-center">
            <TabsTrigger value="overview">Основное</TabsTrigger>
            {canFill ? <TabsTrigger value="form">Форма</TabsTrigger> : null}
            {canViewResults ? (
              resultsAvailable ? (
                <TabsTrigger value="results">Итоги</TabsTrigger>
              ) : (
                <TabsTrigger
                  value="results"
                  disabled
                  title="Итоги появятся после проведения акта"
                >
                  Итоги
                </TabsTrigger>
              )
            ) : null}
            {canViewJournal ? (
              <TabsTrigger value="history">Журнал</TabsTrigger>
            ) : null}
            {canManage ? (
              <TabsTrigger
                value="danger"
                className={cn(
                  "data-[state=active]:text-destructive",
                  "data-[state=active]:border-destructive",
                )}
              >
                Опасная зона
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
      </div>
    </>
  );
}
