import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Invite acceptance page.
 *
 * Accepts all active pending invitations for the current user email.
 * This makes multi-tenant onboarding robust when several invites are sent
 * before the user opens any of the links.
 *
 * After accepting, checks profile completeness:
 *   - If the profile is already filled → redirect to /dashboard
 *   - Otherwise                        → redirect to /onboarding/employee
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

  const invitationIdFromQuery = params.invitation ?? null;
  const nowIso = new Date().toISOString();
  const { data: pendingInvitations } = await db
    .from("invitations")
    .select("id, venue_id, role_id, created_at")
    .ilike("email", user.email!)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });

  const pending = (pendingInvitations ??
    []) as Array<{ id: string; venue_id: string; role_id: string; created_at: string }>;

  if (pending.length === 0) redirect("/dashboard");

  const selectedInvitation =
    (invitationIdFromQuery
      ? pending.find((inv) => inv.id === invitationIdFromQuery)
      : null) ?? pending[0];

  for (const inv of pending) {
    await db
      .from("user_venue_roles")
      .upsert(
        {
          user_id: user.id,
          venue_id: inv.venue_id,
          role_id: inv.role_id,
          status: "active",
        },
        { onConflict: "user_id,venue_id" }
      );
  }

  await db
    .from("invitations")
    .update({ status: "accepted" })
    .in(
      "id",
      pending.map((inv) => inv.id)
    );

  // Switch active venue to the one from the current invite link.
  await supabase
    .from("profiles")
    .update({ active_venue_id: selectedInvitation.venue_id })
    .eq("id", user.id);

  // Check whether the profile is already complete.
  // Required fields: first_name, last_name, phone, telegram_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, phone, telegram_id")
    .eq("id", user.id)
    .maybeSingle();

  const profileComplete =
    !!profile?.first_name &&
    !!profile?.last_name &&
    !!profile?.phone &&
    !!profile?.telegram_id;

  redirect(profileComplete ? "/dashboard" : "/onboarding/employee");
}
