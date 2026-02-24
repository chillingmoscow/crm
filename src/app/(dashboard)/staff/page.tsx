import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StaffClient } from "./_components/staff-client";
import { getStaff } from "./actions";

export default async function StaffPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.active_venue_id) redirect("/onboarding");

  const venueId = profile.active_venue_id;

  // Get available roles for role change dropdown
  const { data: roles } = await supabase
    .from("roles")
    .select("id, name, code")
    .order("name");

  const staff = await getStaff(venueId);

  return (
    <StaffClient
      staff={staff}
      roles={roles ?? []}
      venueId={venueId}
      currentUserId={user.id}
    />
  );
}
