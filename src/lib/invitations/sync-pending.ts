import { createAdminClient } from "@/lib/supabase/admin";

export async function syncPendingInvitationsForUser(params: {
  userId: string;
  email: string | null | undefined;
}) {
  const email = params.email?.trim().toLowerCase();
  if (!email) return;

  const db = createAdminClient();

  const nowIso = new Date().toISOString();
  const { data: pendingInvitations } = await db
    .from("invitations")
    .select("id, venue_id, role_id, created_at")
    .ilike("email", email)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });

  const pending = (pendingInvitations ??
    []) as Array<{ id: string; venue_id: string; role_id: string; created_at: string }>;

  if (pending.length === 0) return;

  // Single batch upsert instead of N sequential round-trips
  await db
    .from("user_venue_roles")
    .upsert(
      pending.map((inv) => ({
        user_id: params.userId,
        venue_id: inv.venue_id,
        role_id: inv.role_id,
        status: "active",
      })),
      { onConflict: "user_id,venue_id" }
    );

  await db
    .from("invitations")
    .update({ status: "accepted" })
    .in(
      "id",
      pending.map((inv) => inv.id)
    );
}
