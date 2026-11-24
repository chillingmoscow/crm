// Официальная часть в очереди «Финансы → На разбор»: месяц, который крон не
// провёл сам (payroll_official_months со status = 'review'). Чистые решения
// карточки: подписи по причине, дата и суммы по умолчанию, данные проведения.
// Последнее слово за базой (payroll_record_official_payment).
import { officialGrossFromNet, officialNet } from "./official.ts";
import { officialAmountsError, officialBankFor } from "./official-payment.ts";
import type { PayrollData } from "./types.ts";

export type OfficialReviewReason = "final_month" | "no_bank_account" | "no_category" | "inactive";

/** Карточка официальной части: строка месяца на разборе и имя сотрудника. */
export type OfficialReviewItem = {
  id: string;
  venue_id: string;
  employment_id: string;
  employee_id: string;
  employee_name: string;
  /** Пользователь приложения — для ссылки на карточку сотрудника. */
  employee_user_id: string | null;
  /** YYYY-MM-01 */
  month: string;
  kind: "full" | "first" | "final";
  /** Оклад с налогом за месяц; в месяц увольнения неизвестен. */
  gross: number | null;
  reason: OfficialReviewReason;
};

/** Настройки официальной зарплаты заведения, которые нужны карточке. */
export type OfficialReviewSettings = {
  payDay: number;
  bankAccountId: string | null;
};

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** «ноябрь»; год дописывается, только если он не текущий: «декабрь 2025». */
export function officialMonthName(month: string, today: string): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? month.slice(0, 7);
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
}

export const isOfficialReviewReason = (value: unknown): value is OfficialReviewReason =>
  value === "final_month" || value === "no_bank_account" || value === "no_category" || value === "inactive";

/** Заголовок карточки и пояснение под ним — по причине, по которой месяц не проведён. */
export function officialReviewCopy(item: Pick<OfficialReviewItem, "reason" | "employee_name" | "month">, today: string) {
  const month = officialMonthName(item.month, today);
  const name = item.employee_name;
  switch (item.reason) {
    case "final_month":
      return {
        title: `Окончательный расчёт: ${name}, ${month}`,
        hint: "Укажите сумму на руки: оклад с налогом посчитается сам",
      };
    case "no_bank_account":
      return {
        title: "Выберите расчётный счёт для официальных выплат",
        hint: `${name}, ${month}. В настройках оплаты труда заведения не выбран расчётный счёт по умолчанию, поэтому выплата не проведена сама`,
      };
    case "no_category":
      return {
        title: `Нет статьи расхода для официальной выплаты: ${name}`,
        hint: `${month}. У должности сотрудника нет статьи ФОТ. Укажите её в «Финансы → Статьи» и проведите выплату`,
      };
    case "inactive":
      return {
        title: `Проверьте официальное увольнение: ${name}`,
        hint: `${month}. Сотрудник уволен в приложении, а дата официального увольнения не указана. Поставьте её в карточке сотрудника («Уволить официально») или проведите окончательный расчёт здесь`,
      };
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** День выплаты за месяц: число `payDay` следующего месяца. */
export function officialPayDate(month: string, payDay: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
  const day = Math.min(Math.max(Math.trunc(payDay) || 5, 1), 28);
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

/**
 * Дата выплаты по умолчанию: день проведения за этот месяц, если он уже
 * наступил (как провёл бы крон), иначе сегодня — выплату задним числом
 * вперёд не ставим.
 */
export function officialReviewDefaultDate(month: string, payDay: number, today: string): string {
  const payDate = officialPayDate(month, payDay);
  return payDate <= today ? payDate : today;
}

/** Правки карточки, которые переживают переход стрелками к соседней. */
export type OfficialReviewDraft = {
  net: number | null;
  gross: number | null;
  /** Оклад с налогом поправили руками: ввод «на руки» его больше не пересчитывает. */
  grossTouched: boolean;
  bank_account_id: string;
  date: string;
};

export function initialOfficialDraft(
  item: Pick<OfficialReviewItem, "gross" | "month">,
  settings: OfficialReviewSettings,
  banks: PayrollData["banks"],
  today: string,
): OfficialReviewDraft {
  return {
    net: item.gross === null ? null : officialNet(item.gross),
    gross: item.gross,
    grossTouched: false,
    bank_account_id: officialBankFor(banks, null, settings.bankAccountId),
    date: officialReviewDefaultDate(item.month, settings.payDay, today),
  };
}

/** Ввели сумму на руки: оклад с налогом досчитывается, пока его не правили руками. */
export function withOfficialNet(draft: OfficialReviewDraft, net: number | null): OfficialReviewDraft {
  if (draft.grossTouched) return { ...draft, net };
  return { ...draft, net, gross: net === null || !(net > 0) ? null : officialGrossFromNet(net) };
}

/** Поправили оклад с налогом руками; пустое поле снова считается от суммы на руки. */
export function withOfficialGross(draft: OfficialReviewDraft, gross: number | null): OfficialReviewDraft {
  if (gross === null) return withOfficialNet({ ...draft, grossTouched: false }, draft.net);
  return { ...draft, gross, grossTouched: true };
}

export type OfficialResolveInput = {
  id: string;
  gross: number;
  net: number;
  bank_account_id: string;
  /** YYYY-MM-DD */
  date: string;
};

export type OfficialDraftErrors = { amount?: string; bank?: string; date?: string };

/** Данные для «Провести» или ошибки полей — те же проверки, что у базы. */
export function officialResolvePayload(
  item: Pick<OfficialReviewItem, "id">,
  draft: OfficialReviewDraft,
): { input: OfficialResolveInput; errors: null } | { input: null; errors: OfficialDraftErrors } {
  const errors: OfficialDraftErrors = {};
  const amount = officialAmountsError(draft.net, draft.gross);
  if (amount) errors.amount = amount;
  if (!draft.bank_account_id) errors.bank = "Выберите расчётный счёт";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Укажите дату выплаты";
  if (errors.amount || errors.bank || errors.date) return { input: null, errors };
  return {
    input: {
      id: item.id,
      gross: draft.gross as number,
      net: draft.net as number,
      bank_account_id: draft.bank_account_id,
      date: draft.date,
    },
    errors: null,
  };
}
