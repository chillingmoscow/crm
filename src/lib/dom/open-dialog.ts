/**
 * Открыто ли сейчас другое окно или боковая панель (Radix ставит открытым
 * `role="dialog"` / `role="alertdialog"` и `data-state="open"`), кроме
 * помеченного атрибутом `ownAttr`.
 *
 * Глобальные сочетания (⌘K палитры и поиска базы знаний) поверх чужого окна
 * не срабатывают: иначе одно окно открывается поверх другого, и фокус
 * оказывается в двух ловушках сразу.
 */
export function anotherDialogOpen(ownAttr: string): boolean {
  if (typeof document === "undefined") return false;
  return Array.from(
    document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'),
  ).some((el) => !el.hasAttribute(ownAttr));
}
