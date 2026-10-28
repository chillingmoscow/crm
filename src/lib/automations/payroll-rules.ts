import type { AutomationSettings } from "../payroll/automation-settings";

/** Pure business decisions. This module never writes salary or calls a provider. */
export type AutomationDecision = {
  key: string;
  venueId: string;
  employeeId: string;
  sourceId: string;
  ruleVersion: number;
  businessDate: string;
  rule:
    | "medical_missing"
    | "medical_expired"
    | "medical_reimbursement"
    | "medical_reminder"
    | "uniform"
    | "task"
    | "holiday"
    | "tenure";
  kind: "bonus" | "deduction" | "warning" | "notification" | "discount";
  medium: "money" | "bonus" | "none" | "percent";
  amount: number;
  reason: string;
};
export type AutomationBlocker = {
  employeeId: string;
  sourceId?: string;
  code: string;
  message: string;
};
export type MedicalCase = {
  id: string;
  examinedOn: string | null;
  validUntil: string | null;
  reimbursementRecorded: boolean | null;
};
export type AutomationEmployee = {
  id: string;
  active: boolean;
  hiredOn: string | null;
  birthday: string | null;
  gender: "male" | "female" | null;
  /** Explicit mapping to the configured gift roles. Never infer a role from a name. */
  giftRole: string | null;
  medicalRequired: boolean | null;
  /** undefined = not reconciled; null = confirmed absence of a document. */
  medicalCase?: MedicalCase | null;
};
export type UniformInstallment = { dueOn: string; amount: number };
export type UniformIssue = {
  id: string;
  employeeId: string;
  /** Imported historic schedules are preserved, including their original amounts. */
  installments: UniformInstallment[];
};
export type TaskOutcome = {
  id: string;
  occurrenceId: string;
  employeeId: string;
  businessDate: string;
  title: string;
  result: "completed" | "incomplete" | "awaiting_review";
  transferred: boolean;
  fineAmount: number | null;
  rewardAmount: number | null;
};
export type PayrollAutomationInput = {
  venueId: string;
  businessDate: string;
  ruleVersion: number;
  config: AutomationSettings;
  employees: AutomationEmployee[];
  uniformIssues: UniformIssue[];
  tasks: TaskOutcome[];
  /** Reconciled native keys, including imported legacy events; not Telegram message IDs. */
  recordedKeys: string[];
};

const DAY = 86400000;
function day(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Неверная календарная дата");
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Неверная календарная дата");
  return date;
}
function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function addDays(value: string, count: number): string {
  return iso(new Date(day(value).getTime() + count * DAY));
}
function addMonths(value: string, count: number): string {
  const date = day(value);
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1, 12),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return iso(target);
}
function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1e9)
    throw new Error("Некорректная сумма");
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result)) throw new Error("Некорректная сумма");
  return result;
}
function id(value: string): string {
  if (!value || value.length > 200)
    throw new Error("Отсутствует идентификатор источника");
  return encodeURIComponent(value);
}

/** A new purchase must supply its first withholding date explicitly. No backdating. */
export function uniformSchedule(
  total: number,
  firstDueOn: string,
  count: number,
  paymentDays: number[],
): UniformInstallment[] {
  const amount = cents(total);
  const first = day(firstDueOn);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 24 ||
    !paymentDays.length ||
    paymentDays.length > 4 ||
    paymentDays.some(
      (d, i) =>
        !Number.isInteger(d) ||
        d < 1 ||
        d > 28 ||
        (i > 0 && d <= paymentDays[i - 1]),
    )
  )
    throw new Error("Проверьте график удержаний");
  if (!paymentDays.includes(first.getUTCDate()))
    throw new Error("Дата первого удержания не соответствует выбранным дням");
  const base = Math.floor(amount / count);
  const result: UniformInstallment[] = [];
  let cursor = firstDueOn;
  for (let i = 0; i < count; i++) {
    result.push({
      dueOn: cursor,
      amount: (i === count - 1 ? amount - base * i : base) / 100,
    });
    if (i < count - 1) {
      do {
        cursor = addDays(cursor, 1);
      } while (!paymentDays.includes(day(cursor).getUTCDate()));
    }
  }
  return result;
}

