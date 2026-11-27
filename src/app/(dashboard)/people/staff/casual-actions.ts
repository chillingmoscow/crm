"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { provisionCasualQuickResto } from "@/lib/payroll/casual-quickresto";
import { errorText } from "@/lib/actions/error-text";
import { isBackOfficeAuthError, isBackOfficePermissionError } from "@/lib/integrations/quickresto/auth-state";
import { genderSchema } from "@/lib/people/gender";
import { zonedParts } from "@/lib/sales/time";
import { getActiveAccountTimezone } from "@/lib/settings/account";
import { assignPayrollPositionOnly, requeuePayrollFrom } from "@/app/(dashboard)/people/payroll/actions";
import { createStaffWithoutEmail } from "./actions";
import { dropStaffChatInvites } from "@/lib/people/chat-invites-queue";

export type CasualResult = { id: string | null; pin: string | null; error: string | null };

const nameSchema = z.object({
  firstName: z.string().trim().min(1, "Укажите имя").max(80),
  lastName: z.string().trim().min(1, "Укажите фамилию").max(80),
});

async function provision(id: string): Promise<CasualResult> {
  try {
    const { pin } = await provisionCasualQuickResto(id);
    return { id, pin, error: null };
  } catch (e) {
    console.error("[provisionCasual] Quick Resto provisioning failed:", e);
    return { id, pin: null, error: `Не удалось завести сотрудника в Quick Resto: ${quickRestoReason(e)}` };
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
    return { id: null, pin: null, error: errorText(created.error, "Не удалось добавить разового сотрудника") };
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
  if (requested.error) return { id: parsed.data.id, pin: null, error: errorText(requested.error, "Не удалось подготовить заведение в Quick Resto") };
  return provision(parsed.data.id);
}

const convertSchema = nameSchema.extend({
  employeeId: z.string().uuid(),
  gender: genderSchema,
  phone: z.string().trim().max(40).optional(),
  roleId: z.string().uuid("Выберите должность"),
});

export type ConvertCasualResult = {
  userId: string | null;
  /** PIN кассы, если его выдали при переводе (живого кода не было). */
  issuedPin: string | null;
  notice: string | null;
  error: string | null;
};

/**
 * Перевод разового в штат. Создаётся учётная запись сотрудника (как «Добавить
 * → Создать»), и к ней привязывается та же запись зарплаты: смены, начисления
 * и выплаты остаются при человеке, а не делятся на две строки ведомости.
 * Если привязать не удалось, созданная учётная запись удаляется.
 */
export async function convertCasualToStaff(input: z.input<typeof convertSchema>): Promise<ConvertCasualResult> {
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success)
    return { userId: null, issuedPin: null, notice: null, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const value = parsed.data;
  const can = await getCachedPermissionChecker();
  if (!can("people.edit_staff") || !can("payroll.configure"))
    return { userId: null, issuedPin: null, notice: null, error: "Нужны права на сотрудников и на настройку зарплаты" };

  const supabase = await createClient();
  const db = asLooseDb(supabase);
  const [venue, employee] = await Promise.all([
    supabase.rpc("get_active_venue_id"),
    db
      .from<{
        id: string;
        casual: boolean;
        local_user_id: string | null;
        role_id: string | null;
        quickresto_pin: string | null;
        quickresto_provisioning: { complete?: boolean; steps?: Record<string, unknown> } | null;
      }>("payroll_employees")
      .select("id,casual,local_user_id,role_id,quickresto_pin,quickresto_provisioning")
      .eq("id", value.employeeId)
      .maybeSingle(),
  ]);
  const venueId = venue.data as string | null;
  if (!venueId) return { userId: null, issuedPin: null, notice: null, error: "Не выбрано заведение" };
  if (!employee.data?.casual || employee.data.local_user_id)
    return { userId: null, issuedPin: null, notice: null, error: "Разовый сотрудник не найден" };
  // Те же условия, что проверит база, — до создания учётной записи: откат
  // после неё не всегда чистый (журнал приёма ссылается на нового человека).
  const admin = createAdminClient();
  const loading = await asLooseDb(admin)
    .from<{ business_date: string }[]>("payroll_source_days")
    .select("business_date")
    .eq("venue_id", venueId)
    .eq("state", "loading")
    .limit(1);
  if (loading.data?.length)
    return { userId: null, issuedPin: null, notice: null, error: "Дождитесь обновления зарплаты и повторите" };

  // Живого кода кассы нет (разовый перенесён из Quick Resto или код не
  // выдавали) — заводим сотрудника в Quick Resto тем же способом, что
  // «Добавить → Разовый», до создания карточки: без кода штатному нечем
  // отмечаться. Повтор после сбоя продолжает ту же попытку, дубля в кассе нет.
  // Заведение, начатое Sheerly и не доведённое (код выдан, склады нет), тоже
  // доводим. Код, выданный кассой до Sheerly, журнала заведения не имеет.
  let issuedPin: string | null = null;
  const notices: string[] = [];
  const ledger = employee.data.quickresto_provisioning;
  const unfinished = !!ledger?.steps && Object.keys(ledger.steps).length > 0 && !ledger.complete;
  if (!employee.data.quickresto_pin || unfinished) {
    if (!employee.data.quickresto_pin) {
      // Те же проверки и сохранение имени, что у «Добавить → Разовый»
      // (миграция 397: имя пишется, пока нет живого кода кассы).
      const names = await db.rpc("payroll_casual_request_quickresto", {
        p_employee_id: value.employeeId,
        p_first_name: value.firstName,
        p_last_name: value.lastName,
      });
      if (names.error)
        return { userId: null, issuedPin: null, notice: null, error: errorText(names.error, "Не удалось подготовить заведение в Quick Resto") };
    }
    try {
      const { pin } = await provisionCasualQuickResto(value.employeeId);
      if (!employee.data.quickresto_pin) issuedPin = pin;
    } catch (e) {
      console.error("[convertCasualToStaff] Quick Resto provisioning failed:", e);
      const reason = quickRestoReason(e);
      // Сотрудник кассы с PIN уже есть, не вышел только доступ к складу —
      // перевод не срываем: код работает, склад можно выдать в Quick Resto.
      const after = await asLooseDb(admin)
        .from<{ quickresto_pin: string | null }>("payroll_employees")
        .select("quickresto_pin")
        .eq("id", value.employeeId)
        .maybeSingle();
      const pin = after.data?.quickresto_pin ?? null;
      if (!pin) return { userId: null, issuedPin: null, notice: null, error: `Не удалось завести сотрудника в Quick Resto: ${reason}` };
      if (!employee.data.quickresto_pin) issuedPin = pin;
      notices.push(`Доступ к складу в Quick Resto не выдан (${reason}) — добавьте его сотруднику в Quick Resto`);
    }
  }

  const created = await createStaffWithoutEmail({
    firstName: value.firstName,
    lastName: value.lastName,
    gender: value.gender,
    phone: value.phone || null,
    roleId: value.roleId,
    venueId,
  });
  const userId = created.member?.user_id ?? null;
  if (created.error || !userId)
    return { userId: null, issuedPin: null, notice: null, error: created.error ?? "Не удалось создать сотрудника" };

  const linked = await db.rpc("payroll_casual_to_staff", { p_employee_id: value.employeeId, p_user_id: userId });
  if (linked.error) {
    // Без привязки новая учётная запись — второй человек: убираем его из
    // команды, затем саму учётную запись. Удаление может упереться в журнал
    // приёма — тогда остаётся профиль без доступа к заведению, в списках его нет.
    await admin.from("user_venue_roles").delete().eq("user_id", userId).eq("venue_id", venueId);
    await dropStaffChatInvites(userId);
    await admin.auth.admin.deleteUser(userId);
    revalidatePath("/people/staff");
    // Выданный код остаётся у разового: перевод можно повторить.
    return { userId: null, issuedPin: null, notice: null, error: errorText(linked.error, "Не удалось перевести сотрудника в штат") };
  }

  // Должность в штате другая — условия оплаты меняются с сегодняшнего дня.
  const today = zonedParts(new Date(), await getActiveAccountTimezone()).date;
  if (employee.data.role_id !== value.roleId) {
    try {
      await assignPayrollPositionOnly(value.employeeId, value.roleId, today);
    } catch (e) {
      notices.push(`Должность в зарплате не изменена: ${errorText(e, "проверьте условия оплаты")}`);
    }
  }
  try {
    await requeuePayrollFrom(today);
  } catch {
    notices.push("Пересчёт зарплаты поставьте вручную (Зарплата → Обновить)");
  }
  // Приглашения в Telegram-чаты поставил createStaffWithoutEmail.
  if (created.notice) notices.push(created.notice);
  revalidatePath("/people/staff");
  revalidatePath("/people/payroll");
  revalidatePath("/schedule");
  return { userId, issuedPin, notice: notices.join(". ") || null, error: null };
}

/** Причина сбоя Quick Resto по-русски: английский текст клиента — в лог, не пользователю. */
function quickRestoReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isBackOfficePermissionError(error))
    return "у пользователя Sheerly Bot в Quick Resto нет прав на этот раздел";
  if (isBackOfficeAuthError(error)) return "Quick Resto не принял вход Sheerly Bot";
  if (/[а-яё]/i.test(message)) return message.replace(/\.$/, "");
  if (/timed out|timeout/i.test(message)) return "Quick Resto не ответил вовремя, повторите";
  return "Quick Resto вернул ошибку, подробности в журнале сервера";
}
