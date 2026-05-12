"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasCustomMailerConfig, sendInvitationEmail } from "@/lib/people/invitations/mailer";
import { revalidatePath } from "next/cache";

export type PendingInvitation = {
  inv_id:    string;
  email:     string;
  role_id:   string;
  role_name: string;
  role_code: string;
  invited_at: string;
};

export type FiredStaffMember = {
  uvr_id:       string;
  user_id:      string;
  role_id:      string;
  role_name:    string;
  role_code:    string;
  first_name:   string | null;
  last_name:    string | null;
  email:        string;
  avatar_url:   string | null;
  fired_at:     string;
  fired_reason: string | null;
};

export type StaffMember = {
  uvr_id:            string;
  user_id:           string;
  role_id:           string;
  role_name:         string;
  role_code:         string;
  first_name:        string | null;
  last_name:         string | null;
  email:             string;
  /** auth.users.email_confirmed_at !== null. false = invite ещё не принят
   *  или сотрудник создан без email (placeholder). */
  email_confirmed:   boolean;
  avatar_url:        string | null;
  phone:             string | null;
  telegram_id:       string | null;
  gender:            string | null;
  birth_date:        string | null;
  employment_date:   string | null;
  /** medical_book_date — срок действия медкнижки («Аттестован до»).
   *  null = поле не заполнено. Используется для бейджа в списке +
   *  daily-cron notification (см. миграцию 135). */
  medical_book_date: string | null;
  joined_at:         string;
  imported_from_quickresto?: boolean;
};

// Тир 1+2 — персональный профиль (user-owned). Видно во всех заведениях.
export type StaffProfile = {
  id:                 string;
  first_name:         string | null;
  last_name:          string | null;
  phone:              string | null;
  telegram_id:        string | null;
  gender:             string | null;
  birth_date:         string | null;
  // ISO timestamp когда birth_date был установлен/обновлён в последний раз.
  // Заполняется триггером tg_profiles_track_birth_date (миграция 132).
  // Видно всем — это «социальная» подпись «дата изменена тогда-то», чтобы
  // нельзя было незаметно перевыставить ДР после поздравления.
  birth_date_set_at:  string | null;
  address:            string | null;
  avatar_url:         string | null;
};

// Тир 3 — account-scoped HR-данные. Видно только админам этого аккаунта.
export type StaffAccountDetails = {
  account_id:          string;
  user_id:             string;
  employment_date:     string | null;
  medical_book_number: string | null;
  medical_book_date:   string | null;
  passport_photos:     string[];
  comment:             string | null;
};

// birth_date_set_at — read-only, заполняется триггером, не апдейтим вручную.
export type ProfileUpdate = Omit<StaffProfile, "id" | "birth_date_set_at">;

export type AccountDetailsUpdate = Omit<
  StaffAccountDetails,
  "account_id" | "user_id"
>;

export async function getStaff(venueId: string): Promise<StaffMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_venue_staff", {
    p_venue_id: venueId,
  });
  if (error) return [];
  return (data ?? []) as StaffMember[];
}

export async function getStaffProfile(
  userId: string
): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, telegram_id, gender, birth_date, birth_date_set_at, address, avatar_url"
    )
    .eq("id", userId)
    .returns<StaffProfile[]>()
    .maybeSingle();
  return data ?? null;
}

export async function updateStaffProfile(
  userId: string,
  data: Partial<ProfileUpdate>
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/people/staff");
  return { error: null };
}

// Account-scoped HR-данные сотрудника: атомарный partial upsert через
// RPC upsert_staff_account_details (миграция 145). Один SQL-statement,
// без race condition'ов и без supabase-js peculiarities.
//
// История:
//   • До #260: использовали .upsert() — но при partial-данных supabase-js
//     дополнял payload null'ами, что затирало другие поля.
//   • #260: ушли на UPDATE-first + fallback INSERT. Решило data-strip,
//     но открыло race: две вкладки одновременно с пустым рядом → обе
//     INSERT → unique-violation у одной (Codex P2).
//   • #265 (this): RPC upsert с INSERT...ON CONFLICT DO UPDATE +
//     per-column CASE WHEN payload ? key — атомарно и race-safe.
//
// Payload передаём как jsonb (`p_data`), RPC сам разбирает какие
// ключи присутствуют и пишет только их.
export async function updateStaffAccountDetails(
  userId: string,
  accountId: string,
  data: Partial<AccountDetailsUpdate>,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // RPC ещё не во вшитых Database типах (миграция 145 свежая) —
  // cast чтобы развязать pipeline до следующей регенерации.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;

  const { error } = await rpc("upsert_staff_account_details", {
    p_account_id: accountId,
    p_user_id: userId,
    p_data: data as Record<string, unknown>,
  });
  if (error) return { error: error.message };

  revalidatePath("/people/staff");
  return { error: null };
}

