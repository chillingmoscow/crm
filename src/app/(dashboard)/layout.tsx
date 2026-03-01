import { redirect } from "next/navigation";
import { getCachedUser, createClient } from "@/lib/supabase/server";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { syncPendingInvitationsForUser } from "@/lib/invitations/sync-pending";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getCachedUser deduplicates the Supabase Auth API call across this render tree
  // (layout + all child pages get the same user object from React cache)
  const [user, supabase] = await Promise.all([
    getCachedUser(),
    createClient(),
  ]);
  if (!user) redirect("/login");

  // profile + venues in parallel — saves one sequential round-trip
  const [{ data: profile }, { data: venues }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, active_venue_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("get_user_venues"),
  ]);

  // Safety net: sync pending invitations only for users without an active venue
  // (invited users on first login). Skipped for everyone already set up.
  if (!profile?.active_venue_id) {
    await syncPendingInvitationsForUser({ userId: user.id, email: user.email });
  }

  const userName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email?.split("@")[0] ||
    "Пользователь";

  const venueList = (venues ?? []) as {
    venue_id: string;
    venue_name: string;
    role_code: string;
    role_name: string;
  }[];

  // Role code for the currently active venue
  const activeRoleCode =
    venueList.find((v) => v.venue_id === profile?.active_venue_id)?.role_code ?? null;

  return (
    <SidebarProvider>
      <AppSidebar
        userName={userName}
        venues={venueList}
        activeVenueId={profile?.active_venue_id ?? null}
        activeRoleCode={activeRoleCode}
      />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <div className="flex-1" />
          <NotificationBell />
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
