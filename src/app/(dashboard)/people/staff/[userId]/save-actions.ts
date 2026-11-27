"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorText } from "@/lib/actions/error-text";
import { genderSchema } from "@/lib/people/gender";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { updateStaffAccountDetails, updateStaffRole } from "../actions";

/**
 * Сохранение карточки сотрудника одной командой.
 *
 * Раньше полоса сохранения вызывала четыре действия подряд (профиль, данные
 * аккаунта, PIN, должность). Next.js выполняет действия из браузера по одному,
 * и каждое со своим `revalidatePath` перерисовывало тяжёлую карточку заново.
 * Теперь клиент присылает только изменённые части, сервер пишет их
 * параллельно и перерисовывает карточку один раз.
 */

const text = z.string().nullable();

const changesSchema = z.object({
  userId: z.string().uuid("Сотрудник не найден"),
  uvrId: z.string().uuid("Сотрудник не найден"),
  profile: z
    .object({
      first_name: z.string().min(1, "Укажите имя"),
      last_name: z.string().min(1, "Укажите фамилию"),
      phone: text,
      telegram_id: text,
      gender: genderSchema,
      birth_date: text,
      address: text,
    })
    .partial()
    .optional(),
  accountDetails: z
    .object({
      employment_date: z.string().min(1, "Укажите дату трудоустройства"),
      comment: text,
    })
    .partial()
    .optional(),
  terminalPin: z.string().nullable().optional(),
  role: z
    .object({
      roleId: z.string().uuid("Выберите должность"),
      validFrom: z.string(),
    })
    .optional(),
});

export type StaffCardChanges = z.input<typeof changesSchema>;

export type SaveStaffCardResult = {
  error: string | null;
  notices?: string[];
};

const NO_ROWS = { message: "Нет права изменять этого сотрудника или запись изменилась" };

export async function saveStaffCard(input: StaffCardChanges): Promise<SaveStaffCardResult> {
  try {
    return await save(input);
  } catch (error) {
    console.error(error);
    return { error: errorText(error, "Не удалось сохранить данные сотрудника") };
  }
}

async function save(input: StaffCardChanges): Promise<SaveStaffCardResult> {
  const parsed = changesSchema.safeParse(input);
  if (!parsed.success) return { error: errorText(parsed.error, "Проверьте введённые данные") };
  const changes = parsed.data;

  const [supabase, can, accountId] = await Promise.all([
    createClient(),
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
  ]);
  // Карточку правит только тот, у кого есть право редактировать сотрудников;
  // PIN терминала по тому же праву и виден, и меняется.
  if (!can("people.edit_staff")) return { error: "Нет права редактировать сотрудников" };
  if (!accountId) return { error: "Выберите заведение" };

  const profile = changes.profile && Object.keys(changes.profile).length > 0 ? changes.profile : null;
  const details =
    changes.accountDetails && Object.keys(changes.accountDetails).length > 0
      ? changes.accountDetails
      : null;

  // Части независимы: пишем параллельно, ошибки собираем, а не обрываем
  // остальные записи (как и прежде, когда это были четыре действия).
  const results = await Promise.all([
    profile
      ? supabase
          .from("profiles")
          .update(profile)
          .eq("id", changes.userId)
          .select("id")
          .then(({ data, error }) =>
            error || !data?.length
              ? { error: errorText(error ?? NO_ROWS, "Не удалось сохранить профиль сотрудника") }
              : { error: null },
          )
      : null,
    details ? updateStaffAccountDetails(changes.userId, accountId, details) : null,
    changes.terminalPin !== undefined
      ? supabase
          .from("user_venue_roles")
          .update({ terminal_pin: changes.terminalPin?.trim() || null })
          .eq("id", changes.uvrId)
          .eq("user_id", changes.userId)
          .select("id")
          .then(({ data, error }) =>
            error || !data?.length
              ? { error: errorText(error ?? NO_ROWS, "Не удалось сохранить PIN-код") }
              : { error: null },
          )
      : null,
    changes.role
      ? updateStaffRole(changes.uvrId, changes.role.roleId, changes.role.validFrom)
      : null,
  ]);

  const attempted = results.filter((r) => r !== null);
  const errors = attempted.map((r) => r.error).filter((e): e is string => Boolean(e));
  const roleResult = results[3];
  const notices = roleResult?.notice ? [roleResult.notice] : [];

  // Одна перерисовка карточки и списка, если хоть что-то записалось.
  if (attempted.length > errors.length) revalidatePath("/people/staff", "layout");

  return errors.length > 0
    ? { error: errors.join(" · "), notices }
    : { error: null, notices };
}
