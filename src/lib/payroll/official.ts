// Официальная (бухгалтерская) часть зарплаты: НДФЛ и подписи ожидаемой части.
// Чистые функции: те же числа, что считает база (payroll_official_gross).
import type { OfficialExpected } from "./types.ts";

const cents = (n: number) => Math.round(n * 100);

/** НДФЛ 13% до рубля, как `round(gross * 0.13, 0)` в базе (половина — от нуля). */
export function officialTax(gross: number): number {
  const units = cents(gross) * 13; // десятитысячные доли рубля, целое число
  const tax = Math.floor((Math.abs(units) + 5000) / 10000);
  return units < 0 ? -tax : tax;
}

/** На руки: оклад минус НДФЛ. */
export function officialNet(gross: number): number {
  return (cents(gross) - officialTax(gross) * 100) / 100;
}

/**
 * Оклад с налогом по сумме на руки: `net / 0,87` до копеек, затем ближайшая
 * сумма, у которой на руки выходит ровно `net`. Расхождение из-за рубля
 * налога не больше 58 копеек, поэтому хватает поиска ±1 ₽.
 */
export function officialGrossFromNet(net: number): number {
  const start = cents(net / 0.87);
  const target = cents(net);
  for (let step = 0; step <= 100; step++)
    for (const candidate of step ? [start - step, start + step] : [start])
      if (cents(officialNet(candidate / 100)) === target) return candidate / 100;
  return start / 100;
}

/** «до 7 декабря» для ноября: бухгалтерия платит до 7-го следующего месяца. */
export function officialPayBy(month: string): string {
  const date = new Date(`${month.slice(0, 7)}-07T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return `до ${date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

export type OfficialExpectedView = {
  amount: number | null;
  kind: OfficialExpected["kind"];
  days_paid: number | null;
  days_in_month: number;
};

const daysWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "дня" : "дней");

/**
 * Пояснение к ожидаемой части месяца: «выплатит бухгалтерия до 7 декабря»,
 * в первом месяце — «за 28 из 30 дней · …», в последнем — «сумма уточняется».
 */
export function officialExpectedNote(expected: OfficialExpectedView, month: string): string {
  if (expected.amount === null) return "сумма уточняется";
  const payBy = `выплатит бухгалтерия ${officialPayBy(month)}`;
  if (expected.kind === "first" && expected.days_paid !== null)
    return `за ${expected.days_paid} из ${expected.days_in_month} ${daysWord(expected.days_in_month)} · ${payBy}`;
  return payBy;
}
