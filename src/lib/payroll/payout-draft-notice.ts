// Текст уведомления о черновике плана выплат: какая выплата, сколько и кому.
// Чистая функция — её гоняет node --test.

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const rub = (n: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n).replace(/ /g, " ")} ₽`;

/** «сотруднику» / «сотрудникам» — дательный падеж. */
const toPeople = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "сотруднику" : "сотрудникам");

export function payoutDraftNotice(input: { month: string; payoutNo: 1 | 2; total: number; people: number }): { title: string; body: string } {
  const month = MONTHS[Number(input.month.slice(5, 7)) - 1] ?? "месяц";
  const which = input.payoutNo === 2 ? "вторая" : "первая";
  return {
    title: `Сформирован план: ${which} выплата за ${month}`,
    body: input.people > 0
      ? `К выплате ${rub(input.total)} — ${input.people} ${toPeople(input.people)}. Проверьте и утвердите.`
      : "По расчёту выдавать некому. Проверьте план.",
  };
}
