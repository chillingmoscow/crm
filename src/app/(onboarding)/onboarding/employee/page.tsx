import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EmployeeOnboarding } from "./_components/employee-onboarding";
import type { ProfileInitialData } from "../_components/step-profile";

/**
 * Employee onboarding page.
 *
 * Reached after accepting an invitation via /invite.
 * Logic:
 *   - No active venue role → redirect to /dashboard (shouldn't normally happen)
 *   - Profile already complete (first_name set) → redirect to /dashboard
 *   - isNewUser = profile has no first_name (brand-new user, never set a password)
 *     → show StepSetPassword + StepProfile
 *   - Returning user with incomplete profile
 *     → show StepProfile only
 */
export default async function EmployeeOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // If the user has no active venue membership, nothing to do here.
  const { data: membership } = await supabase
    .from("user_venue_roles")
    .select("venue_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership?.venue_id) redirect("/dashboard");

  // Fetch current profile data.
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, photo_url, gender, birth_date, phone, telegram_id, address")
    .eq("id", user.id)
    .maybeSingle();

  // Profile is complete — go straight to dashboard.
  if (profile?.first_name && profile?.last_name && profile?.phone) {
    redirect("/dashboard");
  }

  // A brand-new invited user has never set a password or filled the profile.
  const isNewUser = !profile?.first_name;

  const initialProfile: ProfileInitialData = {
    firstName:  profile?.first_name  ?? "",
    lastName:   profile?.last_name   ?? "",
    photoUrl:   profile?.photo_url   ?? null,
    gender:     profile?.gender      ?? null,
    birthDate:  profile?.birth_date  ?? null,
    phone:      profile?.phone       ?? null,
    telegramId: profile?.telegram_id ?? null,
    address:    profile?.address     ?? null,
  };

  return (
    <EmployeeOnboarding initialProfile={initialProfile} isNewUser={isNewUser} />
  );
}