// PIN терминала — venue-specific, лежит на UVR.
export async function updateStaffTerminalPin(
  uvrId: string,
  pin: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const trimmed = pin?.trim() || null;
  const { error } = await supabase
    .from("user_venue_roles")
    .update({ terminal_pin: trimmed })
    .eq("id", uvrId);
  if (error) return { error: error.message };
  revalidatePath("/people/staff");
  return { error: null };
}

export async function inviteStaff(data: {
  email:   string;
  roleId:  string;
  venueId: string;
}): Promise<{ error: string | null; invitation: PendingInvitation | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован", invitation: null };

  const email = data.email.trim().toLowerCase();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const [{ data: venueRow }, { data: inviterProfile }, { data: roleRow }] = await Promise.all([
    supabase
      .from("venues")
      .select("name, accounts(name)")
      .eq("id", data.venueId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("roles")
      .select("name")
      .eq("id", data.roleId)
      .maybeSingle(),
  ]);

  if (!venueRow?.name) return { error: "Не удалось определить заведение для приглашения", invitation: null };

  const accountName =
    ((venueRow.accounts as { name?: string } | null)?.name ?? null) ||
    null;
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || null;
  const roleName = roleRow?.name ?? null;

  // Keep one pending invite per email+venue to avoid ambiguous acceptance.
  await supabase
    .from("invitations")
    .delete()
    .eq("venue_id", data.venueId)
    .ilike("email", email)
    .eq("status", "pending");

  const { data: insertedInvitation, error: invError } = await supabase
    .from("invitations")
    .insert({
      venue_id:   data.venueId,
      email,
      role_id:    data.roleId,
      invited_by: user.id,
      status:     "pending",
    })
    .select("id")
    .single();

  if (invError || !insertedInvitation?.id) return { error: invError?.message ?? "Не удалось создать приглашение", invitation: null };

  const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(
    `/invite?invitation=${insertedInvitation.id}`
  )}`;

  const admin = createAdminClient();
  const linkPayload = {
    venue_id: data.venueId,
    role_id: data.roleId,
    invitation_id: insertedInvitation.id,
    venue_name: venueRow.name,
    role_name: roleName,
  };
  const hasCustomMailer = hasCustomMailerConfig();

  // Fallback: if custom SMTP mailer is not configured, use built-in Supabase emails.
  if (!hasCustomMailer) {
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: linkPayload,
      redirectTo,
    });

    if (inviteError) {
      const isExistingUserError = inviteError.message
        .toLowerCase()
        .includes("already been registered");

      if (!isExistingUserError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: inviteError.message, invitation: null };
      }

      const { error: otpError } = await admin.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
          data: linkPayload,
        },
      });

      if (otpError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: otpError.message, invitation: null };
      }
    }

    const pendingInvitation: PendingInvitation = {
      inv_id: insertedInvitation.id,
      email,
      role_id: data.roleId,
      role_name: roleName ?? "",
      role_code: "",
      invited_at: new Date().toISOString(),
    };

    revalidatePath("/people/staff");
    return { error: null, invitation: pendingInvitation };
  }

  const { data: inviteLinkData, error: inviteLinkError } =
    await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: linkPayload,
        redirectTo,
      },
    });

  let actionLink: string | null = inviteLinkData?.properties?.action_link ?? null;
  let existingUser = false;

  if (inviteLinkError) {
    const isExistingUserError = inviteLinkError.message
      .toLowerCase()
      .includes("already been registered");

    if (!isExistingUserError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: inviteLinkError.message, invitation: null };
    }

    const { data: magicLinkData, error: magicLinkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          data: linkPayload,
          redirectTo,
        },
      });

    if (magicLinkError || !magicLinkData?.properties?.action_link) {
      await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
      return { error: magicLinkError?.message ?? "Не удалось сгенерировать ссылку приглашения", invitation: null };
    }

    existingUser = true;
    actionLink = magicLinkData.properties.action_link;
  }

  if (!actionLink) {
    await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
    return { error: "Не удалось сгенерировать ссылку приглашения", invitation: null };
  }

  try {
    await sendInvitationEmail({
      to: email,
      actionLink,
      venueName: venueRow.name,
      accountName,
      inviterName,
      roleName,
      existingUser,
    });
  } catch (emailError) {
    await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
    return {
      error:
        emailError instanceof Error
          ? emailError.message
          : "Не удалось отправить письмо-приглашение",
      invitation: null,
    };
  }

  const pendingInvitation: PendingInvitation = {
    inv_id: insertedInvitation.id,
    email,
    role_id: data.roleId,
    role_name: roleName ?? "",
    role_code: "",
    invited_at: new Date().toISOString(),
  };

  revalidatePath("/people/staff");
  return { error: null, invitation: pendingInvitation };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isImportedPlaceholderEmail(value: string): boolean {
  return value.toLowerCase().endsWith("@import.local");
}

// Создаёт сотрудника БЕЗ email (placeholder-auth-user). Используется когда
// сотруднику не нужен личный кабинет — уборщица, повар, кассир — но он
// должен быть в системе для расчётов смен, ЗП, статистики и т.д. Админ
// сам ведёт его карточку. Когда понадобится дать доступ — апгрейдим через
// `setImportedStaffEmailAndInvite` (тот же механизм что и QR-импорт).
export async function createStaffWithoutEmail(data: {
  firstName: string;
  lastName:  string;
  phone:     string | null;
  roleId:    string;
  venueId:   string;
}): Promise<{ error: string | null; member: StaffMember | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован", member: null };

  const firstName = data.firstName.trim();
  const lastName  = data.lastName.trim();
  if (!firstName || !lastName) {
    return { error: "Имя и фамилия обязательны", member: null };
  }

  // Проверка прав: вызывающий должен быть owner/manager/admin в этом venue.
  const { data: callerUvr } = await supabase
    .from("user_venue_roles")
    .select("roles(code)")
    .eq("user_id", user.id)
    .eq("venue_id", data.venueId)
    .eq("status", "active")
    .maybeSingle();
  const callerCode = (callerUvr?.roles as { code: string } | null)?.code ?? null;
  if (!["owner", "manager", "admin"].includes(callerCode ?? "")) {
    return { error: "Недостаточно прав", member: null };
  }

  // Случайный placeholder email и пароль. Email-домен @import.local — тот
  // же что у QR-импорта; UI воспринимает такого юзера как «не зарегистрирован»
  // и разрешает админу править личные поля. Пароль никогда не используется —
  // login через email-OTP при апгрейде до реального email.
  const admin = createAdminClient();
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const placeholderEmail = `noemail_${random}@import.local`;
  const randomPassword = crypto.randomUUID() + crypto.randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: placeholderEmail,
    password: randomPassword,
    email_confirm: true,
    user_metadata: { placeholder: true, created_by: user.id },
  });

  if (createError || !created?.user) {
    return { error: createError?.message ?? "Не удалось создать пользователя", member: null };
  }

  const newUserId = created.user.id;

  // Profile (личные данные). Триггер `handle_new_user` мог создать запись
  // автоматически — поэтому upsert.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({
      id:          newUserId,
      first_name:  firstName,
      last_name:   lastName,
      phone:       data.phone?.trim() || null,
    }, { onConflict: "id" });

  if (profileError) {
    // Откатываем созданного auth user'а если профиль не легёг.
    await admin.auth.admin.deleteUser(newUserId);
    return { error: profileError.message, member: null };
  }

  // UVR (статус active). employment_date в карточке выведется через
  // coalesce(sad.employment_date, uvr.created_at::date) в get_venue_staff.
  const { data: uvrInsert, error: uvrError } = await admin
    .from("user_venue_roles")
    .insert({
      user_id:    newUserId,
      venue_id:   data.venueId,
      role_id:    data.roleId,
      status:     "active",
      invited_by: user.id,
    })
    .select("id, created_at")
    .maybeSingle();

  if (uvrError || !uvrInsert) {
    await admin.auth.admin.deleteUser(newUserId);
    return { error: uvrError?.message ?? "Не удалось добавить в команду", member: null };
  }

  // Дотягиваем имя роли — нужно для оптимистичного рендера в списке.
  const { data: roleRow } = await admin
    .from("roles")
    .select("name, code")
    .eq("id", data.roleId)
    .maybeSingle();

  revalidatePath("/people/staff");

  const member: StaffMember = {
    uvr_id:          uvrInsert.id,
    user_id:         newUserId,
    role_id:         data.roleId,
    role_name:       roleRow?.name ?? "",
    role_code:       roleRow?.code ?? "",
    first_name:      firstName,
    last_name:       lastName,
    email:           placeholderEmail,
    // email_confirmed = true (createUser выставил email_confirmed_at).
    // UI определяет «placeholder» по домену *@import.local — этот флаг
    // здесь только чтобы тип совпадал с DB-реальностью.
    email_confirmed: true,
    avatar_url:      null,
    phone:           data.phone?.trim() || null,
    telegram_id:     null,
    gender:          null,
    birth_date:      null,
    employment_date:   uvrInsert.created_at?.slice(0, 10) ?? null,
    medical_book_date: null,
    joined_at:         uvrInsert.created_at ?? new Date().toISOString(),
  };

  return { error: null, member };
}

// Апгрейд existing placeholder/pending-юзера до реального email + invite.
// Ключевое отличие от inviteStaff: НЕ создаёт ряд в `invitations` (юзер уже
// существует с активным UVR и виден в списке staff). Просто меняет email и
// шлёт magic link для подтверждения.
export async function setImportedStaffEmailAndInvite(data: {
  userId: string;
  email: string;
  roleId: string;
  venueId: string;
}): Promise<{ error: string | null; invitation: PendingInvitation | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован", invitation: null };

  const nextEmail = data.email.trim().toLowerCase();
  if (!isValidEmail(nextEmail)) {
    return { error: "Укажите корректный email", invitation: null };
  }

  const [{ data: canManage }, { data: targetMembership }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "people.invite_staff" }),
    supabase
      .from("user_venue_roles")
      .select("id")
      .eq("user_id", data.userId)
      .eq("venue_id", data.venueId)
      .eq("role_id", data.roleId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (!canManage || !targetMembership) {
    return { error: "Недостаточно прав для отправки приглашения", invitation: null };
  }

  const admin = createAdminClient();

  // Шаг 1: меняем email в auth.users, сбрасываем email_confirmed_at.
  const { error: updateAuthError } = await admin.auth.admin.updateUserById(data.userId, {
    email: nextEmail,
    email_confirm: false,
  });
  if (updateAuthError) {
    return { error: updateAuthError.message, invitation: null };
  }

  // Шаг 2: контекст для письма (имя заведения, аккаунта, приглашающего, роли).
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [{ data: venueRow }, { data: inviterProfile }, { data: roleRow }] = await Promise.all([
    supabase
      .from("venues")
      .select("name, accounts(name)")
      .eq("id", data.venueId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("roles")
      .select("name")
      .eq("id", data.roleId)
      .maybeSingle(),
  ]);

  if (!venueRow?.name) {
    return { error: "Не удалось определить заведение для приглашения", invitation: null };
  }
  const accountName = ((venueRow.accounts as { name?: string } | null)?.name ?? null) || null;
  const inviterName = [inviterProfile?.first_name, inviterProfile?.last_name]
    .filter(Boolean).join(" ") || null;
  const roleName = roleRow?.name ?? null;

  const linkPayload = {
    venue_id: data.venueId,
    role_id: data.roleId,
    venue_name: venueRow.name,
    role_name: roleName,
  };
  const redirectTo = `${siteUrl}/dashboard`;

  // Шаг 3: отправка письма.
  //   • с кастомным SMTP — генерируем link через generateLink, кладём его
  //     в наш брендированный шаблон и отправляем сами;
  //   • без SMTP (локально / без env) — Supabase встроенным mailer'ом
  //     через signInWithOtp(shouldCreateUser=false). generateLink тут не
  //     годится — он только создаёт payload, доставкой не занимается.
  if (hasCustomMailerConfig()) {
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: nextEmail,
      options: {
        data: linkPayload,
        redirectTo,
      },
    });
    if (linkError || !linkData?.properties?.action_link) {
      return {
        error: linkError?.message ?? "Не удалось сгенерировать ссылку для входа",
        invitation: null,
      };
    }
    try {
      await sendInvitationEmail({
        to: nextEmail,
        actionLink: linkData.properties.action_link,
        venueName: venueRow.name,
        accountName,
        inviterName,
        roleName,
        existingUser: true,
      });
    } catch (emailError) {
      return {
        error: emailError instanceof Error
          ? emailError.message
          : "Не удалось отправить письмо",
        invitation: null,
      };
    }
  } else {
    const { error: otpError } = await admin.auth.signInWithOtp({
      email: nextEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
        data: linkPayload,
      },
    });
    if (otpError) {
      return { error: otpError.message, invitation: null };
    }
  }

  revalidatePath("/people/staff");
  // Возвращаем invitation = null, т.к. строки в `invitations` мы не создавали —
  // юзер уже в списке staff, отдельная "Ожидает"-строка не нужна.
  return { error: null, invitation: null };
}

export async function inviteImportedStaffByCurrentEmail(data: {
  userId: string;
  roleId: string;
  venueId: string;
}): Promise<{ error: string | null; invitation: PendingInvitation | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован", invitation: null };

  const [{ data: canManage }, { data: targetMembership }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "people.invite_staff" }),
    supabase
      .from("user_venue_roles")
      .select("id")
      .eq("user_id", data.userId)
      .eq("venue_id", data.venueId)
      .eq("role_id", data.roleId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (!canManage || !targetMembership) {
    return { error: "Недостаточно прав для отправки приглашения", invitation: null };
  }

  const admin = createAdminClient();
  const {
    data: { user: targetUser },
    error: targetError,
  } = await admin.auth.admin.getUserById(data.userId);

  if (targetError || !targetUser?.email) {
    return { error: targetError?.message ?? "Не удалось получить email сотрудника", invitation: null };
  }

  const email = targetUser.email.toLowerCase();
  if (isImportedPlaceholderEmail(email)) {
    return { error: "У сотрудника пока нет реального email", invitation: null };
  }

  if (!isValidEmail(email)) {
    return { error: "Некорректный email сотрудника", invitation: null };
  }

  const inviteResult = await inviteStaff({
    email,
    roleId: data.roleId,
    venueId: data.venueId,
  });

  revalidatePath("/people/staff");
  return inviteResult;
}

export async function updateStaffRole(
  uvrId:  string,
  roleId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_venue_roles")
    .update({ role_id: roleId })
    .eq("id", uvrId);

  if (error) return { error: error.message };
  revalidatePath("/people/staff");
  return { error: null };
}

export async function fireStaff(
  uvrId: string,
  reason: string,
): Promise<{ error: string | null }> {
  const trimmed = reason?.trim() ?? "";
  // Server-side guard: причина увольнения обязательна — UI-кнопка
  // дизейблится при пустом поле, но не полагаемся только на это
  // (request может прилететь и не из нашего dialog'а).
  if (trimmed.length === 0) {
    return { error: "Укажите причину увольнения" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_venue_roles")
    .update({
      status: "fired",
      fired_at: new Date().toISOString(),
      fired_reason: trimmed,
    } as Record<string, unknown>)
    .eq("id", uvrId);

  if (error) return { error: error.message };
  revalidatePath("/people/staff");
  return { error: null };
}

export async function restoreStaff(
  uvrId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_venue_roles")
    .update({ status: "active", fired_at: null, fired_reason: null } as Record<string, unknown>)
    .eq("id", uvrId);

  if (error) return { error: error.message };
  revalidatePath("/people/staff");
  return { error: null };
}

export async function getFiredStaff(venueId: string): Promise<FiredStaffMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_fired_staff", {
    p_venue_id: venueId,
  });
  if (error) return [];
  return (data ?? []) as FiredStaffMember[];
}

export async function getPendingInvitations(
  venueId: string
): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role_id, created_at, roles(name, code)")
    .eq("venue_id", venueId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((inv) => ({
    inv_id:     inv.id,
    email:      inv.email,
    role_id:    inv.role_id,
    role_name:  (inv.roles as { name: string; code: string } | null)?.name ?? "",
    role_code:  (inv.roles as { name: string; code: string } | null)?.code ?? "",
    invited_at: inv.created_at,
  }));
}

export async function cancelInvitation(
  invId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", invId);

  if (error) return { error: error.message };
  revalidatePath("/people/staff");
  return { error: null };
}
