import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileSettingsPage } from "./_components/profile-settings-page";
import type { OwnProfile } from "./actions";

// force-dynamic: эта страница per-user (читает auth-cookie) и должна
// всегда показывать свежие данные после save. См. комментарий в
// /people/staff/[userId]/page.tsx — та же причина.
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, phone, telegram_id, gender, birth_date, birth_date_set_at, address, avatar_url",
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
