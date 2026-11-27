import { z } from "zod";

/**
 * Официальное трудоустройство в карточке сотрудника: проверка ввода перед
 * командой базы и названия файлов договора в «Документах». Чистые функции —
 * их проверяют тесты рядом (`official-employment.test.mts`).
 *
 * Проверка здесь повторяет проверки базы, чтобы до пользователя не доходили
 * технические ошибки приведения типов (битый uuid или дата).
 */

/** Календарная дата `ГГГГ-ММ-ДД`, которая существует (не 31.02). */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `03.11.2026` из `2026-11-03`. */
export function isoToCellDate(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}

/** Первое число месяца даты: `2026-11-03` → `2026-11-01`. */
export function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

const MAX_GROSS = 1_000_000_000;
const GROSS_ERROR = "Укажите оклад по договору больше нуля";

const id = (message: string) => z.string({ required_error: message, invalid_type_error: message }).uuid(message);
const date = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).refine(isIsoDate, message);
const optionalDate = (message: string) => z.string().refine(isIsoDate, message).nullable().optional();
const gross = z
  .number({ required_error: GROSS_ERROR, invalid_type_error: GROSS_ERROR })
  .finite(GROSS_ERROR)
  .positive(GROSS_ERROR)
  .max(MAX_GROSS, "Слишком большой оклад")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Не больше двух знаков после запятой");
const position = z
  .string({ required_error: "Укажите должность по договору", invalid_type_error: "Укажите должность по договору" })
  .trim()
  .min(1, "Укажите должность по договору")
  .max(200, "Должность по договору — до 200 символов");
const contractNumber = z.string().trim().max(50, "Номер договора — до 50 символов").nullable().optional();
const filePath = z.string().trim().min(1).max(500, "Проверьте файл").nullable().optional();
/** «Платит агентство»: сотрудник получает сумму в месяц через агентство, без налога. */
const agency = z.boolean({ invalid_type_error: "Укажите, платит ли агентство" }).optional();

export const employOfficiallySchema = z.object({
  employee_id: id("Сотрудник не найден в зарплате заведения"),
  starts_on: date("Укажите дату оформления"),
  position,
  gross,
  contract_number: contractNumber,
  contract_date: optionalDate("Проверьте дату договора"),
  contract_path: filePath,
  agency,
});
export type EmployOfficiallyInput = z.input<typeof employOfficiallySchema>;

export const updateOfficialEmploymentSchema = z.object({
  employment_id: id("Официальное оформление не найдено"),
  starts_on: date("Укажите дату оформления").optional(),
  position: position.optional(),
  contract_number: contractNumber,
  contract_date: optionalDate("Проверьте дату договора"),
  contract_path: filePath,
  agency,
});
export type UpdateOfficialEmploymentInput = z.input<typeof updateOfficialEmploymentSchema>;

export const changeOfficialSalarySchema = z.object({
  employment_id: id("Официальное оформление не найдено"),
  valid_from: date("Укажите, с какого месяца действует оклад").refine(
    (v) => v.endsWith("-01"),
    "Оклад меняется с первого числа месяца",
  ),
  gross,
  document_path: filePath,
});
export type ChangeOfficialSalaryInput = z.input<typeof changeOfficialSalarySchema>;

export const endOfficialEmploymentSchema = z.object({
  employment_id: id("Официальное оформление не найдено"),
  ends_on: date("Укажите дату официального увольнения"),
});
export type EndOfficialEmploymentInput = z.input<typeof endOfficialEmploymentSchema>;

export const officialEmploymentIdSchema = id("Официальное оформление не найдено");

/**
 * Дата официального увольнения в окне «Уволить сотрудника». Нужна, только
 * если человек оформлен официально (это проверяет база); без оформления
 * поле не передаётся. Пустое значение — «не указана».
 */
export const terminationOfficialEndSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null))
  .refine((v) => v === null || isIsoDate(v), "Проверьте дату официального увольнения");

/** Название файла договора в «Документах»: «Трудовой договор № 17 от 03.11.2026». */
export function contractDocumentName(number: string | null | undefined, date: string | null | undefined): string {
  const n = number?.trim();
  if (!n) return "Трудовой договор";
  return date && isIsoDate(date) ? `Трудовой договор № ${n} от ${isoToCellDate(date)}` : `Трудовой договор № ${n}`;
}

/** Название файла допсоглашения: «Допсоглашение от 01.12.2026» (с месяца нового оклада). */
export function salaryDocumentName(validFrom: string): string {
  return `Допсоглашение от ${isoToCellDate(validFrom)}`;
}

/**
 * Подпись суммы оформления: оклад по договору или, если платит агентство,
 * сколько сотрудник получает в месяц (без налога).
 */
export function officialAmountLabel(agency: boolean): string {
  return agency ? "Получает в месяц" : "Оклад по договору";
}

/** Строка договора в блоке: «№ 17 от 03.11.2026», «№ 17», «от 03.11.2026». */
export function contractLabel(number: string | null, date: string | null): string | null {
  const parts = [number?.trim() ? `№ ${number.trim()}` : null, date ? `от ${isoToCellDate(date)}` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export type OfficialSalaryVersion = { valid_from: string; gross: number };

/**
 * Оклад, действующий в месяце даты `on`, и ближайший будущий (если оклад
 * уже изменён с одного из следующих месяцев). Версии — «с месяца».
 */
export function officialSalaryOn(
  salaries: OfficialSalaryVersion[],
  on: string,
): { current: OfficialSalaryVersion | null; next: OfficialSalaryVersion | null } {
  const month = monthStart(on);
  const sorted = [...salaries].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  // Оформлен с будущего месяца — показываем первый оклад как текущий.
  const current = sorted.filter((s) => s.valid_from <= month).at(-1) ?? sorted[0] ?? null;
  const next = current ? sorted.find((s) => s.valid_from > current.valid_from && s.valid_from > month) ?? null : null;
  return { current, next };
}
