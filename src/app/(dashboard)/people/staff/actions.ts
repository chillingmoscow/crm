"use server";

import { randomUUID } from "node:crypto";

import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
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
  department_id:     string | null;
  department_name:   string | null;
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
  /** Есть ли неотозванное приглашение на email сотрудника (выставляется на
   *  странице списка). Признак «приглашён, но не активировал». */
  has_pending_invite?: boolean;
  /** user_metadata.needs_password_setup — приглашён, но пароль не задан.
   *  Надёжнее has_pending_invite: переживает потерю строки-инвайта
   *  (приходит из get_venue_staff, миграция 213). */
  needs_password_setup?: boolean;
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
  // `.bind(supabase)` обязателен: без него `this.rest` теряется и
  // SupabaseClient.rpc падает с "Cannot read properties of undefined".
  const rpc = (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  ).bind(supabase);

  const { error } = await rpc("upsert_staff_account_details", {
    p_account_id: accountId,
    p_user_id: userId,
    p_data: data as Record<string, unknown>,
  });
  if (error) return { error: error.message };

  // revalidatePath на динамический сегмент — без `layout` revalidate'ятся
  // только листовые роуты, а /people/staff/[userId] остаётся в cache'е
  // и при F5 рендерится со старыми RSC-payload'ами. Это и был один из
  // подозреваемых при «бейдж висит, но в карточке пусто».
  revalidatePath("/people/staff", "layout");
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

  // Custom invite flow (см. миграцию 150 + /invite/accept).
  //
  // Раньше использовали admin.auth.admin.generateLink({type:'invite'}),
  // но GoTrue email-link редиректит юзера на свой SITE_URL (= Supabase
  // Studio в нашем self-hosted setup'е), а не на наше приложение. Чтобы
  // навсегда отвязаться от GoTrue email-flow и не зависеть от env'ов
  // на проде, генерируем свой токен в invitations.token и шлём
  // /invite/accept?token=... через наш nodemailer. Приём токена,
  // создание/sign-in user'а и активация UVR — на стороне /invite/accept.

  const admin = createAdminClient();

  // Проверяем существует ли уже user с таким email — это меняет текст
  // письма-приглашения ("Войдите" vs "Создайте пароль") и определяет
  // что покажет /invite/accept. listUsers() возвращает только первую
  // страницу (Codex P1 на #271) — используем RPC через миграцию 151,
  // прямой запрос в auth.users по email.
  //
  // КРИТИЧНО: cast'им весь клиент, не extract'им .rpc как функцию —
  // иначе теряется this-binding и .rpc внутри упадёт «Cannot read this».
  // Тот же паттерн что в (dashboard)/layout.tsx для count_venue_staff_attention.
  const adminUntyped = admin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{
      data: string | null;
      error: { message: string } | null;
    }>;
  };
  const { data: existingUserId } = await adminUntyped.rpc(
    "lookup_user_id_by_email",
    { p_email: email },
  );
  const existingUser = !!existingUserId;

  // Email-conflict guard (issue #270): не приглашаем на email который
  // уже member venue (uvr active). Раньше создавался дубликат "Ожидает"
  // в списке staff. existingUser в auth.users разрешён (он войдёт под
  // своим паролем — invite просто добавит ему membership), но если он
  // УЖЕ член нашего venue — invite не нужен.
  if (existingUserId) {
    const { data: existingMembership } = await admin
      .from("user_venue_roles")
      .select("id")
      .eq("user_id", existingUserId)
      .eq("venue_id", data.venueId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (existingMembership) {
      return {
        error: "Этот пользователь уже работает в заведении.",
        invitation: null,
      };
    }
  }

  // Keep one pending invite per email+venue to avoid ambiguous acceptance.
  await supabase
    .from("invitations")
    .delete()
    .eq("venue_id", data.venueId)
    .ilike("email", email)
    .eq("status", "pending");

  const token = randomUUID();

  const { data: insertedInvitation, error: invError } = await supabase
    .from("invitations")
    .insert({
      venue_id:   data.venueId,
      email,
      role_id:    data.roleId,
      invited_by: user.id,
      status:     "pending",
      token,
    })
    .select("id")
    .single();

  if (invError || !insertedInvitation?.id) {
    return { error: invError?.message ?? "Не удалось создать приглашение", invitation: null };
  }

  const actionLink = `${siteUrl}/invite/accept?token=${token}`;

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
    // SMTP-сбой: чистим только что созданный invitation (без письма он
    // мёртвый — юзер ничего не получит, лучше дать админу попробовать
    // заново).
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
    department_id:   null,
    department_name: null,
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

  const [can, { data: targetMembership }] = await Promise.all([
    getCachedPermissionChecker(),
    supabase
      .from("user_venue_roles")
      .select("id")
      .eq("user_id", data.userId)
      .eq("venue_id", data.venueId)
      .eq("role_id", data.roleId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const canManage = can("people.invite_staff");

  if (!canManage || !targetMembership) {
    return { error: "Недостаточно прав для отправки приглашения", invitation: null };
  }

  // SMTP проверяем ДО мутации auth.users: иначе при ненастроенном SMTP мы бы
  // сменили email/сбросили подтверждение и вышли с ошибкой — сотрудник остался
  // бы с изменённым неподтверждённым email и без ссылки-приглашения (Codex P1).
  if (!hasCustomMailerConfig()) {
    return { error: "SMTP mailer не настроен", invitation: null };
  }

  const admin = createAdminClient();

  // Шаг 1: ставим флаг needs_password_setup (своего пароля у сотрудника ещё
  // нет — задаст его на /invite/accept) и при необходимости меняем email.
  // Если email тот же (повторная отправка) — НЕ дёргаем смену email, чтобы не
  // запускать в GoTrue email-change flow на тот же адрес; обновляем только
  // metadata. Иначе — меняем email и сбрасываем подтверждение.
  const { data: targetForMeta } = await admin.auth.admin.getUserById(data.userId);
  const currentEmail = (targetForMeta?.user?.email ?? "").toLowerCase();
  const emailUnchanged = currentEmail === nextEmail;
  const mergedMeta = {
    ...((targetForMeta?.user?.user_metadata as Record<string, unknown> | undefined) ?? {}),
    needs_password_setup: true,
  };
  const { error: updateAuthError } = await admin.auth.admin.updateUserById(
    data.userId,
    emailUnchanged
      ? { user_metadata: mergedMeta }
      : { email: nextEmail, email_confirm: false, user_metadata: mergedMeta },
  );
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

  // Шаг 3: кастомный invite-flow (как в inviteStaff), НЕ через GoTrue
  // email-link. GoTrue-ссылка ведёт на свой SITE_URL (Supabase-домен с
  // basic-auth) и не попадает в наше приложение — см. подробный коммент в
  // inviteStaff. Генерим токен в invitations и шлём /invite/accept?token=.
  // (SMTP уже проверили выше, до мутации auth.users.)

  // Один pending-invite на email+venue. ВАЖНО — порядок безопасный:
  // сначала вставляем новый инвайт и шлём письмо, и только ПОСЛЕ успешной
  // отправки удаляем прочие pending-инвайты этого email+venue. Раньше старый
  // удалялся ДО вставки нового — при сбое (вставка/SMTP) сотрудник оставался
  // вообще без приглашения: старый токен уже удалён, новый откатан. Теперь
  // при сбое удаляется только новая строка, а прежний (рабочий) инвайт цел —
  // повторная отправка остаётся возможной (Codex P1 на #441).
  const token = randomUUID();
  const { data: insertedInvitation, error: invError } = await supabase
    .from("invitations")
    .insert({
      venue_id: data.venueId,
      email: nextEmail,
      role_id: data.roleId,
      invited_by: user.id,
      status: "pending",
      token,
    })
    .select("id")
    .single();
  if (invError || !insertedInvitation?.id) {
    return { error: invError?.message ?? "Не удалось создать приглашение", invitation: null };
  }

  const actionLink = `${siteUrl}/invite/accept?token=${token}`;
  try {
    await sendInvitationEmail({
      to: nextEmail,
      actionLink,
      venueName: venueRow.name,
      accountName,
      inviterName,
      roleName,
      // false → письмо и форма просят СОЗДАТЬ пароль (у placeholder-юзера
      // его ещё нет), хотя auth-строка уже существует.
      existingUser: false,
    });
  } catch (emailError) {
    // Откатываем только что созданную строку; прежние pending-инвайты не
    // трогали — прежняя ссылка-приглашение продолжает работать.
    await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
    return {
      error: emailError instanceof Error ? emailError.message : "Не удалось отправить письмо",
      invitation: null,
    };
  }

  // Письмо ушло — теперь чистим прежние pending-инвайты того же email+venue
  // (кроме только что созданного), чтобы остался ровно один актуальный. Это
  // best-effort: даже если delete не пройдёт, у сотрудника будет валидный
  // (свежедоставленный) токен — не критично.
  await supabase
    .from("invitations")
    .delete()
    .eq("venue_id", data.venueId)
    .ilike("email", nextEmail)
    .eq("status", "pending")
    .neq("id", insertedInvitation.id);

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

  const [can, { data: targetMembership }] = await Promise.all([
    getCachedPermissionChecker(),
    supabase
      .from("user_venue_roles")
      .select("id")
      .eq("user_id", data.userId)
      .eq("venue_id", data.venueId)
      .eq("role_id", data.roleId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const canManage = can("people.invite_staff");

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

  // Право на UPDATE user_venue_roles гейтит RLS-политика
  // (has_permission('people.edit_staff')). Дополнительно проверяем, что
  // назначаемая роль принадлежит тому же venue, что и членство — RLS на
  // user_venue_roles не имеет WITH CHECK, поэтому без этого можно было бы
  // переподключить сотрудника на роль чужого заведения. Owner (venue_id
  // NULL) через staff-UI не назначается — он не из списка venue-ролей.
  const { data: uvr } = await supabase
    .from("user_venue_roles")
    .select("venue_id, user_id")
    .eq("id", uvrId)
    .maybeSingle();
  if (!uvr) return { error: "Сотрудник не найден" };

  const { data: role } = await supabase
    .from("roles")
    .select("venue_id, archived_at")
    .eq("id", roleId)
    .maybeSingle();
  if (!role || role.venue_id !== uvr.venue_id) {
    return { error: "Должность недоступна для этого заведения" };
  }
  // Архивную роль назначать нельзя. RLS прячет архивные от обычных членов,
  // но owner их видит (roles_select_archived_owner, миграция 203) — поэтому
  // в пикере у владельца они могут всплыть. Серверный отказ — точка истины.
  if (role.archived_at) {
    return { error: "Нельзя назначить архивную должность" };
  }

  const { error } = await supabase
    .from("user_venue_roles")
    .update({ role_id: roleId })
    .eq("id", uvrId);

  if (error) return { error: error.message };

  // Синхронизируем неактивированное приглашение этого сотрудника в это
  // заведение. Иначе acceptInvitation (upsert по onConflict user_id,venue_id)
  // при активации перезапишет role_id обратно на старую роль из инвайта и
  // затрёт только что сделанную смену. Касается импортированных/pending
  // сотрудников, у которых UVR уже есть, но инвайт ещё не принят.
  const admin = createAdminClient();
  const { data: authData } = await admin.auth.admin.getUserById(uvr.user_id);
  const email = authData?.user?.email;
  if (email) {
    await admin
      .from("invitations")
      .update({ role_id: roleId })
      .eq("venue_id", uvr.venue_id)
      .ilike("email", email)
      .eq("status", "pending");
  }

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
