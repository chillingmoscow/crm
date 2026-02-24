import { createClient } from "@/lib/supabase/server";
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

  const roles = await getSystemRoles();

  return <OnboardingWizard roles={roles} />;
}
