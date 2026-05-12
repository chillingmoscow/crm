import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCachedUser, getCachedActiveAccountId, getCachedPermissions, createClient } from "@/lib/supabase/server";
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

  // Account name + список permission'ов + счётчик "событий по сотрудникам"
  // параллельно. Permissions нужны для permission-based фильтрации
  // sidebar'а (см. AppSidebar → userPermissions prop). staffAttention —
  // количество сотрудников venue с активным событием (ДР в ближайшие
  // 7 дней / медкнижка ≤30 дн.), рендерится бейджем на пункте
  // «Сотрудники». Cached-обёртки гарантируют что user/account RPC
  // вызываются ровно один раз на RSC-дерево.
  // count_venue_staff_attention — миграция 144, RPC ещё не в типах БД.
  // Каст через unknown — следующая регенерация database.ts уберёт его.
  const supabaseUntyped = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  const [accountId, userPermissions, attentionRes] = await Promise.all([
    getCachedActiveAccountId(),
    getCachedPermissions(),
    supabaseUntyped.rpc("count_venue_staff_attention", { p_venue_id: activeVenueId }),
  ]);
  let accountName: string | null = null;
  if (accountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("name")
      .eq("id", accountId)
      .maybeSingle();
    accountName = account?.name ?? null;
  }
  // RPC возвращает int; на ошибке/null трактуем как 0 (бейдж не рисуем).
  const staffAttentionCount =
    typeof attentionRes?.data === "number" && attentionRes.data > 0
      ? attentionRes.data
      : 0;

  // Восстановим состояние main-сайдбара (открыт/свёрнут) из cookie
  // `sidebar_state`, который SidebarProvider пишет на каждый toggle.
  // Без SSR-чтения после reload'а сайдбар каждый раз возвращался в
  // expanded (default), даже если юзер свернул его.
  const cookieStore = await cookies();
  const sidebarStateCookie = cookieStore.get("sidebar_state")?.value;
  const sidebarDefaultOpen = sidebarStateCookie !== "false";

  // KB-сайдбар скрыт/виден — состояние пишется кликом на иконку «База
  // знаний» в main-сайдбаре когда юзер уже на /knowledge (см.
  // KbNavLink + kb-sidebar-visibility-store). Читаем его и здесь
  // (помимо knowledge/layout), чтобы main-сайдбар на любом маршруте
  // мог отрендерить иконку в правильном цвете без post-hydration
  // flicker'а (Codex P2 на PR #129).
  const kbSidebarHidden = cookieStore.get("kb_sidebar_hidden")?.value === "true";

  return (
    // delayDuration=400 — задержка перед показом, чтобы tooltip не
    // выскакивал моментально при beit-курсорах и случайных проходах.
    // skipDelayDuration=400 — те же 400ms после закрытия одного tooltip'а
    // (раньше было 300, но визуально диссонировало с delayDuration).
    <TooltipProvider delayDuration={400} skipDelayDuration={400}>
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <AppSidebar
        userName={userName}
        userEmail={user.email ?? ""}
        venues={venueList}
        activeVenueId={activeVenueId}
        activeRoleCode={activeRoleCode}
        activeRoleName={activeRoleName}
        accountName={accountName}
        userPermissions={userPermissions}
        staffAttentionCount={staffAttentionCount}
        kbSidebarHidden={kbSidebarHidden}
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
