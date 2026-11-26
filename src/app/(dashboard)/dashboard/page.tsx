import { getCachedUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";

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

    redirect("/onboarding");
  }

  return (
    <PageFrame className="flex flex-col gap-4">
      <TablePageHeader title="Дашборд" />
      <p className="text-sm text-muted-foreground">Добро пожаловать в систему</p>
    </PageFrame>
  );
}
