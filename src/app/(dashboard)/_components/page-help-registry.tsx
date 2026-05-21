import type { ComponentType } from "react";

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
  {
    match: (p) => p === "/documents/inventory" || p.startsWith("/documents/inventory/"),
    title: "Акты инвентаризации",
    Content: InventoryActsHelp,
  },
];

/** Справка для текущего пути или null, если её нет. */
export function resolvePageHelp(pathname: string): PageHelpEntry | null {
  return PAGE_HELP_ENTRIES.find((entry) => entry.match(pathname)) ?? null;
}
