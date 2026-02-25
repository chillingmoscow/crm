import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StaffClient } from "./_components/staff-client";
import { getStaff, getPendingInvitations, getFiredStaff } from "./actions";

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

  // Current user's role in the active venue
  const { data: uvr } = await supabase
    .from("user_venue_roles")
    .select("roles(code)")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .maybeSingle();

  const activeRoleCode =
    (uvr?.roles as { code: string } | null)?.code ?? null;

  const [staff, invitations, firedStaff] = await Promise.all([
    getStaff(venueId),
    getPendingInvitations(venueId),
    getFiredStaff(venueId),
  ]);

  return (
    <StaffClient
      staff={staff}
      invitations={invitations}
      firedStaff={firedStaff}
      roles={roles ?? []}
      venueId={venueId}
      currentUserId={user.id}
      activeRoleCode={activeRoleCode}
    />
  );
}