export function planPayrollAutomations(input: PayrollAutomationInput): {
  decisions: AutomationDecision[];
  recordedCandidates: AutomationDecision[];
  blockers: AutomationBlocker[];
} {
  const { config, businessDate: today } = input;
  day(today);
  id(input.venueId);
  if (!Number.isInteger(input.ruleVersion) || input.ruleVersion < 1)
    throw new Error("Сначала сохраните и подтвердите правила заведения");
  const employees = new Map(input.employees.map((e) => [e.id, e]));
  if (employees.size !== input.employees.length)
    throw new Error("Повторяющиеся карточки сотрудников");
  const recorded = new Set(input.recordedKeys);
  const decisions = new Map<string, AutomationDecision>();
  const recordedCandidates: AutomationDecision[] = [];
  const seenKeys = new Set<string>();
  const blockers: AutomationBlocker[] = [];
  const block = (
    employeeId: string,
    code: string,
    message: string,
    sourceId?: string,
  ) => blockers.push({ employeeId, sourceId, code, message });
  function emit(
    employeeId: string,
    sourceId: string,
    rule: AutomationDecision["rule"],
    suffix: string,
    kind: AutomationDecision["kind"],
    medium: AutomationDecision["medium"],
    amount: number,
    reason: string,
  ) {
    const key = [
      "payroll",
      id(input.venueId),
      id(employeeId),
      rule,
      id(sourceId),
      suffix,
    ].join(":");
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9)
      throw new Error("Некорректная сумма правила");
    if (
      (kind === "bonus" || kind === "deduction" || kind === "discount") &&
      amount === 0
    )
      return;
    if (seenKeys.has(key))
      throw new Error("Повторяющийся исходный объект автоматизации");
    seenKeys.add(key);
    const candidate: AutomationDecision = {
      key,
      venueId: input.venueId,
      employeeId,
      sourceId,
      ruleVersion: input.ruleVersion,
      businessDate: today,
      rule,
      kind,
      medium,
      amount,
      reason,
    };
    if (recorded.has(key)) recordedCandidates.push(candidate);
    else decisions.set(key, candidate);
  }
  for (const employee of input.employees) {
    id(employee.id);
    if (!employee.active) continue;
    if (employee.hiredOn) day(employee.hiredOn);
    if (employee.birthday) day(employee.birthday);
    if (employee.hiredOn && employee.hiredOn > today) continue;
    const medical = config.medical;
    if (
      employee.medicalRequired === null &&
      (medical.reminders ||
        medical.submission_fine ||
        medical.expiry_fine ||
        medical.reimbursement)
    ) {
      block(
        employee.id,
        "medical_role_unmapped",
        "Не подтверждено требование медкнижки для должности",
      );
    } else if (employee.medicalRequired) {
      const document = employee.medicalCase;
      if (document === undefined)
        block(
          employee.id,
          "medical_case_unreconciled",
          "Проверьте документ и прежние штрафы/компенсации",
        );
      else if (document === null) {
        if (!employee.hiredOn)
          block(
            employee.id,
            "hire_date_missing",
            "Не указана дата приёма на работу",
          );
        else {
          if (
            medical.reminders &&
            today ===
              addDays(employee.hiredOn, medical.reminder_after_hire_days)
          )
            emit(
              employee.id,
              employee.hiredOn,
              "medical_reminder",
              "missing",
              "notification",
              "none",
              0,
              "Необходимо предоставить медицинскую книжку",
            );
          if (
            medical.submission_fine &&
            today ===
              addMonths(employee.hiredOn, medical.submission_after_hire_months)
          )
            emit(
              employee.id,
              employee.hiredOn,
              "medical_missing",
              "once",
              "deduction",
              "money",
              medical.submission_amount,
              "Медицинская книжка не предоставлена",
            );
        }
      } else {
        id(document.id);
        if (document.validUntil) {
          day(document.validUntil);
          if (
            medical.reminders &&
            today ===
              addDays(document.validUntil, -medical.reminder_before_expiry_days)
          )
            emit(
              employee.id,
              document.id,
              "medical_reminder",
              `expiry:${document.validUntil}`,
              "notification",
              "none",
              0,
              "Истекает срок действия медицинской книжки",
            );
          if (medical.expiry_fine && today === addDays(document.validUntil, 1))
            emit(
              employee.id,
              document.id,
              "medical_expired",
              "once",
              "deduction",
              "money",
              medical.expiry_amount,
              "Медицинская книжка просрочена",
            );
        } else
          block(
            employee.id,
            "medical_expiry_missing",
            "Не указан срок действия медицинской книжки",
            document.id,
          );
        if (medical.reimbursement && document.examinedOn) {
          day(document.examinedOn);
          if (
            today ===
            addMonths(
              document.examinedOn,
              medical.reimbursement_after_exam_months,
            )
          ) {
            if (document.reimbursementRecorded === null)
              block(
                employee.id,
                "medical_reimbursement_unreconciled",
                "Не проверена прежняя компенсация медкнижки",
                document.id,
              );
            else if (!document.reimbursementRecorded) {
              if (
                medical.reimbursement_requires_exam_after_hire &&
                !employee.hiredOn
              )
                block(
                  employee.id,
                  "hire_date_missing",
                  "Не указана дата приёма на работу",
                  document.id,
                );
              else if (
                !medical.reimbursement_requires_exam_after_hire ||
                document.examinedOn > employee.hiredOn!
              )
                emit(
                  employee.id,
                  document.id,
                  "medical_reimbursement",
                  "once",
                  "bonus",
                  "money",
                  medical.reimbursement_amount,
                  "Компенсация изготовления медицинской книжки",
                );
            }
          }
        }
      }
    }
    const gifts = config.gifts;
    if (!gifts.enabled) continue;
    if (!employee.hiredOn) {
      block(
        employee.id,
        "gift_hire_date_missing",
        "Не указана дата приёма для расчёта подарков за стаж",
      );
      continue;
    }
    const tenure = Math.floor(
      (day(today).getTime() - day(employee.hiredOn).getTime()) / DAY,
    );
    const date = today.slice(5);
    for (const holiday of gifts.holidays) {
      if (
        holiday.month_day
          ? holiday.month_day !== date
          : !employee.birthday || employee.birthday.slice(5) !== date
      )
        continue;
      if (!employee.giftRole) {
        block(
          employee.id,
          "gift_role_unmapped",
          "Не сопоставлена должность для подарков",
          holiday.id,
        );
        continue;
      }
      if (!holiday.roles.includes(employee.giftRole)) continue;
      if (holiday.gender !== "all" && !employee.gender) {
        block(
          employee.id,
          "gift_gender_missing",
          "Не указан получатель для правила праздника",
          holiday.id,
        );
        continue;
      }
      if (holiday.gender !== "all" && holiday.gender !== employee.gender)
        continue;
      emit(
        employee.id,
        holiday.id,
        "holiday",
        today.slice(0, 4),
        "bonus",
        "bonus",
        tenure < gifts.tenure_boundary_days
          ? holiday.junior_amount
          : holiday.senior_amount,
        holiday.name,
      );
    }
    for (const level of gifts.tenure) {
      if (tenure !== level.days) continue;
      if (!employee.giftRole) {
        block(
          employee.id,
          "gift_role_unmapped",
          "Не сопоставлена должность для подарков за стаж",
        );
        continue;
      }
      if (!level.roles.includes(employee.giftRole)) continue;
      const source = `${employee.hiredOn}:${level.days}`;
      emit(
        employee.id,
        source,
        "tenure",
        "gift",
        "bonus",
        "bonus",
        level.amount,
        `Подарок за стаж ${level.days} дней`,
      );
      // Desired discount only: this decision does not claim it has been assigned in QR.
      emit(
        employee.id,
        source,
        "tenure",
        "discount",
        "discount",
        "percent",
        level.discount_percent,
        `Скидка за стаж ${level.days} дней`,
      );
    }
  }
  if (config.uniform.enabled)
    for (const issue of input.uniformIssues) {
      const employee = employees.get(issue.employeeId);
      if (!employee) {
        block(
          issue.employeeId,
          "uniform_employee_unmapped",
          "Не найден сотрудник для покупки формы",
          issue.id,
        );
        continue;
      }
      if (!employee.active || (employee.hiredOn && employee.hiredOn > today))
        continue;
      id(issue.id);
      issue.installments.forEach((part, index) => {
        day(part.dueOn);
        cents(part.amount);
        if (part.dueOn === today)
          emit(
            employee.id,
            issue.id,
            "uniform",
            String(index + 1),
            "deduction",
            "money",
            part.amount,
            `Возмещение стоимости формы (${index + 1}/${issue.installments.length})`,
          );
      });
    }
  for (const task of input.tasks) {
    if (task.businessDate !== today) continue;
    const employee = employees.get(task.employeeId);
    if (!employee) {
      block(
        task.employeeId,
        "task_employee_unmapped",
        "Не найден исполнитель задачи",
        task.id,
      );
      continue;
    }
    if (!employee.active || (employee.hiredOn && employee.hiredOn > today))
      continue;
    const source = `${id(task.id)}:${id(task.occurrenceId)}`;
    if (task.result === "awaiting_review") {
      block(
        employee.id,
        "task_awaiting_review",
        "Выполнение задачи ещё не подтверждено",
        task.id,
      );
      continue;
    }
    if (task.result === "incomplete" && config.tasks.missing_enabled) {
      emit(
        employee.id,
        source,
        "task",
        "result",
        config.tasks.missing_enabled &&
          config.tasks.missing_kind === "deduction"
          ? "deduction"
          : "warning",
        config.tasks.missing_enabled &&
          config.tasks.missing_kind === "deduction"
          ? "money"
          : "none",
        config.tasks.missing_enabled &&
          config.tasks.missing_kind === "deduction"
          ? (task.fineAmount ?? config.tasks.missing_amount)
          : 0,
        `Задача «${task.title}» не выполнена`,
      );
    } else if (
      task.result === "completed" &&
      task.transferred &&
      config.tasks.extra_reward_enabled &&
      task.rewardAmount !== null
    )
      emit(
        employee.id,
        source,
        "task",
        "result",
        "bonus",
        config.tasks.extra_reward_medium,
        task.rewardAmount,
        `Выполнение перенесённой задачи «${task.title}»`,
      );
  }
  return { decisions: [...decisions.values()], recordedCandidates, blockers };
}
