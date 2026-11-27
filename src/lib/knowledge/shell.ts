/**
 * Правила оболочки базы знаний, которые не зависят от React и Next:
 * когда меню приложения свёрнуто, как строится путь в верхней панели,
 * какие служебные пункты стоят в дереве. Спека —
 * docs/superpowers/specs/2026-11-27-kb-redesign-design.md, раздел «Оболочка».
 */

/** Cookie раскрытого меню приложения внутри базы знаний. Вне базы меню
 *  помнит своё состояние в `sidebar_state`; в базе по умолчанию оно
 *  свёрнуто в иконки, а выбор пользователя хранится здесь отдельно. */
export const KB_MENU_COOKIE = "kb_menu_state";

export function isKnowledgePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/knowledge" || pathname.startsWith("/knowledge/");
}

export function resolveMenuOpen(input: {
  onKnowledge: boolean;
  appOpen: boolean;
  kbOpen: boolean;
}): boolean {
  return input.onKnowledge ? input.kbOpen : input.appOpen;
}

/** Звено пути; совпадает по форме с `Crumb` из `components/shared/breadcrumbs`. */
export type Crumb = { label: string; href?: string };

export type KbChainItem = { slug: string; title: string | null };

const UNTITLED = "Без названия";
/** Больше трёх предков — середина пути сворачивается в «…». */
const MAX_FULL_ANCESTORS = 3;

function titleOf(item: KbChainItem): string {
  return item.title?.trim() || UNTITLED;
}

/** Путь документа: «База знаний / предки / текущая». `chain` — от корня
 *  к текущей странице (последний элемент — она сама). */
export function kbCrumbs(chain: KbChainItem[]): Crumb[] {
  const root: Crumb = { label: "База знаний", href: "/knowledge" };
  if (chain.length === 0) return [root];
  const current = chain[chain.length - 1];
  const ancestors = chain.slice(0, -1);
  const link = (item: KbChainItem): Crumb => ({
    label: titleOf(item),
    href: `/knowledge/${item.slug}`,
  });
  const middle =
    ancestors.length > MAX_FULL_ANCESTORS
      ? [link(ancestors[0]), { label: "…" }, link(ancestors[ancestors.length - 1])]
      : ancestors.map(link);
  return [root, ...middle, { label: titleOf(current) }];
}

export type KbTreeServiceItem = {
  key: "home" | "overview" | "to-read" | "trash";
  label: string;
  href: string;
  count?: number;
};

/** Служебные пункты дерева: сверху — «Главная», «Обзор», «К прочтению»,
 *  внизу — «Корзина». Пункт без права или без смысла не показывается. */
export function kbTreeServiceItems(input: {
  canViewOverview: boolean;
  canSeeTrash: boolean;
  requiredTotal: number;
  requiredUnread: number;
}): { top: KbTreeServiceItem[]; bottom: KbTreeServiceItem[] } {
  const top: KbTreeServiceItem[] = [
    { key: "home", label: "Главная", href: "/knowledge" },
  ];
  if (input.canViewOverview) {
    top.push({ key: "overview", label: "Обзор", href: "/knowledge/dashboard" });
  }
  if (input.requiredTotal > 0) {
    top.push({
      key: "to-read",
      label: "К прочтению",
      href: "/knowledge#to-read",
      ...(input.requiredUnread > 0 ? { count: input.requiredUnread } : {}),
    });
  }
  const bottom: KbTreeServiceItem[] = input.canSeeTrash
    ? [{ key: "trash", label: "Корзина", href: "/knowledge/trash" }]
    : [];
  return { top, bottom };
}

/** Принимает ли зона строки дерева перетаскиваемую страницу. Ветка после
 *  первого раскрытия остаётся смонтированной (ради анимации), и у
 *  свёрнутой ветки невидимые строки лежат поверх соседей ниже: dnd-kit
 *  считает попадание по их прямоугольникам и уводил страницу внутрь
 *  свёрнутого раздела. Поэтому внутри свёрнутой ветки зоны выключены. */
export function kbDropZoneDisabled(input: {
  isBlocked: boolean;
  isDraggingAny: boolean;
  insideCollapsed: boolean;
}): boolean {
  return input.isBlocked || !input.isDraggingAny || input.insideCollapsed;
}

/** Кому открыт «Обзор» базы знаний: аналитика, обязательное чтение или
 *  журнал. Один источник для пункта дерева и проверки на странице —
 *  иначе пункт видели те, кого страница отправляла обратно. Блоки внутри
 *  «Обзора» проверяют своё право сами. */
export function canOpenKbOverview(permissions: ReadonlySet<string>): boolean {
  return (
    permissions.has("kb.view_analytics") ||
    permissions.has("kb.manage_required_reading") ||
    permissions.has("org.view_audit")
  );
}
