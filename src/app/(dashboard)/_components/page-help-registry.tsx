import type { ComponentType } from "react";
import { NotificationsHelp } from "@/app/(dashboard)/notifications/notifications-help";
import { PayrollHelp } from "@/app/(dashboard)/people/payroll/_components/payroll-help";
import { StaffHelp } from "@/app/(dashboard)/people/staff/_components/staff-help";
import { CandidatesHelp } from "@/app/(dashboard)/people/candidates/_components/candidates-help";
import { RolesHelp } from "@/app/(dashboard)/people/roles/_components/roles-help";
import { DepartmentsHelp } from "@/app/(dashboard)/people/departments/_components/departments-help";
import { LegalEntitiesHelp } from "@/app/(dashboard)/org/legal-entities/_components/legal-entities-help";
import { VenuesHelp } from "@/app/(dashboard)/org/venues/_components/venues-help";
import { AttendanceHelp } from "@/app/(dashboard)/schedule/attendance/attendance-help";
import {
  ScheduleHelp,
  ScheduleTasksHelp,
  ScheduleTemplatesHelp,
} from "@/app/(dashboard)/schedule/_components/schedule-help";

import { SalesShiftsHelp } from "@/app/(dashboard)/sales/shifts/_components/sales-shifts-help";
import { SalesStatisticsHelp } from "@/app/(dashboard)/sales/statistics/statistics-help";
import { SalesAdditionalHelp } from "@/app/(dashboard)/sales/additional/additional-help";

import { IntegrationsHelp, OfficeCodesHelp, QuickRestoHelp, TelegramHelp, TildaHelp } from "@/app/(dashboard)/settings/integrations/_components/integrations-help";

