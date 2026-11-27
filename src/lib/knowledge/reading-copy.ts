import { countRu, pluralRu } from "../format/plural.ts";

/**
 * Тексты «Попросить перечитать» в одном месте: плашка документа, «Кто
 * прочитал» и «Обзор». `others` — сколько других сбросит и уведомит
 * кнопка, `self` — у самого руководителя прочитана старая версия (его
 * прочтение сбросится, но уведомления себе нет).
 */
export function kbRereadConfirmText(others: number, self: boolean): string {
  const othersText =
    others > 0
      ? `${countRu(others, "человек", "человека", "человек")} снова ${pluralRu(others, "увидит", "увидят", "увидят")} её в «К прочтению» и ${pluralRu(others, "получит", "получат", "получат")} уведомление.`
      : "";
  if (!self) return othersText || "Прочтения старых версий перестанут считаться.";
  return othersText
    ? `${othersText} Ваше прочтение тоже сбросится.`
    : "Ваше прочтение сбросится, страница снова появится у вас в «К прочтению».";
}

/** «2 человека», «вы», «вы и ещё 1 человек». */
export function kbStaleReadersText(others: number, self: boolean): string {
  const people = countRu(others, "человек", "человека", "человек");
  if (!self) return people;
  return others > 0 ? `вы и ещё ${people}` : "вы";
}
