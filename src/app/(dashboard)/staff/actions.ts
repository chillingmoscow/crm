"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvitationEmail } from "@/lib/invitations/mailer";
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
  uvr_id:     string;
  user_id:    string;
  role_id:    string;
  role_name:  string;
  role_code:  string;
  first_name: string | null;
  last_name:  string | null;
  email:      string;
  avatar_url: string | null;
  fired_at:   string;
};

export type StaffMember = {
  uvr_id:          string;
  user_id:         string;
  role_id:         string;
  role_name:       string;
  role_code:       string;
  first_name:      string | null;
  last_name:       string | null;
  email:           string;
  avatar_url:      string | null;
  phone:           string | null;
  telegram_id:     string | null;
  gender:          string | null;
  birth_date:      string | null;
  employment_date: string | null;
  joined_at:       string;
};

export type FullStaffProfile = {
  id:                  string;
  first_name:          string | null;
  last_name:           string | null;
  phone:               string | null;
  telegram_id:         string | null;
  gender:              string | null;
  birth_date:          string | null;
  address:             string | null;
  employment_date:     string | null;
  avatar_url:          string | null;
  medical_book_number: string | null;
  medical_book_date:   string | null;
  passport_photos:     string[];
  comment:             string | null;
};

export type ProfileUpdate = Omit<FullStaffProfile, "id" | "passport_photos">;

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
): Promise<FullStaffProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, telegram_id, gender, birth_date, address, employment_date, avatar_url, medical_book_number, medical_book_date, passport_photos, comment"
    )
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  // Cast through unknown because generated DB types don't yet include migration 011 columns
  const row = data as unknown as Record<string, unknown>;
  return {
    id:                  row.id as string,
    first_name:          (row.first_name as string | null) ?? null,
    last_name:           (row.last_name as string | null) ?? null,
    phone:               (row.phone as string | null) ?? null,
    telegram_id:         (row.telegram_id as string | null) ?? null,
    gender:              (row.gender as string | null) ?? null,
    birth_date:          (row.birth_date as string | null) ?? null,
    address:             (row.address as string | null) ?? null,
    employment_date:     (row.employment_date as string | null) ?? null,
    avatar_url:          (row.avatar_url as string | null) ?? null,
    medical_book_number: (row.medical_book_number as string | null) ?? null,
    medical_book_date:   (row.medical_book_date as string | null) ?? null,
    passport_photos:     (row.passport_photos as string[] | null) ?? [],
    comment:             (row.comment as string | null) ?? null,
  };
}

export async function updateStaffProfile(
  userId: string,
  data: Partial<ProfileUpdate> & { passport_photos?: string[] }
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/staff");
  return { error: null };
}

export async function inviteStaff(data: {
  email:   string;
  roleId:  string;
  venueId: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const admin = createAdminClient();
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
        return { error: inviteError.message };
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
        return { error: otpError.message };
      }
    }

    revalidatePath("/staff");
    return { error: null };
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
      return { error: inviteLinkError.message };
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
    await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
    return {
      error:
        emailError instanceof Error
          ? emailError.message
          : "Не удалось отправить письмо-приглашение",
    };
  }

  revalidatePath("/staff");
  return { error: null };
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
  revalidatePath("/staff");
  return { error: null };
}

export async function fireStaff(
  uvrId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_venue_roles")
    .update({ status: "fired", fired_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("id", uvrId);

  if (error) return { error: error.message };
  revalidatePath("/staff");
  return { error: null };
}

export async function restoreStaff(
  uvrId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_venue_roles")
    .update({ status: "active", fired_at: null } as Record<string, unknown>)
    .eq("id", uvrId);

  if (error) return { error: error.message };
  revalidatePath("/staff");
  return { error: null };
}

export async function getFiredStaff(venueId: string): Promise<FiredStaffMember[]> {
  const supabase = await createClient();
  // Cast needed: get_fired_staff not yet in generated DB types (migration 012)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_fired_staff", {
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
  revalidatePath("/staff");
  return { error: null };
}
