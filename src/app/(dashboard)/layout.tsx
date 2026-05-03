import { redirect } from "next/navigation";
import { getCachedUser, createClient } from "@/lib/supabase/server";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/shared/sidebar";
import { DashboardTopbar } from "@/components/shared/dashboard-topbar";
import { PageHeaderActionsProvider } from "@/components/shared/page-header-actions";
import { syncPendingInvitationsForUser } from "@/lib/people/invitations/sync-pending";

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

  let activeVenueId = profile?.active_venue_id ?? null;

  // Safety net: sync pending invitations only for users without an active venue.
  if (!activeVenueId) {
    await syncPendingInvitationsForUser({ userId: user.id, email: user.email });

    // After syncing invitations, try to resolve an active venue immediately to avoid
    // rendering dashboard shell and then redirecting in nested pages.
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
      activeVenueId = membership.venue_id;
    }
  }

  if (!activeVenueId) {
    redirect("/onboarding");
  }

  const userName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email?.split("@")[0] ||
    "Пользователь";

  const venueList = (venues ?? []) as {
    venue_id: string;
    venue_name: string;
    venue_type: string | null;
    role_code: string;
    role_name: string;
  }[];

  // Role code + human-readable name for the currently active venue
  const activeVenue = venueList.find((v) => v.venue_id === activeVenueId);
  const activeRoleCode = activeVenue?.role_code ?? null;
  const activeRoleName = activeVenue?.role_name ?? null;

  // Account name + список permission'ов параллельно. Permissions
  // нужны для permission-based фильтрации sidebar'а (см. AppSidebar
  // → userPermissions prop).
  const [{ data: accountId }, { data: userPerms }] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("list_my_permissions"),
  ]);
  let accountName: string | null = null;
  if (accountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("name")
      .eq("id", accountId as string)
      .maybeSingle();
    accountName = account?.name ?? null;
  }
  const userPermissions = (userPerms as string[] | null) ?? [];

  return (
    // delayDuration=150 — short hover-delay для всех IconTooltip'ов
    // (DS-style вместо системной задержки native title).
    // skipDelayDuration=300 — после показа одного tooltip'а соседние
    // показываются мгновенно при hover'е (типичный pattern toolbar'ов).
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
    <SidebarProvider>
      <AppSidebar
        userName={userName}
        userEmail={user.email ?? ""}
        venues={venueList}
        activeVenueId={activeVenueId}
        activeRoleCode={activeRoleCode}
        activeRoleName={activeRoleName}
        accountName={accountName}
        userPermissions={userPermissions}
      />
      <SidebarInset>
        <PageHeaderActionsProvider>
          {/* Top bar: [trigger | breadcrumb] … [actions | bell].
              На /knowledge скрывается — KB рендерит собственный topbar
              (см. components/shared/dashboard-topbar.tsx). */}
          <DashboardTopbar />
          <main className="flex-1 flex flex-col">{children}</main>
        </PageHeaderActionsProvider>
      </SidebarInset>
    </SidebarProvider>
    </TooltipProvider>
  );
}
