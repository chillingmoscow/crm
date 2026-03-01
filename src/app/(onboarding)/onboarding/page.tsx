import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "./_components/wizard";
import { getSystemRoles } from "./actions";
import type { ProfileInitialData } from "./_components/step-profile";
import { syncPendingInvitationsForUser } from "@/lib/invitations/sync-pending";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  await syncPendingInvitationsForUser({ userId: user.id, email: user.email });

  // Если онбординг уже пройден — в дашборд
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_venue_id, first_name, last_name, photo_url, avatar_url, gender, birth_date, phone, telegram_id, address")
    .eq("id", user.id)
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

  const roles = await getSystemRoles();

  const initialProfile: ProfileInitialData = {
    firstName:  profile?.first_name  ?? "",
    lastName:   profile?.last_name   ?? "",
    photoUrl:   profile?.avatar_url  ?? profile?.photo_url ?? null,
    gender:     profile?.gender      ?? null,
    birthDate:  profile?.birth_date  ?? null,
    phone:      profile?.phone       ?? null,
    telegramId: profile?.telegram_id ?? null,
    address:    profile?.address     ?? null,
  };

  return <OnboardingWizard roles={roles} initialProfile={initialProfile} />;
}
