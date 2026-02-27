import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { syncPendingInvitationsForUser } from "@/lib/invitations/sync-pending";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Safety net: if invite callback was interrupted, finalize pending invitations on first dashboard request.
  await syncPendingInvitationsForUser({ userId: user.id, email: user.email });

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, active_venue_id")
    .eq("id", user.id)
    .maybeSingle();

  const userName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email?.split("@")[0] ||
    "Пользователь";

  // All venues the user has access to
  const { data: venues } = await supabase.rpc("get_user_venues");

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
