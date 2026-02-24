"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type StaffMember = {
  uvr_id:     string;
  user_id:    string;
  role_id:    string;
  role_name:  string;
  role_code:  string;
  first_name: string | null;
  last_name:  string | null;
  email:      string;
  joined_at:  string;
};

export async function getStaff(venueId: string): Promise<StaffMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_venue_staff", {
    p_venue_id: venueId,
  });
  if (error) return [];
  return (data ?? []) as StaffMember[];
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

  // Create invitation record
  const { error: invError } = await supabase.from("invitations").insert({
    venue_id:   data.venueId,
    email:      data.email,
    role_id:    data.roleId,
    invited_by: user.id,
    status:     "pending",
  });
  if (invError) return { error: invError.message };

  // Send invite email via admin client
  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.inviteUserByEmail(
    data.email,
    {
      data: { venue_id: data.venueId, role_id: data.roleId },
      redirectTo: `${
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
      }/auth/callback?next=/invite`,
    }
  );
  if (authError) return { error: authError.message };

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

export async function removeStaff(
  uvrId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_venue_roles")
    .delete()
    .eq("id", uvrId);

  if (error) return { error: error.message };
  revalidatePath("/staff");
  return { error: null };
}
