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
