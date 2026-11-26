// Ручная официальная выплата и смена расчётного счёта: чистые решения для
// формы выплаты и таблицы «Выплаты». Проверки зеркалят базу
// (payroll_record_official_payment, payroll_official_change_account), чтобы
// не отправлять заведомый отказ; последнее слово всё равно за базой.
import { officialNet } from "./official.ts";
import type { Allocation, OfficialEmploymentSpan, OfficialExpected, Payment, PayrollData } from "./types.ts";

/** Права на проведение официальной выплаты (как payroll_record_official_payment). */
export const canRecordOfficialPayment = (permissions: string[]) =>
  permissions.includes("payroll.pay") && permissions.includes("finance.create_transaction");

/** Смена счёта удаляет прежнюю операцию — нужно ещё право на удаление. */
export const canChangeOfficialAccount = (permissions: string[]) =>
  canRecordOfficialPayment(permissions) && permissions.includes("finance.delete_transaction");

/** Только расчётные счета: официальную выплату база проводит лишь с них. */
export const checkingBanks = (banks: PayrollData["banks"]) => banks.filter((b) => b.type === "checking");

/**
 * Счёт для официальной выплаты: счёт, который пользователь сам выбрал для
 * неё (`picked`), если он расчётный, иначе счёт по умолчанию из настроек,
 * иначе первый расчётный. "" — расчётных нет. Счёт обычной выплаты сюда не
 * передаётся: форма ставит его первым из списка, а не по выбору человека.
 */
export function officialBankFor(banks: PayrollData["banks"], picked: string | null, preferred?: string | null): string {
  const checking = checkingBanks(banks);
  if (picked && checking.some((b) => b.id === picked)) return picked;
  if (preferred && checking.some((b) => b.id === preferred)) return preferred;
  return checking[0]?.id ?? "";
}

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/** Период оформления, который покрывает месяц, — то же условие, что в базе. */
export function officialEmploymentFor(
  spans: OfficialEmploymentSpan[],
  employeeId: string,
  month: string,
): OfficialEmploymentSpan | null {
  const start = `${month.slice(0, 7)}-01`;
  const end = nextMonth(start);
  return (
    spans.find(
      (s) => s.employee_id === employeeId && s.starts_on < end && (s.ends_on === null || s.ends_on >= start),
    ) ?? null
  );
}

export type OfficialPaymentOption =
  | { available: false }
  | {
      available: true;
      employmentId: string;
      /** «Платит агентство»: запись «Получено через агентство» без счёта и налога. */
      agency: boolean;
      /** Почему провести нельзя (уже проведена); null — можно. */
      blocked: string | null;
      /** Подстановка сумм: ожидаемая часть месяца или удалённая выплата за него. */
      gross: number | null;
      net: number | null;
    };

/**
 * Можно ли в форме включить «Официальная часть»: ровно один получатель и у
 * него есть период оформления на выбранный месяц. Период берётся из периодов
 * заведения, а если их нет в данных — из ожидаемой части месяца.
 */
export function officialPaymentOption(input: {
  employeeIds: string[];
  month: string;
  employments: OfficialEmploymentSpan[];
  expected: OfficialExpected[];
  payments: Payment[];
  allocations: Allocation[];
}): OfficialPaymentOption {
  if (input.employeeIds.length !== 1) return { available: false };
  const [employeeId] = input.employeeIds;
  const month = `${input.month.slice(0, 7)}-01`;
  const span = officialEmploymentFor(input.employments, employeeId, month);
  const expectedOfEmployee = input.expected.find((e) => e.employee_id === employeeId && e.month === month);
  const employmentId = span?.id ?? expectedOfEmployee?.employment_id;
  if (!employmentId) return { available: false };
  const agency = span ? span.agency === true : expectedOfEmployee?.agency === true;
  // Через агентство налога нет: на руки = закрыто по зарплате.
  const netOf = (gross: number) => (agency ? gross : officialNet(gross));

  const official = input.payments.filter(
    (p) =>
      p.official_month === month &&
      input.allocations.some((a) => a.payment_id === p.id && a.employee_id === employeeId),
  );
  if (official.some((p) => p.state === "posted"))
    return {
      available: true,
      employmentId,
      agency,
      blocked: "За этот месяц уже проведена официальная выплата",
      gross: null,
      net: null,
    };

  const expected = input.expected.find((e) => e.employment_id === employmentId && e.month === month);
  if (expected && expected.gross !== null)
    return { available: true, employmentId, agency, blocked: null, gross: expected.gross, net: netOf(expected.gross) };

  // Повтор после удаления: те же суммы, что у последней удалённой выплаты месяца.
  const cancelled = official
    .filter((p) => p.state === "cancelled")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const allocation = cancelled && input.allocations.find((a) => a.payment_id === cancelled.id);
  if (allocation)
    return {
      available: true,
      employmentId,
      agency,
      blocked: null,
      gross: Number(allocation.settled_amount ?? allocation.amount),
      net: agency ? Number(allocation.settled_amount ?? allocation.amount) : Number(allocation.amount),
    };
  return { available: true, employmentId, agency, blocked: null, gross: null, net: null };
}

const cents = (n: number) => Math.round(n * 100);
const twoDecimals = (n: number) => Math.abs(n * 100 - cents(n)) < 0.00001;

/** Ошибка суммы записи «Получено через агентство» или null — как проверка базы. */
export function agencyAmountError(amount: number | null): string | null {
  if (amount === null || !(amount > 0)) return "Укажите сумму, которую сотрудник получил через агентство";
  if (amount > 1e9 || !twoDecimals(amount)) return "Не больше двух знаков после запятой";
  return null;
}

/** Текст ошибки сумм официальной выплаты или null — как проверки базы. */
export function officialAmountsError(net: number | null, gross: number | null): string | null {
  if (net === null || gross === null || !(net > 0) || !(gross > 0)) return "Укажите сумму на руки и оклад с налогом";
  if (gross > 1e9 || !twoDecimals(net) || !twoDecimals(gross)) return "Не больше двух знаков после запятой";
  if (cents(net) > cents(gross)) return "Сумма на руки больше оклада с налогом";
  return null;
}

/** НДФЛ в форме: оклад с налогом минус на руки, до копеек. */
export const officialTaxOf = (net: number | null, gross: number | null) =>
  net === null || gross === null ? null : (cents(gross) - cents(net)) / 100;
