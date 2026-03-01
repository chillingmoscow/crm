import { getCachedUser, createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  // getCachedUser() returns the same user object already fetched by layout —
  // no additional Supabase Auth API call is made.
  const [user, supabase] = await Promise.all([
    getCachedUser(),
    createClient(),
  ]);

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user.id)
    .returns<{ active_venue_id: string | null }[]>()
    .maybeSingle();

  if (!profile?.active_venue_id) {
    // Staff fallback: if user already has active membership, use that venue.
    const { data: membership } = await supabase
      .from("user_venue_roles")
      .select("venue_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (membership?.venue_id) {
      await supabase
        .from("profiles")
        .update({ active_venue_id: membership.venue_id })
        .eq("id", user.id);
      redirect("/dashboard");
    }

    // If invitation is pending, let /invite accept it.
    const admin = createAdminClient();
    const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: pendingInvite } = await db
      .from("invitations")
      .select("id")
      .ilike("email", user.email ?? "")
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (pendingInvite?.id) redirect("/invite");

    redirect("/onboarding");
  }

  return (
    <div className="p-6 md:p-8 w-full">
      <h1 className="text-2xl font-semibold">Дашборд</h1>
      <p className="text-muted-foreground mt-1">Добро пожаловать в систему</p>
    </div>
  );
}
