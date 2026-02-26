import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "./_components/wizard";
import { getSystemRoles } from "./actions";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Если онбординг уже пройден — в дашборд
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id")
    .eq("id", user.id)
    .returns<{ active_venue_id: string | null }[]>()
    .maybeSingle();

  if (profile?.active_venue_id) redirect("/dashboard");

  // Staff fallback: if user already has active venue role, set active venue and skip owner onboarding.
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

  // If invitation exists but was not accepted yet, route to invite acceptor.
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

  const roles = await getSystemRoles();

  return <OnboardingWizard roles={roles} />;
}
