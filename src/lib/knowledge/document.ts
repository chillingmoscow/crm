/**
 * Правила страницы-документа базы знаний, не зависящие от React: что
 * показывает плашка обязательного чтения и из чего состоит меню «⋯».
 * Спека — docs/superpowers/specs/2026-11-27-kb-redesign-design.md, «Документ».
 */

export type KbReadingPlate =
  | { kind: "none" }
  | { kind: "unread"; reread: boolean; canConfirm: boolean }
  | { kind: "read"; readAt: string };

export function kbReadingPlate(input: {
  required: boolean;
  /** Когда пользователь подтвердил прочтение текущей версии. */
  readAt: string | null;
  /** Страница изменилась после прежнего прочтения. */
  needsReread: boolean;
  /** Пройден ли порог активного чтения для кнопки «Прочитано». */
  gateReady: boolean;
}): KbReadingPlate {
  if (!input.required) return { kind: "none" };
  if (input.readAt && !input.needsReread) return { kind: "read", readAt: input.readAt };
  return { kind: "unread", reread: input.needsReread, canConfirm: input.gateReady };
}

export type KbPageMenuKey =
  | "template"
  | "show-children"
  | "required"
  | "lock"
  | "duplicate"
  | "export"
  | "import"
  | "history"
  | "delete";

/**
 * Пункты меню «⋯» документа по группам (между группами — разделитель).
 * Избранное — звёздочкой в панели, «О странице» и статистика — в ⓘ,
 * «Кто прочитал» — на плашке чтения, отмена и повтор — ⌘Z / ⌘⇧Z; в
 * меню их нет. Каждый пункт — по своему праву, как и раньше.
 */
export function kbPageMenuGroups(rights: {
  canEdit: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canExport: boolean;
  canImport: boolean;
  canManageTemplates: boolean;
  canManageRequiredReading: boolean;
  canLock: boolean;
  canViewVersionHistory: boolean;
}): KbPageMenuKey[][] {
  const pick = (...items: [KbPageMenuKey, boolean][]) =>
    items.filter(([, on]) => on).map(([key]) => key);
  return [
    pick(["template", rights.canManageTemplates]),
    pick(["show-children", rights.canEdit]),
    pick(["required", rights.canManageRequiredReading], ["lock", rights.canLock]),
    pick(["duplicate", rights.canDuplicate]),
    pick(["export", rights.canExport], ["import", rights.canImport]),
    pick(["history", rights.canViewVersionHistory]),
    pick(["delete", rights.canDelete]),
  ].filter((group) => group.length > 0);
}
