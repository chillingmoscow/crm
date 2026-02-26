"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const { error: authError } = await admin.auth.admin.inviteUserByEmail(email, {
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
      const { error: otpError } = await admin.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      });

      if (!otpError) {
        revalidatePath("/staff");
        return { error: null };
      }
    }

    // Rollback: remove the orphaned pending invitation
    await supabase
      .from("invitations")
      .delete()
      .eq("id", insertedInvitation.id);
    return { error: authError.message };
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
