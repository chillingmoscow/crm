/**
 * Тексты пунктов очереди «Требует внимания» на главной. Чистые функции —
 * склонения проверяет `node --test`, а серверный сбор данных
 * (`attention.ts`) остаётся без текстовой логики.
 */

import { countRu, pluralRu } from "../format/plural.ts";

/** Источник пункта очереди. Порядок массива — порядок в очереди. */
export const ATTENTION_KINDS = [
  "quickresto_sync",
  "finance_inbox",
  "unassigned_shifts",
  "attendance",
  "candidates",
  "inventory_acts",
  "payout_plan",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type AttentionTone = "danger" | "warning" | "info" | "neutral";

export type AttentionItem = {
  kind: AttentionKind;
  /** Сколько дел за пунктом — для счётчиков в меню. У состояний (сбой, план) — 1. */
  count: number;
  tone: AttentionTone;
  title: string;
  detail: string | null;
  href: string;
  /** Подпись кнопки действия: глагол. */
  action: string;
};

const MONTHS_GENITIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** «3 платежа ждут разбора». */
export function financeInboxTitle(count: number): string {
  return `${countRu(count, "платёж", "платежа", "платежей")} ${pluralRu(count, "ждёт", "ждут", "ждут")} разбора`;
}

/** «2 новые анкеты кандидатов». */
export function candidatesTitle(count: number): string {
  return `${countRu(count, "новая анкета", "новые анкеты", "новых анкет")} кандидатов`;
}

/** «4 смены без сотрудника». */
export function unassignedShiftsTitle(count: number): string {
  return `${countRu(count, "смена", "смены", "смен")} без сотрудника`;
}

/** «На ближайшие 3 дня». */
export function nextDaysText(days: number): string {
  return `На ${pluralRu(days, "ближайший", "ближайшие", "ближайшие")} ${countRu(days, "день", "дня", "дней")}`;
}

/** «3 выхода ждут проверки». */
export function attendanceTitle(count: number): string {
  return `${countRu(count, "выход ждёт", "выхода ждут", "выходов ждут")} проверки`;
}

/** «2 акта инвентаризации не проведены». */
export function inventoryActsTitle(count: number): string {
  return `${countRu(count, "акт", "акта", "актов")} инвентаризации ${pluralRu(count, "не проведён", "не проведены", "не проведены")}`;
}

/** «Из них 1 ждёт проверки» / `null`, если проверки никто не ждёт. */
export function inventoryReviewDetail(ready: number, total: number): string | null {
  if (ready <= 0) return null;
  const waits = pluralRu(ready, "ждёт", "ждут", "ждут");
  return ready === total ? `${ready === 1 ? "Акт" : "Все"} ${waits} проверки` : `Из них ${ready} ${waits} проверки`;
}

/** «вторая выплата за ноябрь». */
export function payoutName(month: string, payoutNo: number): string {
  const name = MONTHS_GENITIVE[Number(month.slice(5, 7)) - 1] ?? "месяц";
  return `${payoutNo === 2 ? "вторая" : "первая"} выплата за ${name}`;
}

/** «8 сотрудникам». */
export function peopleDative(count: number): string {
  return `${count.toLocaleString("ru-RU")} ${count % 10 === 1 && count % 100 !== 11 ? "сотруднику" : "сотрудникам"}`;
}

/** Первая буква заглавная: «вторая выплата» → «Вторая выплата». */
export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
