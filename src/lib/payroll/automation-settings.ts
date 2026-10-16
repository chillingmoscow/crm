import { z } from "zod";
import defaults from "./automation-defaults.json";

const amount = z.number().finite().min(0).max(1e6);
const integer = (min: number, max: number) =>
  z.number().int().min(min).max(max);
const roles = z.array(z.string().trim().min(1).max(100)).min(1).max(30);
const monthDay = z.string().refine((value) => {
  if (value === "") return true; // Birthday uses the employee's date.
  if (!/^\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`2000-${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(5, 10) === value
  );
}, "Проверьте день и месяц");

export const automationSettingsSchema = z
  .object({
    medical: z
      .object({
        reminders: z.boolean(),
        reminder_after_hire_days: integer(0, 365),
        reminder_before_expiry_days: integer(0, 365),
        submission_fine: z.boolean(),
        submission_after_hire_months: integer(1, 36),
        submission_amount: amount,
        expiry_fine: z.boolean(),
        expiry_amount: amount,
        expiry_frequency: z.literal("once_per_expiry_case"),
        reimbursement: z.boolean(),
        reimbursement_amount: amount,
        reimbursement_after_exam_months: integer(0, 36),
        reimbursement_requires_exam_after_hire: z.boolean(),
      })
      .strict(),
    uniform: z
      .object({
        enabled: z.boolean(),
        installments: integer(1, 24),
        payment_days: z
          .array(integer(1, 28))
          .min(1)
          .max(4)
          .refine(
            (days) => days.every((day, i) => i === 0 || day > days[i - 1]),
            "Дни должны идти по возрастанию",
          ),
      })
      .strict(),
    tasks: z
      .object({
        missing_enabled: z.boolean(),
        missing_kind: z.enum(["deduction", "warning"]),
        missing_amount: amount,
        extra_reward_enabled: z.boolean(),
        extra_reward_medium: z.enum(["money", "bonus"]),
      })
      .strict(),
    gifts: z
      .object({
        enabled: z.boolean(),
        tenure_boundary_days: integer(1, 3650),
        holidays: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                name: z.string().trim().min(1).max(100),
                month_day: monthDay,
                junior_amount: amount,
                senior_amount: amount,
                roles,
                gender: z.enum(["all", "male", "female"]),
              })
              .strict(),
          )
          .max(30)
          .refine(
            (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
            "Повторяющийся праздник",
          ),
        tenure: z
          .array(
            z
              .object({
                days: integer(1, 36500),
                amount,
                discount_percent: integer(0, 100),
                roles,
              })
              .strict(),
          )
          .max(30)
          .refine(
            (rows) =>
              rows.every((r, i) => i === 0 || r.days > rows[i - 1].days),
            "Пороги стажа должны возрастать",
          ),
      })
      .strict(),
  })
  .strict();

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;
export const defaultAutomationSettings =
  automationSettingsSchema.parse(defaults);
export type AutomationSettingsRecord = {
  venue_id: string;
  version: number;
  config: AutomationSettings;
  updated_at: string | null;
};
export type AutomationSettingsRevision = AutomationSettingsRecord & {
  actor_name: string;
};

/** Human-readable, complete snapshot shared by the settings history and audit UI. */
export function automationSettingsLines(c: AutomationSettings): string[] {
  const yes = (value: boolean) => (value ? "да" : "нет");
  const m = c.medical,
    t = c.tasks;
  return [
    `Напоминания о медкнижке: ${yes(m.reminders)}`,
    `Первое напоминание: через ${m.reminder_after_hire_days} дней после приёма`,
    `Предупреждение о сроке: за ${m.reminder_before_expiry_days} дней`,
    `Непредоставленная книжка: ${yes(m.submission_fine)} · ${m.submission_amount} ₽ через ${m.submission_after_hire_months} мес.`,
    `Просрочка: ${yes(m.expiry_fine)} · ${m.expiry_amount} ₽ один раз за случай`,
    `Компенсация книжки: ${yes(m.reimbursement)} · ${m.reimbursement_amount} ₽ через ${m.reimbursement_after_exam_months} мес. после обследования`,
    `Обследование после приёма обязательно: ${yes(m.reimbursement_requires_exam_after_hire)}`,
    `Возмещение формы: ${yes(c.uniform.enabled)} · ${c.uniform.installments} частей · ${c.uniform.payment_days.join(", ")} числа`,
    `Невыполненные задачи: ${yes(t.missing_enabled)} · ${t.missing_kind === "warning" ? "предупреждение" : `${t.missing_amount} ₽`}`,
    `Перенесённые задачи: ${yes(t.extra_reward_enabled)} · ${t.extra_reward_medium === "bonus" ? "бонусами" : "деньгами"}`,
    `Подарки: ${yes(c.gifts.enabled)} · повышенная сумма со стажа ${c.gifts.tenure_boundary_days} дней`,
    ...c.gifts.holidays.map(
      (r) =>
        `${r.name} · ${r.month_day ? r.month_day.split("-").reverse().join(".") : "день рождения сотрудника"}: ${r.junior_amount} / ${r.senior_amount} бонусов · ${r.gender === "all" ? "все" : r.gender === "male" ? "мужчины" : "женщины"} · ${r.roles.join(", ")}`,
    ),
    ...c.gifts.tenure.map(
      (r) =>
        `Стаж ${r.days} дней: ${r.amount} бонусов · скидка ${r.discount_percent}% · ${r.roles.join(", ")}`,
    ),
  ];
}
