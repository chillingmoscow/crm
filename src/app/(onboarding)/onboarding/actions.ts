"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvitationEmail } from "@/lib/invitations/mailer";
import type { Json, VenueType, WorkingHours } from "@/types/database";

// Загрузка логотипа в Supabase Storage
export async function uploadLogo(formData: FormData): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Не авторизован" };

  const file = formData.get("file") as File;
  if (!file) return { url: null, error: "Файл не выбран" };

  const ext = file.name.split(".").pop();
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true });

  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// Создание аккаунта и первого заведения (через stored procedure)
export async function createAccountAndVenue(data: {
  accountName: string;
  accountLogoUrl: string | null;
  venueName: string;
  venueType: VenueType;
  venueAddress: string;
  venuePhone: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
}): Promise<{ accountId: string | null; venueId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { accountId: null, venueId: null, error: "Не авторизован" };

  const { data: result, error } = await supabase.rpc("complete_owner_onboarding", {
    p_account_name:  data.accountName,
    p_account_logo:  data.accountLogoUrl ?? "",
    p_venue_name:    data.venueName,
    p_venue_type:    data.venueType,
    p_venue_address: data.venueAddress,
    p_venue_phone:   data.venuePhone,
    p_currency:      data.currency,
    p_timezone:      data.timezone,
    p_working_hours: data.workingHours as unknown as Json,
  });

  if (error) return { accountId: null, venueId: null, error: error.message };

  const rpcResult = result as { account_id: string; venue_id: string };
  return {
    accountId: rpcResult.account_id,
    venueId:   rpcResult.venue_id,
    error:     null,
  };
}

// Отправка приглашения сотруднику
export async function sendInvitation(data: {
  email: string;
  roleId: string;
  venueId: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

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

  if (!venueRow?.name) return { error: "Не удалось определить заведение для приглашения" };

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

  if (invError || !insertedInvitation?.id) return { error: invError?.message ?? "Не удалось создать приглашение" };

  const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(
    `/invite?invitation=${insertedInvitation.id}`
  )}`;

  // Генерируем ссылку (invite для новых пользователей, magiclink для существующих)
  const adminClient = createAdminClient();
  const linkPayload = {
    venue_id: data.venueId,
    role_id: data.roleId,
    invitation_id: insertedInvitation.id,
    venue_name: venueRow.name,
    role_name: roleName,
  };
  const resendApiKey = process.env.RESEND_API_KEY ?? process.env.SMTP_PASS;

  // Fallback: if Resend API key is not configured, use built-in Supabase emails.
  if (!resendApiKey) {
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: linkPayload,
      redirectTo,
    });

    if (inviteError) {
      const isExistingUserError = inviteError.message
        .toLowerCase()
        .includes("already been registered");

      if (!isExistingUserError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: inviteError.message };
      }

      const { error: otpError } = await adminClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
          data: linkPayload,
        },
      });

      if (otpError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: otpError.message };
      }
    }

    return { error: null };
  }

  const { data: inviteLinkData, error: inviteLinkError } =
    await adminClient.auth.admin.generateLink({
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
      return { error: inviteLinkError.message };
    }

    const { data: magicLinkData, error: magicLinkError } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          data: linkPayload,
          redirectTo,
        },
      });

    if (magicLinkError || !magicLinkData?.properties?.action_link) {
      await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
      return { error: magicLinkError?.message ?? "Не удалось сгенерировать ссылку приглашения" };
    }

    existingUser = true;
    actionLink = magicLinkData.properties.action_link;
  }

  if (!actionLink) {
    await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
    return { error: "Не удалось сгенерировать ссылку приглашения" };
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
    await supabase
      .from("invitations")
      .delete()
      .eq("id", insertedInvitation.id);
    return {
      error:
        emailError instanceof Error
          ? emailError.message
          : "Не удалось отправить письмо-приглашение",
    };
  }

  return { error: null };
}

// Сохранение профиля пользователя
export async function saveProfile(data: {
  firstName: string;
  lastName: string;
  phone: string;
  telegramId: string | null;
  address: string | null;
  gender: string | null;
  birthDate: string | null;
  photoUrl: string | null;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name:  data.firstName,
      last_name:   data.lastName,
      phone:       data.phone || null,
      telegram_id: data.telegramId || null,
      address:     data.address || null,
      gender:      data.gender || null,
      birth_date:  data.birthDate || null,
      photo_url:   data.photoUrl,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { error: null };
}

// Получение системных ролей (для выбора в онбординге)
export async function getSystemRoles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, code")
    .is("account_id", null)
    .neq("code", "owner")
    .order("name");

  if (error) return [];
  return data ?? [];
}
