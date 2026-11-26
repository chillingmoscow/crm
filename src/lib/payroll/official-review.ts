// Официальная часть в очереди «Финансы → На разбор»: месяц, который крон не
// провёл сам (payroll_official_months со status = 'review'). Чистые решения
// карточки: подписи по причине, дата и суммы по умолчанию, данные проведения.
// Последнее слово за базой (payroll_record_official_payment).
import { officialGrossFromNet, officialNet } from "./official.ts";
import { agencyAmountError, checkingBanks, officialAmountsError } from "./official-payment.ts";
import type { PayrollData } from "./types.ts";

export type OfficialReviewReason = "final_month" | "no_bank_account" | "no_category" | "inactive" | "missed_month";

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
  /**
   * «Платит агентство»: карточка проводит запись «Получено через агентство» —
   * одна сумма и дата, без счёта и налога.
   */
  agency: boolean;
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

const REASONS: readonly OfficialReviewReason[] = ["final_month", "no_bank_account", "no_category", "inactive", "missed_month"];

export const isOfficialReviewReason = (value: unknown): value is OfficialReviewReason =>
  REASONS.includes(value as OfficialReviewReason);

/** Заголовок карточки и пояснение под ним — по причине, по которой месяц не проведён. */
export function officialReviewCopy(
  item: Pick<OfficialReviewItem, "reason" | "employee_name" | "month"> & { agency?: boolean },
  today: string,
) {
  const month = officialMonthName(item.month, today);
  const name = item.employee_name;
  if (item.agency) {
    // Счёта и статьи у записи через агентство нет — остаются только эти причины.
    switch (item.reason) {
      case "final_month":
        return {
          title: `Окончательный расчёт через агентство: ${name}, ${month}`,
          hint: "Укажите, сколько сотрудник получил через агентство за месяц увольнения",
        };
      case "inactive":
        return {
          title: `Проверьте официальное увольнение: ${name}`,
          hint: `${month}. Сотрудник уволен в приложении, а дата официального увольнения не указана. Поставьте её в карточке сотрудника («Уволить официально») или укажите здесь, сколько он получил через агентство`,
        };
      default:
        return {
          title: `Не отмечено получение через агентство: ${name}, ${month}`,
          hint: "Проверьте, получил ли сотрудник деньги через агентство, и проведите запись или пропустите месяц.",
        };
    }
  }
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
    case "missed_month":
      return {
        title: `Официальная часть не проведена: ${name}, ${month}`,
        hint: "Проверьте, выплатила ли бухгалтерия, и проведите выплату или пропустите месяц.",
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

/**
 * Счёт карточки по умолчанию — расчётный счёт из настроек заведения. Если
 * его нет (карточка «нет счёта») или он больше не расчётный, поле пустое:
 * счёт выбирает человек, первый попавшийся не подставляется.
 */
export function officialReviewBank(
  reason: OfficialReviewReason,
  settings: OfficialReviewSettings,
  banks: PayrollData["banks"],
): string {
  if (reason === "no_bank_account" || !settings.bankAccountId) return "";
  return checkingBanks(banks).some((b) => b.id === settings.bankAccountId) ? settings.bankAccountId : "";
}

export function initialOfficialDraft(
  item: Pick<OfficialReviewItem, "gross" | "month" | "reason"> & { agency?: boolean },
  settings: OfficialReviewSettings,
  banks: PayrollData["banks"],
  today: string,
): OfficialReviewDraft {
  return {
    net: item.gross === null ? null : item.agency ? item.gross : officialNet(item.gross),
    gross: item.gross,
    grossTouched: false,
    // Через агентство счёт не нужен.
    bank_account_id: item.agency ? "" : officialReviewBank(item.reason, settings, banks),
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
  /** Через агентство — null: запись без счёта. */
  bank_account_id: string | null;
  /** YYYY-MM-DD */
  date: string;
};

export type OfficialDraftErrors = { amount?: string; bank?: string; date?: string };

/** Данные для «Провести» или ошибки полей — те же проверки, что у базы. */
export function officialResolvePayload(
  item: Pick<OfficialReviewItem, "id"> & { agency?: boolean },
  draft: OfficialReviewDraft,
): { input: OfficialResolveInput; errors: null } | { input: null; errors: OfficialDraftErrors } {
  if (item.agency) {
    // Получено через агентство = закрыто по зарплате; поле одно — «на руки».
    const errors: OfficialDraftErrors = {};
    const amount = agencyAmountError(draft.net);
    if (amount) errors.amount = amount;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Укажите дату выплаты";
    if (errors.amount || errors.date) return { input: null, errors };
    const value = draft.net as number;
    return { input: { id: item.id, gross: value, net: value, bank_account_id: null, date: draft.date }, errors: null };
  }
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
