import type { ComponentType } from "react";
import { NotificationsHelp } from "@/app/(dashboard)/notifications/notifications-help";
import { PayrollHelp } from "@/app/(dashboard)/people/payroll/_components/payroll-help";
import { StaffHelp } from "@/app/(dashboard)/people/staff/_components/staff-help";
import { CandidatesHelp } from "@/app/(dashboard)/people/candidates/_components/candidates-help";

import { SalesShiftsHelp } from "@/app/(dashboard)/sales/shifts/_components/sales-shifts-help";

import { InventoryActsHelp } from "@/app/(dashboard)/documents/inventory/_components/inventory-acts-help";

/**
 * Реестр контекстной справки для кнопки «?» в топ-баре (page-help-button).
 * Один источник правды: какой странице какая справка соответствует.
 *
 * Чтобы добавить справку новому разделу:
 *   1) положить контент рядом с фичей как React-компонент (см.
 *      InventoryActsHelp как образец);
 *   2) дописать сюда запись с match по pathname + title + Content.
 *
 * (MDX/handbook-driven контент — отдельная инициатива «/help», см.
 *  memory documents_help_button_todo.)
 */
export type PageHelpEntry = {
  /** Совпадение по текущему pathname. */
  match: (pathname: string) => boolean;
  /** Заголовок панели. */
  title: string;
  /** Контент справки. */
  Content: ComponentType;
};

export const PAGE_HELP_ENTRIES: PageHelpEntry[] = [
  { match: p => p === "/people/staff", title: "Сотрудники", Content: StaffHelp },
  { match: p => p === "/people/candidates" || p.startsWith("/people/candidates/"), title: "Кандидаты", Content: CandidatesHelp },
  { match: p => p === "/notifications", title: "Уведомления", Content: NotificationsHelp },
  {
    match: (p) => p === "/people/payroll" || p.startsWith("/people/payroll/"),
    title: "Зарплата",
    Content: PayrollHelp,
  },
  {
    match: (p) => p === "/sales/shifts",
    title: "Смены",
    Content: SalesShiftsHelp,
  },
  {
    match: (p) =>
      p === "/documents/inventory" || p.startsWith("/documents/inventory/"),
    title: "Акты инвентаризации",
    Content: InventoryActsHelp,
  },
];

/** Справка для текущего пути или null, если её нет. */
export function resolvePageHelp(pathname: string): PageHelpEntry | null {
  return PAGE_HELP_ENTRIES.find((entry) => entry.match(pathname)) ?? null;
}
