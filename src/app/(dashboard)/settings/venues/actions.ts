"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Json, VenueType, WorkingHours } from "@/types/database";

type VenueData = {
  name: string;
  type: VenueType;
  address?: string;
  phone?: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
};

export async function createVenue(
  data: VenueData
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!account) return { id: null, error: "Аккаунт не найден" };

  const { data: venue, error } = await supabase
    .from("venues")
    .insert({
      account_id:    account.id,
      name:          data.name,
      type:          data.type,
      address:       data.address ?? null,
      phone:         data.phone ?? null,
      currency:      data.currency,
      timezone:      data.timezone,
      working_hours: data.workingHours as unknown as Json,
    })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };

  // Auto-add owner to user_venue_roles for the new venue
  const { data: ownerRole } = await supabase
    .from("roles")
    .select("id")
    .eq("code", "owner")
    .is("account_id", null)
    .single();

  if (ownerRole) {
    await supabase.from("user_venue_roles").insert({
      user_id:  user.id,
      venue_id: venue.id,
      role_id:  ownerRole.id,
    });
  }

  revalidatePath("/settings/venues");
  return { id: venue.id, error: null };
}

export async function updateVenue(
  id: string,
  data: VenueData
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("venues")
    .update({
      name:          data.name,
      type:          data.type,
      address:       data.address ?? null,
      phone:         data.phone ?? null,
      currency:      data.currency,
      timezone:      data.timezone,
      working_hours: data.workingHours as unknown as Json,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/settings/venues");
  return { error: null };
}

export async function deleteVenue(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase.from("venues").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/settings/venues");
  return { error: null };
}
