import type {
  Accrual,
  Allocation,
  Component,
  PayEmployee,
  PayModel,
  PayRule,
  Payment,
  Adjustment,
  Rates,
} from "./types";
export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function validateRates(rates: Rates) {
  for (const [count, days] of Object.entries(rates)) {
    if (!/^[1-9]\d?$/.test(count))
      throw new Error("Состав команды должен быть от 1 до 99");
    for (const [day, r] of Object.entries(days)) {
      if (!/^[1-7]$/.test(day) || !r)
        throw new Error("Некорректный день недели");
      if (
        r.base !== null &&
        (!Number.isFinite(r.base) || r.base < 0 || r.base > 1000000)
      )
        throw new Error("Некорректная ставка");
      if (
        r.percent !== null &&
        (!Number.isFinite(r.percent) || r.percent < 0 || r.percent > 100)
      )
        throw new Error("Некорректный процент");
    }
  }
}
export function selectRule(rules: PayRule[], e: PayEmployee, date: string) {
  return (
    rules
      .filter(
        (r) =>
          r.model_id === e.model_id &&
          r.valid_from <= date &&
          (!r.employee_id || r.employee_id === e.id),
      )
      .sort(
        (a, b) =>
          Number(!!b.employee_id) - Number(!!a.employee_id) ||
          b.valid_from.localeCompare(a.valid_from) ||
          (b.created_at??"").localeCompare(a.created_at??"") || b.id.localeCompare(a.id),
      )[0] ?? null
  );
}
export function monthsWorked(e: PayEmployee, date: string) {
  if (!e.hired_on) return e.experience_offset_months;
  const a = new Date(`${e.hired_on}T12:00:00Z`),
    b = new Date(`${date}T12:00:00Z`);
  return Math.max(
    0,
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      b.getUTCMonth() -
      a.getUTCMonth() -
      (b.getUTCDate() < a.getUTCDate() ? 1 : 0) +
      e.experience_offset_months,
  );
}
export function computeAccrual(input: {
  employee: PayEmployee;
  model: PayModel | null;
  rule: PayRule | null;
  date: string;
  roleCount: number;
  tipRecipients: number;
  metrics: Record<string, number | null>;
  extra: number | null;
  attendanceIssues: string[];
  adjustments: Adjustment[];
  cleanerPresent: boolean;
  qualification?: { knowledge: boolean; experience: boolean } | null;
}) {
  const { employee: e, model: m, rule: r, date, roleCount, metrics } = input;
  const issues = [...input.attendanceIssues],
    components: Component[] = [];
  const add = (
    kind: string,
    label: string,
    amount: number | null,
    basis: string,
    source: string,
  ) =>
    components.push({
      kind,
      label,
      amount: amount === null ? null : round(amount),
      basis,
      source,
    });
  if (!m || !r) {
    issues.push("Не назначена действующая модель оплаты");
    return { salary: 0, tips: 0, components, issues };
  }
  const wd = String(new Date(`${date}T12:00:00Z`).getUTCDay() || 7),
    rate = r.rates[String(roleCount)]?.[wd];
  if (!rate || rate.base === null)
    issues.push(`Не задана ставка для ${roleCount} сотрудников этой должности`);
  add(
    "base",
    "Выход",
    rate?.base ?? null,
    `${roleCount} сотрудников · ${["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"][Number(wd)]}`,
    `Правило от ${r.valid_from}`,
  );
  const pct = rate?.percent ?? (m.basis === "none" ? 0 : null),
    basis = m.basis === "none" ? 0 : metrics[m.basis];
  if (pct === null || basis === null || basis === undefined)
    issues.push("Нет ставки процента или базы продаж");
  add(
    "percent",
    "Процент от продаж",
    pct === null || basis == null ? null : Math.round((basis * pct) / 100),
    `${basis == null ? "—" : basis.toLocaleString("ru-RU")} ₽ × ${pct ?? "—"}% · ${m.basis === "hookah" ? "кальяны" : m.basis === "bar" ? "бар" : "оборот"}`,
    "Quick Resto · финансовая смена",
  );
  if (m.extras_enabled !== false && ["Мастер", "Бармен"].includes(e.role_name)) {
    if (input.extra === null)
      issues.push("Не получен отчёт дополнительных продаж");
    add(
      "extra",
      "Дополнительные продажи",
      input.extra === null ? null : Math.round(input.extra / roleCount),
      `${input.extra == null ? "—" : input.extra.toLocaleString("ru-RU")} ₽ / ${roleCount} сотрудников`,
      "Quick Resto · отчёт продаж",
    );
  }
  if (m.experience) {
    const eligible = !r.tenure_requires_exam || input.qualification?.experience;
    const months = monthsWorked(e, date),
      step = Object.entries(r.experience_steps)
        .filter(([n]) => Number(n) <= months)
        .sort((a, b) => Number(b[0]) - Number(a[0]))[0];
    add(
      "experience",
      "Стаж",
      eligible && step ? Number(step[1]) : 0,
      `${months} полных месяцев${eligible ? "" : " · тест не подтверждён"}`,
      "Дата трудоустройства и шкала надбавок",
    );
  }
  if (m.knowledge_amount > 0)
    add(
      "knowledge",
      "Знания",
      input.qualification?.knowledge ? m.knowledge_amount : 0,
      input.qualification?.knowledge
        ? "Тест подтверждён"
        : "Тест не подтверждён",
      "Подтверждение управляющим и правило оплаты",
    );
  if (m.food_amount > 0)
    add("food", "Питание", m.food_amount, "За выход", "Модель оплаты");
  if (!input.cleanerPresent && m.cleaner_bonus > 0)
    add(
      "cleaner",
      "Отсутствие клиннера",
      m.cleaner_bonus,
      "Клиннер не вышел в этот рабочий день",
      "Подтверждённый состав команды",
    );
  for (const a of input.adjustments) {
    if (a.deleted_at || (a.medium && a.medium !== "money")) continue;
    if (!a.approved) {
      issues.push(`Не подтверждено: ${a.reason}`);
      continue;
    }
    add(
      a.kind,
      a.reason,
      a.amount,
      "Ручное начисление",
      a.source_ref ?? "Подтверждение управляющим",
    );
  }
  let tips = 0;
  if (m.tips) {
    if (metrics.tips_total == null || input.tipRecipients === 0) {
      issues.push("Нет данных для распределения чаевых");
      add("tips", "Чаевые", null, "Равные доли", "Quick Resto");
    } else {
      tips = Math.round(metrics.tips_total / input.tipRecipients);
      add(
        "tips",
        "Чаевые",
        tips,
        `${metrics.tips_total} ₽ / ${input.tipRecipients} участников`,
        "Quick Resto · чаевые со сбором",
      );
    }
  }
  const salary = round(
    components
      .filter((c) => c.kind !== "tips")
      .reduce((s, c) => s + (c.amount ?? 0), 0),
  );
  return { salary, tips, components, issues: [...new Set(issues)] };
}
export function statementRows(
  employees: PayEmployee[],
  accruals: Accrual[],
  adjustments: Adjustment[],
  payments: Payment[],
  allocations: Allocation[],
  month: string,
  transfers: import("./types").PayrollTransfer[] = [],
  startsOn = "2026-09-01",
) {
  const activePayments = new Map(
    payments.filter((p) => p.state === "posted").map((p) => [p.id, p]),
  );
  const end = new Date(`${month}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const until = end.toISOString().slice(0, 10);
  return employees
    .map((e) => {
      const current = accruals.filter(
          (a) =>
            a.employee_id === e.id &&
            a.business_date >= month &&
            a.business_date < until,
        ),
        movement = transfers.filter(
          (t) => t.employee_id === e.id && t.state === "posted",
        );
      const paid = (before: boolean, tip: boolean) =>
        allocations
          .filter(
            (a) =>
              a.employee_id === e.id &&
              (before ? a.month < month : a.month === month) &&
              activePayments.has(a.payment_id) &&
              (activePayments.get(a.payment_id)?.kind === "tips") === tip,
          )
          .reduce((s, a) => s + Number(a.settled_amount), 0);
      const transferredIn = round(
        movement
          .filter((t) => t.to_month === month)
          .reduce((sum, t) => sum + Number(t.amount), 0),
      );
      const transferredOut = round(
        movement
          .filter((t) => t.from_month === month)
          .reduce((sum, t) => sum + Number(t.amount), 0),
      );
      const opening = round(
        (month === startsOn ? Number(e.opening_balance) : 0) + transferredIn,
      );
      const earned = round(current.reduce((s, a) => s + Number(a.salary), 0)),
        tips = round(current.reduce((s, a) => s + Number(a.tips), 0)),
        salaryPaid = round(paid(false, false)),
        tipPaid = round(paid(false, true));
      const bonuses = current
          .flatMap((a) => a.components)
          .filter((c) => c.kind === "bonus" || c.kind === "cleaner")
          .reduce((s, c) => s + (c.amount ?? 0), 0),
        deductions = current
          .flatMap((a) => a.components)
          .filter((c) => (c.amount ?? 0) < 0)
          .reduce((s, c) => s - (c.amount ?? 0), 0);
      return {
        employee: e,
        shifts: current.filter(
          (a) =>
            !["monthly", "adjustment"].includes(
              String(a.calculation_snapshot.kind),
            ),
        ).length,
        earned,
        tips,
        tipPaid,
        tipRemaining: round(tips - tipPaid),
        opening,
        paid: salaryPaid,
        remaining: round(opening + earned - salaryPaid - transferredOut),
        transferredIn,
        transferredOut,
        bonuses: round(bonuses),
        deductions: round(deductions),
        issues: current.filter((a) => a.issues.length).length,
      };
    })
    .filter(
      (r) =>
        r.shifts ||
        r.earned ||
        r.tips ||
        r.opening ||
        r.paid ||
        r.employee.active,
    );
}
export function distribute(
  total: number,
  weights: { id: string; weight: number }[],
) {
  const sum = weights.reduce((s, r) => s + r.weight, 0);
  if (total < 0 || sum <= 0) throw new Error("Нет получателей");
  const units = Math.round(total * 100);
  const rows = weights.map((r) => ({
    id: r.id,
    units: Math.floor((units * r.weight) / sum),
    fraction: ((units * r.weight) / sum) % 1,
  }));
  let left = units - rows.reduce((s, r) => s + r.units, 0);
  for (const r of [...rows].sort(
    (a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id),
  )) {
    if (!left) break;
    r.units++;
    left--;
  }
  return rows.map((r) => ({ id: r.id, amount: r.units / 100 }));
}
export function tipMatch(
  accruals: Accrual[],
  cashAmount: number,
  tolerance: number,
) {
  const total = round(accruals.reduce((s, a) => s + Number(a.tips), 0));
  return {
    total,
    difference: round(total - cashAmount),
    matches:
      accruals.length > 0 &&
      total > 0 &&
      accruals.every((a) => a.issues.length === 0) &&
      Math.abs(round(total - cashAmount)) <= tolerance,
  };
}

export function tipBatch(
  date: string,
  accruals: Accrual[],
  cash: import("./types").Cashbox[],
  bankFor: (cash: import("./types").Cashbox) => string,
  categoryId: string,
  reason = "",
) {
  const total = round(accruals.reduce((sum, a) => sum + Number(a.tips), 0));
  const settled = distribute(
      total,
      cash.map((c) => ({ id: c.id, weight: Number(c.amount) })),
    ),
    remaining = new Map(
      accruals.map((a) => [a.id, Math.round(Number(a.tips) * 100)]),
    );
  return cash.map((c, index) => {
    const actual = distribute(
        Number(c.amount),
        accruals.map((a) => ({ id: a.id, weight: Number(a.tips) })),
      ),
      closed =
        index === cash.length - 1
          ? accruals.map((a) => ({
              id: a.id,
              amount: remaining.get(a.id)! / 100,
            }))
          : distribute(
              settled.find((x) => x.id === c.id)!.amount,
              accruals.map((a) => ({ id: a.id, weight: remaining.get(a.id)! })),
            );
    for (const a of closed)
      remaining.set(a.id, remaining.get(a.id)! - Math.round(a.amount * 100));
    return {
      request_key: c.id,
      cashbox_id: c.id,
      kind: "tips",
      bank_account_id: bankFor(c),
      category_id: categoryId,
      date: c.occurred_at,
      amount: Number(c.amount),
      note: `Чаевые за ${date}`,
      reason,
      allocations: accruals.map((a) => ({
        employee_id: a.employee_id,
        accrual_id: a.id,
        month: `${date.slice(0, 7)}-01`,
        amount: actual.find((x) => x.id === a.id)!.amount,
        settled_amount: closed.find((x) => x.id === a.id)!.amount,
      })),
    };
  });
}

export function effectivePayModel(
  model: PayModel | null,
  rule: PayRule | null,
) {
  return model
    ? {
        ...model,
        ...(rule?.config ?? {}),
        monthly_amount: rule?.monthly_amount ?? model.monthly_amount,
      }
    : null;
}

export function employeeAtDate(
  employee: PayEmployee,
  assignments: import("./types").PayAssignment[],
  models: PayModel[],
  date: string,
) {
  const assignment = assignments
    .filter((a) => a.employee_id === employee.id && a.valid_from <= date)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
  const modelId = assignment?.model_id ?? employee.model_id,
    model = models.find((m) => m.id === modelId);
  return {
    ...employee,
    model_id: modelId,
    role_id: model?.role_id ?? employee.role_id,
    role_name: model?.role_name ?? employee.role_name,
  };
}

export function recognizeTipComment(
  comment: string,
  configured: string[],
): "exact" | "ambiguous" | null {
  const normalized = comment.trim().toLocaleLowerCase("ru-RU"),
    names = configured
      .map((c) => c.trim().toLocaleLowerCase("ru-RU"))
      .filter((c) => c.length >= 3);
  if (names.includes(normalized)) return "exact";
  if (
    names.some((name) => normalized.includes(name)) ||
    /чаев/.test(normalized)
  )
    return "ambiguous";
  return null;
}

/** Monthly salary and shift earnings are independent parts of a position. */
export function hasShiftPay(model: PayModel | null, rule: PayRule | null) {
  if (!model) return true;
  if (rule?.config.shift_pay !== undefined) return rule.config.shift_pay;
  if (model.shift_pay !== undefined) return model.shift_pay;
  return !model.monthly_amount || Object.keys(rule?.rates ?? {}).length > 0;
}
export function mergeMonthlyAccrual(shift: {salary:number;components:Component[];issues:string[];calculation_snapshot:Record<string,unknown>}, amount:number, rule:PayRule|null, date:string) {
  return {...shift, salary:round(shift.salary+amount), components:[...shift.components,{kind:"monthly",label:"Оклад за месяц",amount,basis:date.slice(0,7),source:`Условия основной должности от ${rule?.valid_from ?? date}`}], calculation_snapshot:{...shift.calculation_snapshot,kind:"combined",monthly_rule:rule}};
}
