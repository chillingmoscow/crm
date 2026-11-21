"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, RotateCcw } from "lucide-react";

import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ProfileHeader } from "@/components/shared/profile-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProfileTabsList, Tabs, TabsTrigger } from "@/components/ui/tabs";

type Tab = "overview" | "form" | "results" | "history" | "danger";

/**
 * Шапка карточки акта инвентаризации (design-system § «Detail-страница со
 * табами»):
 *  - путь в топ-баре «Документы / Акты инвентаризации / Акт № …»;
 *  - `ProfileHeader`: плитка-иконка вместо фото, «Акт № …» 28px, под ним
 *    серая строка контекста (склад · дата) и бейджи статуса;
 *  - вкладки `ProfileTabsList` по центру колонки.
 *
 * Видимость вкладок:
 *  - «Форма» — если canFill (свой акт) или canView;
 *  - «Итоги» — view_results ИЛИ назначенный исполнитель проведённого акта
 *    (только чтение). Неактивна, пока у акта нет построчных итогов;
 *  - «Журнал» — только настоящий view_results (зеркало гейта history/page);
 *  - «Опасная зона» — только когда удаление доступно (manage + замка нет):
 *    вкладку, в которой ничего нельзя сделать, не показываем.
 */
export function DocumentActHeader({
  documentId,
  documentNumber,
  status,
  storeTitle,
  invoiceDate,
  canFill,
  canViewResults,
  canViewJournal,
  canDelete,
  resultsAvailable,
  reopenedAfterProcessed,
  recountParent,
}: {
  documentId: string;
  documentNumber: string;
  status: string;
  storeTitle: string | null;
  /** Дата акта, уже отформатированная («20 ноября»). */
  invoiceDate: string | null;
  canFill: boolean;
  /** Вкладка «Итоги»: view_results ИЛИ назначенный исполнитель проведённого акта. */
  canViewResults: boolean;
  /** Вкладка «Журнал»: только настоящий view_results (см. history/page.tsx). */
  canViewJournal: boolean;
  /** Вкладка «Опасная зона»: есть право и акт сейчас можно удалить. */
  canDelete: boolean;
  resultsAvailable: boolean;
  /** Проведённый акт переоткрывали для правки итогов: управленческие
      итоги могут расходиться с Quick Resto. */
  reopenedAfterProcessed: boolean;
  /** Для акта пересчёта — исходный акт: номер и id для ссылки. */
  recountParent: { id: string; documentNumber: string } | null;
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

  const context = [storeTitle ?? "Склад не указан", invoiceDate].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[720px] flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Документы" },
          { label: "Акты инвентаризации", href: "/documents/inventory" },
          { label: `Акт № ${documentNumber}` },
        ]}
      />

      <ProfileHeader
        name={`Акт № ${documentNumber}`}
        avatar={
          <div
            aria-hidden
            className="flex size-14 items-center justify-center rounded-[14px] bg-muted text-muted-foreground"
          >
            <ClipboardList className="size-6" />
          </div>
        }
      >
        <span className="text-sm text-muted-foreground">{context}</span>
        <InventoryStatusBadge status={status} />
        {recountParent ? (
          <Link
            href={`/documents/inventory/${recountParent.id}/results`}
            className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatusBadge
              tone="info"
              icon={<RotateCcw />}
              tip="Акт пересчёта: позиции вынесены из другого акта на дату пересчёта"
              className="hover:bg-brand/15"
            >
              Пересчёт по акту № {recountParent.documentNumber}
            </StatusBadge>
          </Link>
        ) : null}
        {reopenedAfterProcessed ? (
          <StatusBadge
            tone="warning"
            icon={<AlertTriangle />}
            tip="Проведённый акт переоткрывали и правили итоги: суммы могут расходиться с Quick Resto"
          >
            Итоги правились после проведения
          </StatusBadge>
        ) : null}
      </ProfileHeader>

      <Tabs value={activeTab} onValueChange={(value) => router.push(tabHref[value as Tab])}>
        <ProfileTabsList aria-label="Разделы акта">
          <TabsTrigger value="overview">Основное</TabsTrigger>
          {canFill ? <TabsTrigger value="form">Форма</TabsTrigger> : null}
          {canViewResults ? (
            resultsAvailable ? (
              <TabsTrigger value="results">Итоги</TabsTrigger>
            ) : (
              // Подсказка на обёртке: у неактивной вкладки нет событий мыши.
              <span data-tip="Итоги появятся, когда акт заполнят и отправят на проверку" className="inline-flex shrink-0">
                <TabsTrigger value="results" disabled>
                  Итоги
                </TabsTrigger>
              </span>
            )
          ) : null}
          {canViewJournal ? <TabsTrigger value="history">Журнал</TabsTrigger> : null}
          {canDelete ? <TabsTrigger value="danger">Опасная зона</TabsTrigger> : null}
        </ProfileTabsList>
      </Tabs>
    </div>
  );
}
