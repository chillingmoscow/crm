import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileSettingsPage } from "./_components/profile-settings-page";
import type { OwnProfile } from "./actions";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, telegram_id, gender, birth_date, address, avatar_url",
    )
    .eq("id", user.id)
    .returns<OwnProfile[]>()
    .maybeSingle();

  if (!profile) redirect("/onboarding");

  return (
    <ProfileSettingsPage
      profile={profile}
      email={user.email ?? ""}
      emailConfirmed={Boolean(user.email_confirmed_at)}
    />
  );
}
