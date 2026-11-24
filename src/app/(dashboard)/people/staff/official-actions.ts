"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { actionResult } from "@/lib/actions/result";
import {
  changeOfficialSalarySchema,
  employOfficiallySchema,
  endOfficialEmploymentSchema,
  officialEmploymentIdSchema,
  updateOfficialEmploymentSchema,
  type ChangeOfficialSalaryInput,
  type EmployOfficiallyInput,
  type EndOfficialEmploymentInput,
  type UpdateOfficialEmploymentInput,
} from "@/lib/people/official-employment";

/**
 * Официальное трудоустройство в карточке сотрудника. Данные — по зарплатной
 * карточке активного заведения (`payroll_employees.local_user_id`), чтение —
 * под RLS с правом просмотра зарплаты, изменения — одной командой базы
 * `payroll_official_command` с правом `payroll.configure`.
 */

export type OfficialEmploymentPeriod = {
  id: string;
  starts_on: string;
  ends_on: string | null;
  position: string;
  contract_number: string | null;
  contract_date: string | null;
  contract_path: string | null;
};

export type OfficialEmploymentData = {
  /** Карточка сотрудника в зарплате заведения; null — его там нет. */
  employeeId: string | null;
  /** Работает ли он в зарплате заведения (оформить уволенного нельзя). */
  employeeActive: boolean;
  /** Последний (неотменённый) период оформления. */
  employment: OfficialEmploymentPeriod | null;
  /** Оклад по договору — версии «с месяца», по возрастанию. */
  salaries: { valid_from: string; gross: number }[];
  /** Право оформлять, менять оклад и увольнять официально. */
  canEdit: boolean;
};

async function scope(permission: string) {
  const client = await createClient();
  const [user, permissions, venue] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
    client.rpc("get_active_venue_id"),
  ]);
  if (!user) throw new Error("Войдите в аккаунт");
  if (!venue.data) throw new Error("Выберите заведение");
  if (!permissions.includes(permission)) throw new Error("Нет доступа к этому действию");
  return { db: asLooseDb(client), venueId: venue.data as string, permissions };
}

async function getOfficialEmploymentImpl(userId: string): Promise<OfficialEmploymentData> {
  z.string().uuid("Сотрудник не найден").parse(userId);
  const s = await scope("payroll.view");
  const canEdit = s.permissions.includes("payroll.configure");
  const employee = await s.db
    .from<{ id: string; active: boolean }>("payroll_employees")
    .select("id,active")
    .eq("venue_id", s.venueId)
    .eq("local_user_id", userId)
    .maybeSingle();
  if (employee.error) throw new Error(employee.error.message);
  if (!employee.data) return { employeeId: null, employeeActive: false, employment: null, salaries: [], canEdit };

  const employment = await s.db
    .from<OfficialEmploymentPeriod>("payroll_official_employments")
    .select("id,starts_on,ends_on,position,contract_number,contract_date,contract_path")
    .eq("venue_id", s.venueId)
    .eq("employee_id", employee.data.id)
    .is("archived_at", null)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (employment.error) throw new Error(employment.error.message);

  let salaries: OfficialEmploymentData["salaries"] = [];
  if (employment.data) {
    const rows = await s.db
      .from<{ valid_from: string; gross: number | string }[]>("payroll_official_salaries")
      .select("valid_from,gross")
      .eq("venue_id", s.venueId)
      .eq("employment_id", employment.data.id)
      .order("valid_from", { ascending: true });
    if (rows.error) throw new Error(rows.error.message);
    salaries = (rows.data ?? []).map((r) => ({ valid_from: r.valid_from, gross: Number(r.gross) }));
  }
  return {
    employeeId: employee.data.id,
    employeeActive: employee.data.active,
    employment: employment.data,
    salaries,
    canEdit,
  };
}

async function command(action: "employ" | "update" | "salary" | "end" | "cancel", input: Record<string, unknown>) {
  const s = await scope("payroll.configure");
  const result = await s.db.rpc("payroll_official_command", { p_action: action, p_input: input });
  if (result.error) throw new Error(result.error.message);
  // Карточка сотрудника и метка «Офиц.» в списке.
  revalidatePath("/people/staff", "layout");
  return result.data as string;
}

// Действия возвращают ошибку текстом (см. lib/actions/result): в рабочей
// сборке Next.js заменяет текст брошенного исключения английской заглушкой.
export async function getOfficialEmployment(userId: string) {
  return actionResult(() => getOfficialEmploymentImpl(userId), "Не удалось загрузить официальное трудоустройство");
}

export async function employOfficially(input: EmployOfficiallyInput) {
  return actionResult(
    async () => command("employ", employOfficiallySchema.parse(input)),
    "Не удалось оформить сотрудника официально",
  );
}

export async function updateOfficialEmployment(input: UpdateOfficialEmploymentInput) {
  return actionResult(
    async () => command("update", updateOfficialEmploymentSchema.parse(input)),
    "Не удалось сохранить данные оформления",
  );
}

export async function changeOfficialSalary(input: ChangeOfficialSalaryInput) {
  return actionResult(
    async () => command("salary", changeOfficialSalarySchema.parse(input)),
    "Не удалось изменить оклад",
  );
}

export async function endOfficialEmployment(input: EndOfficialEmploymentInput) {
  return actionResult(
    async () => command("end", endOfficialEmploymentSchema.parse(input)),
    "Не удалось сохранить дату официального увольнения",
  );
}

export async function cancelOfficialEmployment(employmentId: string) {
  return actionResult(
    async () => command("cancel", { employment_id: officialEmploymentIdSchema.parse(employmentId) }),
    "Не удалось отменить оформление",
  );
}
