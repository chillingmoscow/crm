import { shiftPayModelId } from "../payroll/calculate.ts";

/**
 * Модель оплаты разового сотрудника на смене — по тому же правилу, что и
 * расчёт зарплаты (`shiftPayModelId`): его модель, если смена в его
 * должности или подразделении; иначе модель должности смены по умолчанию.
 * Оплата настраивается в должности, у должности одна модель по умолчанию —
 * поэтому выбирать вручную нечего. null — у должности не настроена оплата.
 */
export function casualPayModel({
  employee,
  shift,
  models,
  roles,
  sameDepartmentRateFrom,
}: {
  employee: { role_id: string | null; model_id: string | null };
  shift: { role_id: string | null; department_id?: string | null; starts_at?: string | null };
  models: { id: string; role_id: string | null; is_role_default: boolean }[];
  roles: { id: string; department_id: string | null }[];
  /** Правило «в своём подразделении — своя ставка» действует с этой даты. */
  sameDepartmentRateFrom?: string | null;
}): string | null {
  if (!shift.role_id) return null;
  const departmentsByRole = new Map(roles.map((r) => [r.id, r.department_id]));
  const sameDepartment =
    !sameDepartmentRateFrom || !shift.starts_at || Date.parse(shift.starts_at) >= Date.parse(sameDepartmentRateFrom);
  return shiftPayModelId(
    { role_id: shift.role_id, department_id: shift.department_id ?? null, payroll_model_id: null },
    employee,
    models,
    departmentsByRole,
    sameDepartment,
  );
}
