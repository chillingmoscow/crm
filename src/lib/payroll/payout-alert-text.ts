// Тексты карточек «Финансы → На разбор» по выплатам зарплаты (план выплат,
// этап 3). Чистые функции — их гоняет node --test.

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** «65 000 ₽», с копейками — «7 500,50 ₽». */
export const rub = (n: number) => {
  const digits = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2;
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n).replace(/\s/g, " ")} ₽`;
};

/** «05.12». */
export const dayLabel = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? "месяц";

export type AlertText = { title: string; lines: string[] };

/** Выдача дня не сошлась с изъятием из кассы. */
export function reconcileAlert(input: {
  date: string;
  issued: number;
  withdrawn: number;
  lines: { name: string; amount: number }[];
}): AlertText {
  return {
    title: `Проверьте выдачу ${dayLabel(input.date)}: проведено ${rub(input.issued)}, изъято ${rub(input.withdrawn)}`,
    lines: [
      ...input.lines.map((l) => `${l.name} — ${rub(l.amount)}`),
      "В Quick Resto не нашлось изъятия на сумму выдачи. Если изъятие сделали иначе — нажмите «Всё верно», если выдали не всё — исправьте выплату в «Зарплате».",
    ],
  };
}

/** Наличных не хватило, а смен в окне выплаты больше нет. */
export function shortAlert(date: string, rows: { name: string; amount: number }[]): AlertText {
  return {
    title: `Не хватило наличных ${dayLabel(date)}`,
    lines: [
      ...rows.map((r) => `${r.name} — не выдано ${rub(r.amount)}`),
      "Смен в окне выплаты больше нет. Выберите другой день в плане или выдайте вручную.",
    ],
  };
}

/** Автовыдача дня не прошла (нет данных о наличных, не настроен счёт и т. п.). */
export function failedAlert(date: string, reason: string, waiting: string[]): AlertText {
  return {
    title: `Выдача по плану ${dayLabel(date)} не прошла`,
    lines: [reason, waiting.length ? `Ждут выдачи: ${waiting.join(", ")}.` : null, "Выдайте вручную кнопкой «Выдать сейчас» в плане выплат."]
      .filter((x): x is string => !!x),
  };
}

/** Сотрудников перевели на другой график после утверждения плана. */
export function movedScheduleAlert(date: string, names: string[]): AlertText {
  return {
    title: `Выдача по плану ${dayLabel(date)}: не всем`,
    lines: [`На другом графике выплат, по плану не выдано: ${names.join(", ")}.`],
  };
}

/** Telegram не принял сообщение менеджерам — текст для копирования. */
export function messageAlert(date: string): AlertText {
  return {
    title: `Сообщение менеджерам ${dayLabel(date)} не отправлено`,
    lines: ["Выплаты проведены. Отправьте сообщение в чат менеджеров сами."],
  };
}

/** Перенос остатка месяца ждёт уже три дня после окна второй выплаты. */
export function carryAlert(month: string, reasons: { name: string; reason: string }[]): AlertText {
  return {
    title: `Перенос остатка за ${monthName(month)} ждёт`,
    lines: [
      ...reasons.map((r) => `${r.name} — ${r.reason}`),
      "Остаток перенесётся сам на следующее утро после того, как причина уйдёт.",
    ],
  };
}

/** Выплата переводом (по счёту) не внесена после окна выплаты. */
export function transferAlert(input: { month: string; payoutNo: 1 | 2; name: string; amount: number }): AlertText {
  const which = input.payoutNo === 2 ? "Вторая" : "Первая";
  return {
    title: `Выплата переводом не внесена: ${input.name}`,
    lines: [
      `${which} выплата за ${monthName(input.month)} — ${rub(input.amount)}.`,
      "Окно выплаты прошло, а выплаты за этот месяц нет. Оплатите счёт и внесите выплату в «Зарплате».",
    ],
  };
}

/** Итоги KPI за прошлый месяц не подведены (KPI старших). */
export function kpiAlert(month: string, people: { name: string; role: string }[]): AlertText {
  return {
    title: `KPI за ${monthName(month)} ${month.slice(0, 4)} не подведены`,
    lines: people.map((p) => `${p.name} — ${p.role}`),
  };
}

/** Плана продаж алкоголя на текущий месяц нет, а KPI старших от него зависят. */
export function kpiPlanAlert(month: string): AlertText {
  return {
    title: `План продаж алкоголя на ${monthName(month)} ${month.slice(0, 4)} не задан`,
    lines: ["Задайте план во вкладке «KPI» зарплаты"],
  };
}
