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
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Invitation id can come directly from the email link (preferred for multi-tenant).
  const invitationIdFromQuery = params.invitation ?? null;
  const invitationIdFromMeta = (user.user_metadata?.invitation_id as string) ?? null;

  // Try user metadata first (populated by inviteUserByEmail)
  let venueId: string | null = (user.user_metadata?.venue_id as string) ?? null;
  let roleId: string | null  = (user.user_metadata?.role_id  as string) ?? null;
  let invitationId: string | null = invitationIdFromQuery ?? invitationIdFromMeta;

  // If invitation_id is present, resolve invitation first.
  if (invitationId) {
    const { data: invById } = await db
      .from("invitations")
      .select("id, venue_id, role_id")
      .eq("id", invitationId)
      .ilike("email", user.email!)
      .eq("status", "pending")
      .maybeSingle();

    if (invById) {
      venueId = invById.venue_id as string;
      roleId = invById.role_id as string;
      invitationId = invById.id as string;
    } else {
      invitationId = null;
    }
  }

  // Fall back to pending invitation row.
  // NOTE: invited user cannot read invitations via RLS, so use admin client.
  if (!venueId || !roleId || !invitationId) {
    const { data: inv } = await db
      .from("invitations")
      .select("id, venue_id, role_id")
      .ilike("email", user.email!)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inv) {
      invitationId = inv.id as string;
      venueId = inv.venue_id as string;
      roleId  = inv.role_id  as string;
    }
  }

  // No pending invitation — go to dashboard
  if (!venueId || !roleId || !invitationId) redirect("/dashboard");

  // Idempotent membership upsert for multi-tenant invite acceptance.
  await db
    .from("user_venue_roles")
    .upsert(
      {
        user_id: user.id,
        venue_id: venueId,
        role_id: roleId,
        status: "active",
      },
      { onConflict: "user_id,venue_id" }
    );

  // Always mark this invitation accepted.
  await db
    .from("invitations")
    .update({ status: "accepted" })
    .eq("id", invitationId)
    .eq("status", "pending");

  // Set this venue as the user's active venue
  await supabase
    .from("profiles")
    .update({ active_venue_id: venueId })
    .eq("id", user.id);

  redirect("/dashboard");
}
