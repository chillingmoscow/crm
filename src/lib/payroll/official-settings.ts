/** Настройки официальной зарплаты заведения: варианты месяца и проверка формы. */

export type OfficialSettingsForm = {
  /** 1-е число месяца (`YYYY-MM-01`) или "" — не учитывать. */
  from: string;
  payDay: string;
  bankId: string;
};

const monthName = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  const name = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
};

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

/** Месяцы от начала расчёта зарплаты до года вперёд; сохранённый вне диапазона остаётся в списке. */
export function officialMonthOptions(startsOn: string, current: string, today: string) {
  const [sy, sm] = monthStart(startsOn).split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = sy * 12 + sm - 1; i <= ty * 12 + tm - 1 + 12; i++) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`);
  }
  if (current && !out.includes(current)) out.push(current);
  out.sort();
  return [
    { value: "", label: "Не проводить автоматически" },
    ...out.map((value) => ({ value, label: monthName(value) })),
  ];
}

/** Текст ошибки или null. Зеркалит проверки сервера, чтобы не ходить за очевидным отказом. */
export function validateOfficialForm(
  form: OfficialSettingsForm,
  startsOn: string,
  checkingBankIds: string[],
): string | null {
  if (form.from) {
    if (!/^\d{4}-\d{2}-01$/.test(form.from)) return "Месяц начала — с первого числа";
    if (form.from < monthStart(startsOn))
      return "Официальные выплаты не могут начинаться раньше начала расчёта зарплаты";
  }
  const day = Number(form.payDay);
  if (!/^\d+$/.test(form.payDay.trim()) || !Number.isInteger(day) || day < 1 || day > 28)
    return "День проведения — число от 1 до 28";
  if (form.bankId && !checkingBankIds.includes(form.bankId))
    return "Выберите расчётный счёт заведения";
  return null;
}

export const sameOfficialForm = (a: OfficialSettingsForm, b: OfficialSettingsForm) =>
  a.from === b.from && a.payDay.trim() === b.payDay.trim() && a.bankId === b.bankId;
