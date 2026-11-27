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
import { dropStaffChatInvites, queueStaffChatInvites } from "@/lib/people/chat-invites-queue";
import { normalizeTelegramId, telegramIdError } from "@/lib/people/telegram-id";
import { processCasualDismissal } from "@/lib/payroll/casual-dismissal";

export type CasualResult = {
  id: string | null;
  pin: string | null;
  error: string | null;
  /** Предупреждение: разовый заведён, но приглашения в чаты не поставлены. */
  notice?: string | null;
};

const nameSchema = z.object({
  firstName: z.string().trim().min(1, "Укажите имя").max(80),
  lastName: z.string().trim().min(1, "Укажите фамилию").max(80),
});

async function provision(id: string, chatInvites: boolean): Promise<CasualResult> {
  try {
    const { pin } = await provisionCasualQuickResto(id);
    // Разовых в чаты зовут только по переключателю в форме (по умолчанию
    // выключен). Учётной записи у разового нет — в журнале приглашений он
    // записан идентификатором своей записи в зарплате.
    let notice: string | null = null;
    if (chatInvites) {
      const row = await asLooseDb(createAdminClient())
        .from<{ venue_id: string; role_id: string | null; name: string }>("payroll_employees")
        .select("venue_id,role_id,name")
        .eq("id", id)
        .single();
      notice = row.data
        ? await queueStaffChatInvites({
            venueId: row.data.venue_id,
            userId: id,
            roleId: row.data.role_id,
            name: row.data.name,
            eventKey: `casual-hire:${id}`,
          })
        : "Приглашения в чаты Telegram не отправлены — пригласите сотрудника вручную";
    }
    return { id, pin, error: null, notice };
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
  /** Пригласить в Telegram-чаты должности (по умолчанию нет). */
  chatInvites?: boolean;
  /** Обязателен при chatInvites: без него бот не исключит из чатов при увольнении. */
  telegramId?: string | null;
}): Promise<CasualResult> {
  const parsed = nameSchema.extend({ roleId: z.string().uuid("Выберите должность") }).safeParse(input);
  if (!parsed.success) return { id: null, pin: null, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const tgError = telegramIdError(input.telegramId, input.chatInvites === true);
  if (tgError) return { id: null, pin: null, error: tgError };
  const db = asLooseDb(await createClient());
  const created = await db.rpc("payroll_casual_create", {
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_role_id: parsed.data.roleId,
  });
  if (created.error || typeof created.data !== "string")
    return { id: null, pin: null, error: errorText(created.error, "Не удалось добавить разового сотрудника") };
  const saved = await saveTelegramId(db, created.data, input.telegramId);
  if (saved) return { id: created.data, pin: null, error: saved };
  return provision(created.data, input.chatInvites === true);
}

// Пустой ID не затирает уже вписанный (форма повторного заведения его не показывает).
async function saveTelegramId(db: ReturnType<typeof asLooseDb>, id: string, telegramId: string | null | undefined) {
  const value = normalizeTelegramId(telegramId);
  if (value === null) return null;
  const r = await db.rpc("payroll_casual_set_telegram_id", { p_employee_id: id, p_telegram_id: value });
  return r.error ? errorText(r.error, "Не удалось сохранить Telegram ID") : null;
}

// For a casual worker created earlier without a Quick Resto code, or a retry
// after a failed attempt.
export async function provisionCasualEmployee(input: {
  id: string;
  firstName: string;
  lastName: string;
  chatInvites?: boolean;
  telegramId?: string | null;
}): Promise<CasualResult> {
  const parsed = nameSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { id: null, pin: null, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const tgError = telegramIdError(input.telegramId, input.chatInvites === true);
  if (tgError) return { id: parsed.data.id, pin: null, error: tgError };
  const db = asLooseDb(await createClient());
  const saved = await saveTelegramId(db, parsed.data.id, input.telegramId);
  if (saved) return { id: parsed.data.id, pin: null, error: saved };
  const requested = await db.rpc("payroll_casual_request_quickresto", {
    p_employee_id: parsed.data.id,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
  });
  if (requested.error) return { id: parsed.data.id, pin: null, error: errorText(requested.error, "Не удалось подготовить заведение в Quick Resto") };
  return provision(parsed.data.id, input.chatInvites === true);
}

const convertSchema = nameSchema.extend({
  employeeId: z.string().uuid(),
  gender: genderSchema,
  phone: z.string().trim().max(40).optional(),
  roleId: z.string().uuid("Выберите должность"),
  chatInvites: z.boolean().optional(),
  telegramId: z.string().optional(),
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
  const tgError = telegramIdError(value.telegramId, value.chatInvites === true);
  if (tgError) return { userId: null, issuedPin: null, notice: null, error: tgError };
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
    chatInvites: value.chatInvites === true,
    telegramId: normalizeTelegramId(value.telegramId),
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
  // Приглашения в Telegram-чаты (если включены) поставил createStaffWithoutEmail.
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

export type DismissCasualResult = {
  /** Всё закрыто: Quick Resto и чаты. */
  done: boolean;
  /** Не закрыто — что осталось; сервер повторит сам, есть и «Повторить». */
  pending: string | null;
  error: string | null;
};

/**
 * Уволить разового: запись зарплаты перестаёт быть активной, сотрудник Quick
 * Resto удаляется, человек исключается из всех чатов организации. Повторный
 * вызов продолжает незавершённое увольнение (подхватывает исправленный
 * Telegram ID).
 */
export async function dismissCasualEmployee(input: {
  id: string;
  /** Пусто — оставить записанный ID. */
  telegramId?: string | null;
  /** Человека не было в чатах, ID нет: шаг чатов пропускается. */
  withoutChats?: boolean;
}): Promise<DismissCasualResult> {
  const parsed = z.string().uuid().safeParse(input.id);
  if (!parsed.success) return { done: false, pending: null, error: "Разовый сотрудник не найден" };
  // Как у штатных: увольняет тот, кто ведёт сотрудников (база проверит то же).
  const can = await getCachedPermissionChecker();
  if (!can("people.edit_staff") || !can("people.invite_staff"))
    return { done: false, pending: null, error: "Нет права увольнять сотрудников" };
  const tgError = telegramIdError(input.telegramId, false);
  if (tgError) return { done: false, pending: null, error: tgError };
  const started = await asLooseDb(await createClient()).rpc("payroll_casual_dismiss", {
    p_employee_id: parsed.data,
    p_telegram_id: normalizeTelegramId(input.telegramId),
    p_without_chats: input.withoutChats === true,
  });
  if (started.error || typeof started.data !== "string")
    return { done: false, pending: null, error: errorText(started.error, "Не удалось уволить сотрудника") };
  // Неиспользованные задания приглашений больше не нужны.
  await dropStaffChatInvites(parsed.data).catch(() => undefined);
  let pending: string | null = null;
  try {
    const ran = await processCasualDismissal(started.data);
    if (!ran) pending = "Увольнение уже обрабатывается — обновите страницу через минуту";
  } catch (e) {
    pending = errorText(e, "Не удалось закрыть доступ в Quick Resto и чатах");
  }
  revalidatePath("/people/staff");
  revalidatePath("/people/payroll");
  revalidatePath("/schedule");
  return { done: pending === null, pending, error: null };
}
