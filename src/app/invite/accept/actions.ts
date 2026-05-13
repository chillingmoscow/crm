"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Принимает invite-токен + пароль и завершает onboarding юзера:
 *
 *   1. Валидирует token (pending, не истёк).
 *   2. Проверяет существует ли user с этим email:
 *      • если есть — sign-in по паролю (если пароль не подошёл — error).
 *      • если нет — создаёт через admin.auth.admin.createUser
 *        (с email_confirm=true, чтобы не дёргать GoTrue email-flow),
 *        затем sign-in.
 *   3. Принимает ВСЕ pending-invitations этого email (multi-tenant —
 *      если юзер пришёл по одному из, активируем все его membership'ы).
 *      Дублирует /invite — там та же логика для уже-залогиненного юзера.
 *   4. Помечает invitations.status='accepted'.
 *   5. Возвращает success — клиент сам редиректит на /profile?welcome=1.
 *
 * Возвращает `{ error: string | null; redirect?: string }`. redirect
 * клиент использует для router.push после успеха.
 */
export async function acceptInvitation(
  token: string,
  password: string,
): Promise<{ error: string | null; redirect?: string }> {
  if (!token || token.length < 8) return { error: "Ссылка некорректна" };
  if (!password || password.length < 6) {
    return { error: "Пароль должен быть не короче 6 символов" };
  }

  const admin = createAdminClient();

  // 1. Lookup invitation by token. Используем admin client — service_role
  //    bypassит RLS (мы не хотим public read-policy на invitations,
  //    это leak'нет email'ы pending-инвайтов через перебор UUID).
  const { data: invitation, error: lookupError } = await admin
    .from("invitations")
    .select("id, venue_id, role_id, email, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (lookupError) return { error: `Не удалось проверить ссылку: ${lookupError.message}` };
  if (!invitation) return { error: "Ссылка не найдена. Возможно, она уже использована или отозвана." };
  if (invitation.status !== "pending") {
    return { error: "Приглашение уже принято или отменено." };
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return { error: "Срок действия ссылки истёк. Попросите администратора прислать новое приглашение." };
  }

  const email = invitation.email.toLowerCase();

  // 2. Существует ли user с таким email? Через RPC (миграция 151) —
  //    listUsers() возвращает только первую страницу, на больших базах
  //    existing-юзера пропустит и попытается createUser, который потом
  //    упадёт на «already registered» (Codex P1 на #271).
  const lookupRpc = admin.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data: existingUserId } = await lookupRpc(
    "lookup_user_id_by_email",
    { p_email: email },
  );
  const existing = existingUserId ? { id: existingUserId } : null;

  let userId: string;
  if (existing) {
    // Sign-in под существующим. Пароль — текущий пароль юзера, не из
    // invite-формы. Если юзер забыл — пусть восстановит через
    // /forgot-password, потом снова откроет ссылку приглашения.
    userId = existing.id;
  } else {
    // Создаём через admin API. email_confirm: true — чтобы GoTrue не
    // отправлял подтверждающее письмо через свой SMTP (у нас он не
    // настроен; этот же паттерн уже в /auth/confirm-email-change).
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { invited_via: "custom_flow" },
      });
    if (createError || !created?.user) {
      return { error: createError?.message ?? "Не удалось создать пользователя" };
    }
    userId = created.user.id;
  }

  // 3. Sign-in устанавливает сессию-куки в браузере. Для этого
  //    нужен серверный client (createClient — он же читает/пишет cookies
  //    через next/headers). Service_role не умеет sign-in пароль —
  //    только regular client.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    // Для existing user'а с неправильным паролем — понятный текст.
    if (existing) {
      return {
        error: "Этот email уже зарегистрирован. Если это вы — введите свой существующий пароль или восстановите его через «Забыли пароль?» на странице входа.",
      };
    }
    return { error: signInError.message };
  }

  // 4. Принимаем ВСЕ pending-invitations этого email (multi-tenant
  //    pattern из /invite). Текущая invitation тоже сюда попадает.
  const nowIso = new Date().toISOString();
  const { data: pending } = await admin
    .from("invitations")
    .select("id, venue_id, role_id")
    .ilike("email", email)
    .eq("status", "pending")
    .gt("expires_at", nowIso);
  const pendingList = (pending ?? []) as Array<{
    id: string;
    venue_id: string;
    role_id: string;
  }>;

  if (pendingList.length > 0) {
    await admin.from("user_venue_roles").upsert(
      pendingList.map((inv) => ({
        user_id: userId,
        venue_id: inv.venue_id,
        role_id: inv.role_id,
        status: "active" as const,
      })),
      { onConflict: "user_id,venue_id" },
    );

    await admin
      .from("invitations")
      .update({ status: "accepted" })
      .in(
        "id",
        pendingList.map((inv) => inv.id),
      );
  }

  // 5. Активный venue юзера = тот, который из текущей invitation
  //    (тот, по которой он пришёл).
  await admin
    .from("profiles")
    .update({ active_venue_id: invitation.venue_id })
    .eq("id", userId);

  // 6. Проверяем заполненность профиля — если нет, шлём на /profile
  //    с welcome-баннером (та же логика что в /invite).
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name, phone, telegram_id")
    .eq("id", userId)
    .maybeSingle();

  const profileComplete =
    !!profile?.first_name &&
    !!profile?.last_name &&
    !!profile?.phone &&
    !!profile?.telegram_id;

  return {
    error: null,
    redirect: profileComplete ? "/dashboard" : "/profile?welcome=1",
  };
}
