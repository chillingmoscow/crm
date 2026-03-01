import { redirect } from "next/navigation";
import { getCachedUser, createClient } from "@/lib/supabase/server";
import { StaffClient } from "./_components/staff-client";
import { getStaff, getPendingInvitations, getFiredStaff } from "./actions";

export default async function StaffPage() {
  // Phase 1 — auth + DB client in parallel (independent async operations)
  const [user, supabase] = await Promise.all([
    getCachedUser(),
    createClient(),
  ]);
  if (!user) redirect("/login");

  // Phase 2 — profile + roles in parallel (both only need user.id / no dependencies)
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("active_venue_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("roles")
      .select("id, name, code")
      .order("name"),
  ]);

  if (!profile?.active_venue_id) redirect("/onboarding");
  const venueId = profile.active_venue_id;

  // Phase 3 — all four queries need venueId; run them all in parallel
  const [{ data: uvr }, staff, invitations, firedStaff] = await Promise.all([
    supabase
      .from("user_venue_roles")
      .select("roles(code)")
      .eq("user_id", user.id)
      .eq("venue_id", venueId)
      .maybeSingle(),
    getStaff(venueId),
    getPendingInvitations(venueId),
    getFiredStaff(venueId),
  ]);

  const activeRoleCode =
    (uvr?.roles as { code: string } | null)?.code ?? null;

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
