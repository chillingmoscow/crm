"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function switchVenue(
  venueId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  // Verify user has access to this venue
  const { data: access } = await supabase
    .from("user_venue_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle();

  if (!access) return { error: "Нет доступа к этому заведению" };

  const { error } = await supabase
    .from("profiles")
    .update({ active_venue_id: venueId })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { error: null };
}
