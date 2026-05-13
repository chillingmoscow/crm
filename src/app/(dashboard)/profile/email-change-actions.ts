"use server";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendEmailChangeConfirmation,
  sendEmailChangeAlert,
} from "@/lib/people/email-change/mailer";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Запрос смены email: создаёт pending-запись и отправляет письмо с
 * confirm-ссылкой на НОВЫЙ email. Подтверждение завершается в
 * route-handler'е `/auth/confirm-email-change` (тот вызывает
 * `auth.admin.updateUserById` через service-role и помечает запрос
 * как consumed).
 *
 * Обход встроенного `supabase.auth.updateUser({ email })`: его GoTrue
 * пытается отправить письмо через свой собственный SMTP, который у нас
 * на проде не настроен → юзер получал «Error sending email change
 * email». Кастомный flow использует общий nodemailer (Yandex Postbox).
 */
export async function requestEmailChange(
  newEmail: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const normalized = newEmail.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) {
    return { error: "Некорректный формат email" };
  }
  if (normalized === user.email?.toLowerCase()) {
    return { error: "Новый email совпадает с текущим" };
  }

  const admin = createAdminClient();

  // Email-conflict guard (issue #270): не даём сменить на email,
  // который уже используется. Раньше пропускали — confirm-route
  // ловил конфликт через auth.admin.updateUserById. Но это создавало
  // pending-инвайт для email'а, который уже занят (если pending был
  // в нашем аккаунте), либо confusing «не могу обновить» в UI после
  // долгого подтверждения. Проверяем заранее с обобщённой ошибкой
  // (без раскрытия где конкретно занят — защита от enumeration).
  const adminUntyped = admin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{
      data: string | null;
      error: { message: string } | null;
    }>;
  };
  const { data: existingUserId } = await adminUntyped.rpc(
    "lookup_user_id_by_email",
    { p_email: normalized },
  );
  if (existingUserId && existingUserId !== user.id) {
    return {
      error:
        "Этот email уже используется в системе. Если это вы — войдите под ним. Если приглашаете коллегу — попросите его указать другой адрес.",
    };
  }

  // Также проверяем pending invitations — email мог быть приглашён
  // (даже если ещё не зарегистрирован в auth.users), и тогда pending
  // invitation создаст коллизию когда тот примет.
  const { data: pendingInvite } = await admin
    .from("invitations")
    .select("id")
    .ilike("email", normalized)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (pendingInvite) {
    return {
      error:
        "Этот email уже используется в системе. Если это вы — войдите под ним. Если приглашаете коллегу — попросите его указать другой адрес.",
    };
  }

  // email_change_requests (migration 139) ещё не во вшитых Database
  // типах — cast чтобы развязать pipeline до регенерации.
  const ecr = (admin.from as (t: string) => unknown)(
    "email_change_requests",
  ) as {
    delete: () => {
      eq: (col: string, v: string) => {
        is: (col: string, v: null) => Promise<unknown>;
      };
    };
    insert: (
      row: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  };

  // Старые pending-запросы юзера убиваем (один активный за раз — чтобы
  // не плодить токены, по которым потом непонятно куда).
  await ecr.delete().eq("user_id", user.id).is("consumed_at", null);

  const token = randomUUID();

  const { error: insertError } = await ecr.insert({
    user_id: user.id,
    new_email: normalized,
    token,
  });
  if (insertError) {
    return { error: insertError.message };
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
    .replace(/\/$/, "");
  const actionLink = `${siteUrl}/auth/confirm-email-change?token=${token}`;
  const revokeLink = `${siteUrl}/auth/revoke-email-change?token=${token}`;

  // Имя для приветствия в письме — берём из profiles, если есть.
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    null;

  try {
    await sendEmailChangeConfirmation({
      to: normalized,
      actionLink,
      previousEmail: user.email ?? "—",
      displayName,
    });
  } catch (e) {
    // SMTP-сбой confirm-письма: чистим только что созданный pending-
    // токен, чтобы юзер мог сразу попробовать ещё раз (новый токен), и
    // не было «висящих» никем не доставленных запросов.
    const ecrCleanup = (admin.from as (t: string) => unknown)(
      "email_change_requests",
    ) as {
      delete: () => { eq: (col: string, v: string) => Promise<unknown> };
    };
    await ecrCleanup.delete().eq("token", token);
    const msg = e instanceof Error ? e.message : "Не удалось отправить письмо";
    return { error: msg };
  }

  // Alert на старый email — best-effort. Если SMTP упадёт на этом
  // письме, мы не откатываем смену (confirm-письмо уже улетело и юзер
  // ждёт). Просто логируем и идём дальше. Это security-уведомление,
  // не critical path.
  if (user.email) {
    try {
      await sendEmailChangeAlert({
        to: user.email,
        revokeLink,
        newEmail: normalized,
        displayName,
      });
    } catch (e) {
      console.error("[email-change] failed to send alert to old email:", e);
    }
  }

  return { error: null };
}
