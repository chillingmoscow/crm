import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EmployeeOnboarding } from "./_components/employee-onboarding";
import type { ProfileInitialData } from "../_components/step-profile";

export default async function EmployeeOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Must have at least one active venue role (granted by /invite)
  const { data: membership } = await supabase
    .from("user_venue_roles")
    .select("venue_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership?.venue_id) redirect("/dashboard");

  // Fetch current profile data
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, photo_url, gender, birth_date, phone, telegram_id, address")
    .eq("id", user.id)
    .maybeSingle();

  // If the profile already looks complete, skip straight to the dashboard
  if (
    profile?.first_name &&
    profile?.last_name &&
    profile?.phone &&
    profile?.telegram_id
  ) {
    redirect("/dashboard");
  }

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

  return <EmployeeOnboarding initialProfile={initialProfile} />;
}
