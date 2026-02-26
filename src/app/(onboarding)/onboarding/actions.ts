"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Отправляем magic link через Supabase Auth
  const adminClient = createAdminClient();
  const { error: authError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: {
      venue_id: data.venueId,
      role_id: data.roleId,
      invitation_id: insertedInvitation.id,
    },
    redirectTo,
  });

  if (authError) {
    const isExistingUserError = authError.message
      .toLowerCase()
      .includes("already been registered");

    if (isExistingUserError) {
      const { error: otpError } = await adminClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      });

      if (!otpError) return { error: null };
    }

    await supabase
      .from("invitations")
      .delete()
      .eq("id", insertedInvitation.id);
    return { error: authError.message };
  }

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