import { InventoryActsHelp } from "@/app/(dashboard)/documents/inventory/_components/inventory-acts-help";
import { CatalogHelp } from "@/app/(dashboard)/catalog/_components/catalog-help";
import { WriteoffsHelp } from "@/app/(dashboard)/documents/writeoffs/_components/writeoffs-help";
import { AuditHelp } from "@/app/(dashboard)/org/audit/_components/audit-help";
import { StoresHelp } from "@/app/(dashboard)/org/stores/_components/stores-help";
import { GuestsHelp } from "@/app/(dashboard)/crm/guests/guests-help";
import { FinanceDashboardHelp } from "@/app/(dashboard)/finance/_components/finance-dashboard-help";
import { CategoriesHelp } from "@/app/(dashboard)/finance/categories/_components/categories-help";
import { CounterpartiesHelp } from "@/app/(dashboard)/finance/counterparties/_components/counterparties-help";
import { RulesHelp } from "@/app/(dashboard)/finance/rules/_components/rules-help";
import { AccountsHelp } from "@/app/(dashboard)/finance/accounts/_components/accounts-help";
import { SuppliesHelp } from "@/app/(dashboard)/documents/supplies/supplies-help";
import { TransactionsHelp } from "@/app/(dashboard)/finance/transactions/_components/transactions-help";
import { InboxHelp, RecurringHelp } from "@/app/(dashboard)/finance/recurring/_components/recurring-help";
import { KnowledgeHelp } from "@/app/(dashboard)/knowledge/_components/knowledge-help";
import { isKnowledgePath } from "@/lib/knowledge/shell";

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
  { match: p => p === "/settings/integrations", title: "Интеграции", Content: IntegrationsHelp },
  { match: p => p === "/settings/integrations/tilda", title: "Tilda", Content: TildaHelp },
  { match: p => p === "/settings/integrations/telegram", title: "Telegram", Content: TelegramHelp },
  { match: p => p === "/settings/integrations/quickresto", title: "Quick Resto", Content: QuickRestoHelp },
  { match: p => p === "/settings/integrations/office-codes", title: "Коды замка", Content: OfficeCodesHelp },
  // Список и карточка раздела делят одну справку (docs/design-system.md,
  // «Top bar → Когда что показывать»).
  { match: p => p === "/people/staff" || p.startsWith("/people/staff/"), title: "Сотрудники", Content: StaffHelp },
  { match: p => p === "/people/candidates" || p.startsWith("/people/candidates/"), title: "Кандидаты", Content: CandidatesHelp },
  { match: p => p === "/people/roles" || p.startsWith("/people/roles/"), title: "Должности", Content: RolesHelp },
  { match: p => p === "/people/departments" || p.startsWith("/people/departments/"), title: "Подразделения", Content: DepartmentsHelp },
  { match: p => p === "/org/stores", title: "Склады", Content: StoresHelp },
  { match: p => p === "/crm/guests", title: "Гости", Content: GuestsHelp },
  { match: p => p === "/finance/accounts" || p.startsWith("/finance/accounts/"), title: "Счета и кассы", Content: AccountsHelp },
  { match: p => p === "/documents/supplies", title: "Приходные накладные", Content: SuppliesHelp },
  { match: p => p === "/finance/transactions", title: "Транзакции", Content: TransactionsHelp },
  { match: p => p === "/finance/inbox", title: "На разбор", Content: InboxHelp },
  { match: p => p === "/finance/recurring", title: "Повторяющиеся платежи", Content: RecurringHelp },
  { match: p => p === "/notifications", title: "Уведомления", Content: NotificationsHelp },
  { match: p => isKnowledgePath(p), title: "База знаний", Content: KnowledgeHelp },
  { match: p => p === "/org/legal-entities" || p.startsWith("/org/legal-entities/"), title: "Юридические лица", Content: LegalEntitiesHelp },
  // /org/venues/[id]/payroll — «Условия оплаты», к ним относится справка «Зарплаты» ниже.
  { match: p => p === "/org/venues" || (p.startsWith("/org/venues/") && !p.endsWith("/payroll")), title: "Заведения", Content: VenuesHelp },
  { match: (p) => p === "/schedule", title: "Расписание", Content: ScheduleHelp },
  { match: (p) => p === "/schedule/templates", title: "Шаблоны смен", Content: ScheduleTemplatesHelp },
  { match: (p) => p === "/schedule/tasks", title: "Задачи", Content: ScheduleTasksHelp },
  { match: (p) => p === "/schedule/attendance", title: "Сверка отметок", Content: AttendanceHelp },
  {
    // Ведомость — /people/payroll, расчёт сотрудника — /people/payroll/[id],
    // условия оплаты заведения — /org/venues/[id]/payroll.
    match: (p) =>
      p === "/people/payroll" ||
      p.startsWith("/people/payroll/") ||
      /^\/org\/venues\/[^/]+\/payroll$/.test(p),
    title: "Зарплата",
    Content: PayrollHelp,
  },
  {
    // Настройки продаж открываются из «Смен» и делят их справку.
    match: (p) => p === "/sales/shifts" || p === "/sales/settings",
    title: "Смены",
    Content: SalesShiftsHelp,
  },
  {
    match: (p) => p === "/sales/statistics",
    title: "Статистика",
    Content: SalesStatisticsHelp,
  },
  {
    match: (p) => p === "/sales/additional",
    title: "Допродажи",
    Content: SalesAdditionalHelp,
  },
  {
    match: (p) =>
      p === "/documents/inventory" || p.startsWith("/documents/inventory/"),
    title: "Акты инвентаризации",
    Content: InventoryActsHelp,
  },
  {
    // Три вида номенклатуры и их карточки делят одну справку.
    match: (p) => p.startsWith("/catalog/"),
    title: "Номенклатура",
    Content: CatalogHelp,
  },
  { match: (p) => p === "/documents/writeoffs", title: "Списания", Content: WriteoffsHelp },
  { match: (p) => p === "/org/audit", title: "Журнал событий", Content: AuditHelp },
  { match: (p) => p === "/finance", title: "Дашборд финансов", Content: FinanceDashboardHelp },
  { match: (p) => p === "/finance/categories", title: "Статьи", Content: CategoriesHelp },
  { match: (p) => p === "/finance/rules", title: "Правила", Content: RulesHelp },
  {
    match: (p) => p === "/finance/counterparties" || p.startsWith("/finance/counterparties/"),
    title: "Контрагенты",
    Content: CounterpartiesHelp,
  },
];

/** Справка для текущего пути или null, если её нет. */
export function resolvePageHelp(pathname: string): PageHelpEntry | null {
  return PAGE_HELP_ENTRIES.find((entry) => entry.match(pathname)) ?? null;
}
