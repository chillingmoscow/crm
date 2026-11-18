import type { MouseEvent } from "react";

/**
 * Переход по строке (или карточке на телефоне) только от клика по ней самой:
 * не по кнопке, ссылке, полю, подписи или флажку внутри, не по служебной
 * ячейке (выбор, «⋯» — `data-control-cell`) и не из портала. React доставляет
 * события из порталов (панели, меню, диалоги, открытые из ячейки) по дереву
 * компонентов — до строки, хотя в DOM их там нет: без проверки `contains`
 * клик внутри открытой из строки панели уводил на карточку.
 */
export function isRowNavigationClick(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target)) return false;
  return !target.closest(
    "button,a,input,textarea,select,label,[role=checkbox],[role=menuitem],[data-control-cell]",
  );
}
