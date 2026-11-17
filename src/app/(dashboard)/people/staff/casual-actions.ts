"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { provisionCasualQuickResto } from "@/lib/payroll/casual-quickresto";

export type CasualResult = { id: string | null; pin: string | null; error: string | null };

const nameSchema = z.object({
  firstName: z.string().trim().min(1, "Укажите имя").max(80),
  lastName: z.string().trim().min(1, "Укажите фамилию").max(80),
});
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

async function provision(id: string): Promise<CasualResult> {
  try {
    const { pin } = await provisionCasualQuickResto(id);
    return { id, pin, error: null };
  } catch (e) {
    return { id, pin: null, error: message(e, "Не удалось завести сотрудника в Quick Resto") };
  } finally {
    revalidatePath("/people/staff");
  }
}

// Creates a casual worker of the active venue and immediately gives the worker
// a Quick Resto employee with a personal PIN.
export async function createCasualEmployee(input: {
  firstName: string;
  lastName: string;
  roleId: string;
}): Promise<CasualResult> {
  const parsed = nameSchema.extend({ roleId: z.string().uuid("Выберите должность") }).safeParse(input);
  if (!parsed.success) return { id: null, pin: null, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const db = asLooseDb(await createClient());
  const created = await db.rpc("payroll_casual_create", {
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_role_id: parsed.data.roleId,
  });
  if (created.error || typeof created.data !== "string")
    return { id: null, pin: null, error: created.error?.message ?? "Не удалось добавить разового сотрудника" };
  return provision(created.data);
}

// For a casual worker created earlier without a Quick Resto code, or a retry
// after a failed attempt.
export async function provisionCasualEmployee(input: {
  id: string;
  firstName: string;
  lastName: string;
}): Promise<CasualResult> {
  const parsed = nameSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { id: null, pin: null, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const db = asLooseDb(await createClient());
  const requested = await db.rpc("payroll_casual_request_quickresto", {
    p_employee_id: parsed.data.id,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
  });
  if (requested.error) return { id: parsed.data.id, pin: null, error: requested.error.message };
  return provision(parsed.data.id);
}
