import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Invite acceptance page.
 *
 * Flow:
 *  1. User clicks the magic-link email sent by inviteUserByEmail()
 *  2. /auth/callback exchanges the code for a session and redirects here
 *  3. We read venue_id / role_id from:
 *       a) user.user_metadata (set by inviteUserByEmail)
 *       b) fall back to the most recent pending invitation row for their email
 *  4. Create an active user_venue_roles row (idempotent)
 *  5. Mark the invitation as accepted
 *  6. Set active_venue_id on their profile
 *  7. Redirect to /dashboard (or /onboarding if profile is incomplete)
 */
export default async function InvitePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Try user metadata first (populated by inviteUserByEmail)
  let venueId: string | null = (user.user_metadata?.venue_id as string) ?? null;
  let roleId: string | null  = (user.user_metadata?.role_id  as string) ?? null;

  // Fall back to pending invitation row.
  // NOTE: invited user cannot read invitations via RLS, so use admin client.
  if (!venueId || !roleId) {
    const admin = createAdminClient();
    const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: inv } = await db
      .from("invitations")
      .select("venue_id, role_id")
      .ilike("email", user.email!)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inv) {
      venueId = inv.venue_id as string;
      roleId  = inv.role_id  as string;
    }
  }

  // No pending invitation — go to dashboard
  if (!venueId || !roleId) redirect("/dashboard");

  // Check if UVR already exists (idempotent — handles double-clicks)
  const { data: existingUvr } = await supabase
    .from("user_venue_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .maybeSingle();

  if (!existingUvr) {
    // Use admin client to bypass RLS on user_venue_roles and invitations
    const admin = createAdminClient();
    const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    await db.from("user_venue_roles").insert({
      user_id:  user.id,
      venue_id: venueId,
      role_id:  roleId,
      status:   "active",
    });

    await db
      .from("invitations")
      .update({ status: "accepted" })
      .eq("email", user.email)
      .eq("venue_id", venueId)
      .eq("status", "pending");
  }

  // Set this venue as the user's active venue
  await supabase
    .from("profiles")
    .update({ active_venue_id: venueId })
    .eq("id", user.id);

  redirect("/dashboard");
}
