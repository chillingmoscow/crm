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
  /** «Платит агентство»: сумма в месяц приходит сотруднику через агентство, без налога. */
  agency: boolean;
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
  // Зарплатная карточка, её периоды оформления и оклады — одним запросом
  // (встроенная выборка по FK, каждая таблица под своим RLS), а не тремя
  // по очереди. Периодов у сотрудника единицы, берём последний.
  type Row = {
    id: string;
    active: boolean;
    payroll_official_employments: (OfficialEmploymentPeriod & {
      payroll_official_salaries: { valid_from: string; gross: number | string }[];
    })[];
  };
  const employee = await s.db
    .from<Row>("payroll_employees")
    .select(
      "id,active,payroll_official_employments!payroll_official_employments_employee_fkey(id,starts_on,ends_on,position,contract_number,contract_date,contract_path,agency,payroll_official_salaries(valid_from,gross))",
    )
    .eq("venue_id", s.venueId)
    .eq("local_user_id", userId)
    .is("payroll_official_employments.archived_at", null)
    .order("starts_on", { referencedTable: "payroll_official_employments", ascending: false })
    .order("valid_from", {
      referencedTable: "payroll_official_employments.payroll_official_salaries",
      ascending: true,
    })
    .maybeSingle();
  if (employee.error) throw new Error(employee.error.message);
  if (!employee.data) return { employeeId: null, employeeActive: false, employment: null, salaries: [], canEdit };

  const latest = employee.data.payroll_official_employments[0] ?? null;
  const employment: OfficialEmploymentPeriod | null = latest
    ? {
        id: latest.id,
        starts_on: latest.starts_on,
        ends_on: latest.ends_on,
        position: latest.position,
        contract_number: latest.contract_number,
        contract_date: latest.contract_date,
        contract_path: latest.contract_path,
        agency: latest.agency === true,
      }
    : null;
  const salaries = (latest?.payroll_official_salaries ?? []).map((r) => ({
    valid_from: r.valid_from,
    gross: Number(r.gross),
  }));
  return {
    employeeId: employee.data.id,
    employeeActive: employee.data.active,
    employment,
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
